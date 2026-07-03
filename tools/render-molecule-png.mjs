#!/usr/bin/env node
/**
 * render-molecule-png — headless "generate a molecule → transparent PNG asset".
 *
 * Drives the REAL shipped viewer (the same `?mcp=1` URL bootstrap +
 * `lupi.export_png` tool a browser agent uses) in headless Chromium, then
 * writes the print-on-demand PNG to disk. This is the CLI/API counterpart to
 * the export panel's "Print · transparent" buttons: one command generates a
 * molecule and its clean, transparent, molecule-only print asset.
 *
 * Usage:
 *   node tools/render-molecule-png.mjs --name caffeine --out caffeine.png
 *   node tools/render-molecule-png.mjs --smiles "c1ccccc1" --size 4096 --out benzene.png
 *   node tools/render-molecule-png.mjs --atoms 250000 --element Cu --lattice fcc --out cu.png
 *   node tools/render-molecule-png.mjs --url http://127.0.0.1:5173 --name water --out water.png
 *
 * By default it serves apps/web/dist itself, so build the app first:
 *   pnpm --filter web build
 * Pass --url to target an already-running server instead (e.g. `pnpm dev`).
 *
 * Options:
 *   Molecule:  --name <s> | --smiles <s> | --template <s>
 *              --atoms <n> [--element <sym> | --elements a,b,c] [--lattice fcc|bcc|sc]
 *   Image:     --size <px> (square, default 2048) | --width <px> --height <px>
 *              --opaque (default transparent) --view iso|current|front|top
 *              --projection perspective|orthographic --ssaa <n> --margin <f>
 *   Runner:    --out <path> (default ./<molecule>.png) --url <baseUrl>
 *              --port <n> (auto-serve) --timeout <ms> (default 120000) --keep-open
 */

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ─── Args ───────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true; // boolean flag
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

// ─── Molecule → URL params ──────────────────────────────────────────
function moleculeParams(a) {
  const p = new URLSearchParams();
  if (a.name) p.set('name', String(a.name));
  else if (a.template) p.set('name', String(a.template));
  else if (a.smiles) p.set('smiles', String(a.smiles));
  else if (a.atoms || a.atomCount) {
    p.set('atomCount', String(a.atoms ?? a.atomCount));
    if (a.elements) p.set('elements', String(a.elements));
    else if (a.element) p.set('element', String(a.element));
    p.set('lattice', String(a.lattice ?? 'fcc'));
  } else {
    // Default smoke molecule so the tool always produces something.
    p.set('name', 'caffeine');
  }
  return p;
}

function pngParams(a) {
  const p = new URLSearchParams();
  p.set('export', 'png');
  p.set('download', '0'); // headless: we read window.__lupiRenderResult instead
  if (a.size) p.set('size', String(a.size));
  if (a.width) p.set('width', String(a.width));
  if (a.height) p.set('height', String(a.height));
  p.set('transparent', a.opaque ? 'false' : 'true');
  if (a.view) p.set('view', String(a.view));
  if (a.projection) p.set('projection', String(a.projection));
  if (a.ssaa) p.set('supersample', String(a.ssaa));
  if (a.margin) p.set('margin', String(a.margin));
  if (a.viewDirection) p.set('viewDirection', String(a.viewDirection));
  return p;
}

function outputName(a) {
  if (a.out) return String(a.out);
  const base = a.name || a.template || a.smiles || (a.atoms ? `${a.atoms}-atoms` : 'molecule');
  return `${String(base).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'molecule'}.png`;
}

// ─── Static server (serves apps/web/dist) ───────────────────────────
function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'tools', 'serve-web.mjs')], {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const onData = (buf) => {
      const text = buf.toString();
      if (!settled && /Listening on/.test(text)) {
        settled = true;
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (b) => process.stderr.write(`[serve] ${b}`));
    child.on('exit', (code) => {
      if (!settled) reject(new Error(`serve-web exited early (code ${code}). Did you run \`pnpm --filter web build\`?`));
    });
    setTimeout(() => {
      if (!settled) reject(new Error('Timed out waiting for serve-web to listen.'));
    }, 15000);
  });
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  const timeout = Number(args.timeout ?? 120000);
  const port = Number(args.port ?? 8231);
  const outPath = path.resolve(outputName(args));

  let server = null;
  let baseUrl = args.url ? String(args.url).replace(/\/$/, '') : null;
  if (!baseUrl) {
    console.log(`[render] serving apps/web/dist on port ${port} …`);
    server = await startServer(port);
    baseUrl = `http://127.0.0.1:${port}`;
  }

  const molParams = moleculeParams(args);
  const imgParams = pngParams(args);
  const merged = new URLSearchParams(molParams);
  for (const [k, v] of imgParams) merged.set(k, v);
  merged.set('mcp', '1');
  const targetUrl = `${baseUrl}/?${merged.toString()}#/mcp`;

  console.log(`[render] ${targetUrl}`);

  const launchOpts = {};
  const chromiumPath = '/opt/pw-browsers/chromium';
  try {
    const { existsSync } = await import('node:fs');
    if (existsSync(chromiumPath)) launchOpts.executablePath = chromiumPath;
  } catch { /* use bundled */ }

  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err?.message ?? err)));

  let result = null;
  let exitCode = 0;
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout });

    await page.waitForFunction(
      () => !!(window.__lupiRenderResult && window.__lupiRenderResult.dataUrl),
      null,
      { timeout },
    );

    result = await page.evaluate(() => window.__lupiRenderResult);

    const base64 = String(result.dataUrl).replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    await writeFile(outPath, buffer);

    const alpha = await sampleCornerAlpha(page);
    console.log(`[render] wrote ${outPath}`);
    console.log(
      `[render] ${result.width}x${result.height} · ${result.atomCount.toLocaleString()} atoms · ` +
      `${(buffer.length / 1024).toFixed(1)} KB · transparent=${result.transparent} · corner alpha=${alpha}`,
    );
    if (result.transparent && alpha !== 0) {
      console.warn(`[render] WARNING: expected corner alpha 0 for a transparent PNG, got ${alpha}`);
    }
  } catch (err) {
    exitCode = 1;
    console.error(`[render] FAILED: ${err.message}`);
    // Surface the MCP error transcript if the tool ran and rejected.
    const mcpError = await page.evaluate(() => {
      const log = window.__lupiViewerMcpResponses ?? [];
      const last = log[log.length - 1];
      const failed = last?.responses?.find((r) => r && r.ok === false);
      return failed?.error?.message ?? failed?.transcript?.join(' | ') ?? null;
    }).catch(() => null);
    if (mcpError) console.error(`[render] MCP error: ${mcpError}`);
    if (consoleErrors.length) console.error(`[render] console errors:\n  ${consoleErrors.slice(0, 8).join('\n  ')}`);
  } finally {
    if (args['keep-open']) {
      console.log('[render] --keep-open: leaving browser open. Ctrl-C to exit.');
      await new Promise(() => {});
    }
    await browser.close();
    if (server) server.kill();
  }

  process.exit(exitCode);
}

/** Decode the written PNG in-page and read the top-left pixel's alpha, to
 *  confirm the background really is transparent (a genuine cutout). */
async function sampleCornerAlpha(page) {
  return page.evaluate(async () => {
    const url = window.__lupiRenderResult?.dataUrl;
    if (!url) return null;
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, 1, 1).data[3]; // alpha of top-left pixel
  }).catch(() => null);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
