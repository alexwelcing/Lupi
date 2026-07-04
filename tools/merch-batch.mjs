#!/usr/bin/env node
/**
 * merch-batch — turn a list of molecules into live-ready Shopify products in
 * one command. No manual steps.
 *
 * For each molecule it:
 *   1. fetches the 3D structure from PubChem (server-side, so it works even
 *      where the browser can't reach PubChem) and writes an XYZ,
 *   2. renders the merch assets (all products) via merch-render,
 *   3. publishes to Shopify + writes the Gooten manifest via merch-publish.
 *
 * This is the scale path: `merch-batch --molecules dopamine,glucose,adrenaline`
 * creates four draft products each (mug/tee/cap/poster) with designs, print
 * files, and the lupi + gooten metafields — the same result as the manual
 * wiring, automated.
 *
 * Usage:
 *   SHOPIFY_STORE=lupi-8182.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_… \
 *     node tools/merch-batch.mjs --molecules "dopamine,glucose" [--products all] [--publish]
 *
 *   # dry run (renders + writes manifests, no store writes):
 *   node tools/merch-batch.mjs --molecules dopamine --dry-run
 *
 * Options:
 *   --molecules a,b,c   (required) comma/space list of molecule names
 *   --products  all|mug,tee,…   (default all)
 *   --out-root  dir     (default merch/)   --render-size <px>   --port <n>
 *   --publish           publish ACTIVE (default DRAFT)   --dry-run   --keep-going
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const molecules = String(args.molecules ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
if (molecules.length === 0) {
  console.error('Usage: merch-batch --molecules "dopamine,glucose" [--products all] [--publish] [--dry-run]');
  process.exit(1);
}
const products = String(args.products ?? 'all');
const outRoot = path.resolve(args['out-root'] ?? 'merch');
const dryRun = Boolean(args['dry-run']);
const publish = Boolean(args.publish);
const renderSize = String(args['render-size'] ?? '2600');
let port = Number(args.port ?? 8300);

function slug(v) {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'molecule';
}

/** Fetch a PubChem 3D SDF and convert to XYZ. */
async function fetchXyz(name, outFile) {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/record/SDF/?record_type=3d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PubChem lookup for "${name}" failed (${res.status})`);
  const sdf = await res.text();
  const lines = sdf.split(/\r?\n/);
  const natoms = parseInt(lines[3].slice(0, 3).trim(), 10);
  if (!Number.isFinite(natoms) || natoms < 1) throw new Error(`Could not parse SDF for "${name}"`);
  const atoms = [];
  for (let i = 0; i < natoms; i++) {
    const l = lines[4 + i];
    atoms.push(`${l.slice(31, 34).trim()} ${l.slice(0, 10).trim()} ${l.slice(10, 20).trim()} ${l.slice(20, 30).trim()}`);
  }
  await writeFile(outFile, `${natoms}\n${name}\n${atoms.join('\n')}\n`);
  return natoms;
}

function run(script, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'tools', script), ...scriptArgs], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}

async function main() {
  await mkdir(outRoot, { recursive: true });
  const summary = [];

  for (const name of molecules) {
    const dir = path.join(outRoot, slug(name));
    console.log(`\n══════════ ${name} ══════════`);
    try {
      await mkdir(dir, { recursive: true });
      const xyzFile = path.join(dir, `${slug(name)}.xyz`);
      const natoms = await fetchXyz(name, xyzFile);
      console.log(`[batch] ${name}: ${natoms} atoms from PubChem → ${path.relative(repoRoot, xyzFile)}`);

      await run('merch-render.mjs', [
        '--xyz-file', xyzFile, '--molecule-name', name, '--product', products,
        '--render-size', renderSize, '--port', String(port++), '--out-dir', dir,
      ]);

      const publishArgs = ['--dir', dir];
      if (!dryRun) publishArgs.push('--execute');
      if (publish) publishArgs.push('--publish');
      await run('merch-publish.mjs', publishArgs);

      summary.push({ molecule: name, status: dryRun ? 'rendered+manifest' : (publish ? 'published' : 'draft'), dir });
    } catch (err) {
      console.error(`[batch] ${name} FAILED: ${err.message}`);
      summary.push({ molecule: name, status: 'failed', error: err.message });
      if (!args['keep-going']) { report(summary); process.exit(1); }
    }
  }
  report(summary);
}

function report(summary) {
  console.log('\n══════════ batch summary ══════════');
  for (const s of summary) console.log(`  ${s.status.padEnd(18)} ${s.molecule}${s.error ? `  — ${s.error}` : ''}`);
  const ok = summary.filter((s) => s.status !== 'failed').length;
  console.log(`  ${ok}/${summary.length} molecules processed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
