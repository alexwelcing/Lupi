#!/usr/bin/env node
/**
 * merch-render — headless "molecule → print-on-demand merch assets".
 *
 * Drives the shipped viewer's `lupi.export_merch` tool in headless Chromium to
 * produce, for each product (mug / tee / hat / poster), the Gooten print file
 * + storefront mockup + the Shopify listing shape (title, handle, tags,
 * variant SKUs, prices, print dimensions). Writes the images and a
 * `listing.json` manifest to disk — the input the Shopify/Gooten connector
 * (tools/merch-publish.mjs) consumes.
 *
 * Usage:
 *   node tools/merch-render.mjs --name caffeine --product all --out-dir merch/caffeine
 *   node tools/merch-render.mjs --smiles "c1ccccc1" --product mug,tee --out-dir merch/benzene
 *   node tools/merch-render.mjs --atoms 20000 --element Cu --lattice fcc --product poster
 *
 * Serve apps/web/dist first (`pnpm --filter web build`), or pass --url to a
 * running dev/preview server.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const key = t.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

async function moleculeParams(a) {
  const p = new URLSearchParams();
  if (a['xyz-file']) {
    // Load geometry from a local XYZ file (e.g. fetched server-side when the
    // browser can't reach the structure source). --molecule-name keeps the
    // product identity (SKUs/title/tags) correct.
    const xyz = await readFile(String(a['xyz-file']), 'utf8');
    p.set('xyz', xyz);
    p.set('inputType', 'xyz');
    if (a['molecule-name']) p.set('moleculeName', String(a['molecule-name']));
  } else if (a.name) p.set('name', String(a.name));
  else if (a.template) p.set('name', String(a.template));
  else if (a.smiles) p.set('smiles', String(a.smiles));
  else if (a.atoms || a.atomCount) {
    p.set('atomCount', String(a.atoms ?? a.atomCount));
    if (a.elements) p.set('elements', String(a.elements));
    else if (a.element) p.set('element', String(a.element));
    p.set('lattice', String(a.lattice ?? 'fcc'));
  } else p.set('name', 'caffeine');
  return p;
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'tools', 'serve-web.mjs')], {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    child.stdout.on('data', (b) => {
      if (!settled && /Listening on/.test(b.toString())) { settled = true; resolve(child); }
    });
    child.stderr.on('data', (b) => process.stderr.write(`[serve] ${b}`));
    child.on('exit', (code) => { if (!settled) reject(new Error(`serve-web exited early (code ${code}). Run \`pnpm --filter web build\` first.`)); });
    setTimeout(() => { if (!settled) reject(new Error('Timed out waiting for serve-web.')); }, 15000);
  });
}

async function main() {
  const timeout = Number(args.timeout ?? 180000);
  const port = Number(args.port ?? 8241);
  const product = String(args.product ?? 'all');
  const molName = args['molecule-name'] || args.name || args.template || args.smiles || (args.atoms ? `${args.atoms}-atoms` : 'molecule');
  const outDir = path.resolve(args['out-dir'] ?? `merch/${String(molName).replace(/[^a-z0-9_-]+/gi, '-')}`);
  await mkdir(outDir, { recursive: true });

  let server = null;
  let baseUrl = args.url ? String(args.url).replace(/\/$/, '') : null;
  if (!baseUrl) {
    console.log(`[merch] serving apps/web/dist on port ${port} …`);
    server = await startServer(port);
    baseUrl = `http://127.0.0.1:${port}`;
  }

  const merged = new URLSearchParams(await moleculeParams(args));
  merged.set('merch', product);
  merged.set('download', '0');
  if (args['render-size']) merged.set('renderSize', String(args['render-size']));
  if (args.view) merged.set('view', String(args.view));
  merged.set('mcp', '1');
  const targetUrl = `${baseUrl}/?${merged.toString()}#/mcp`;
  console.log(`[merch] ${targetUrl}`);

  const launchOpts = {};
  try {
    const { existsSync } = await import('node:fs');
    if (existsSync('/opt/pw-browsers/chromium')) launchOpts.executablePath = '/opt/pw-browsers/chromium';
  } catch { /* bundled */ }

  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e?.message ?? e)));

  let exitCode = 0;
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForFunction(
      () => !!(window.__lupiMerchResult && window.__lupiMerchResult.listings?.length),
      null, { timeout },
    );
    const result = await page.evaluate(() => window.__lupiMerchResult);

    const manifest = [];
    for (const listing of result.listings) {
      const assetFiles = [];
      for (const asset of listing.assets) {
        const base64 = String(asset.dataUrl).replace(/^data:image\/png;base64,/, '');
        const buf = Buffer.from(base64, 'base64');
        const file = path.join(outDir, asset.filename);
        await writeFile(file, buf);
        assetFiles.push({ kind: asset.kind, file: path.relative(outDir, file), width: asset.width, height: asset.height, bytes: buf.length });
        console.log(`[merch] ${listing.product}/${asset.kind}  ${asset.width}x${asset.height}  ${(buf.length / 1024).toFixed(0)} KB  → ${asset.filename}`);
      }
      manifest.push({ ...listing, assets: assetFiles });
    }

    const manifestPath = path.join(outDir, 'listing.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`[merch] wrote ${manifest.length} listing(s) + assets to ${outDir}`);
    console.log(`[merch] manifest: ${manifestPath}`);
  } catch (err) {
    exitCode = 1;
    console.error(`[merch] FAILED: ${err.message}`);
    const mcpError = await page.evaluate(() => {
      const log = window.__lupiViewerMcpResponses ?? [];
      const last = log[log.length - 1];
      const failed = last?.responses?.find((r) => r && r.ok === false);
      return failed?.error?.message ?? null;
    }).catch(() => null);
    if (mcpError) console.error(`[merch] MCP error: ${mcpError}`);
    if (consoleErrors.length) console.error(`[merch] console:\n  ${consoleErrors.slice(0, 8).join('\n  ')}`);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  process.exit(exitCode);
}

main().catch((e) => { console.error(e); process.exit(1); });
