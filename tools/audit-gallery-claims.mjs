#!/usr/bin/env node
/**
 * audit-gallery-claims.mjs — verify every gallery card's atom/frame claims
 * against the actual committed asset.
 *
 * Cards carry human-entered `atoms` / `frames` labels; assets evolve, get
 * regenerated, or get decimated, and the labels drift. A card claiming
 * "1M atoms" over a 953k file erodes exactly the trust a research viewer
 * runs on. This tool parses each local asset's real first-frame atom count
 * and frame count and reports every discrepancy.
 *
 * Usage:
 *   node tools/audit-gallery-claims.mjs           # report only
 *   node tools/audit-gallery-claims.mjs --write   # fix labels in gallery-data.json
 *
 * Exit code 1 when mismatches (or missing local assets) remain, so CI can
 * gate on it.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const galleryDataPath = path.join(repoRoot, 'packages/ui/src/gallery-data.json');
const publicRoot = path.join(repoRoot, 'apps/web/public');
const WRITE = process.argv.includes('--write');

// ── Asset readers ───────────────────────────────────────────────────

function readMaybeGz(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
  return buf;
}

function countDump(text) {
  let frames = 0;
  let firstAtoms = null;
  let idx = 0;
  while ((idx = text.indexOf('ITEM: TIMESTEP', idx)) !== -1) {
    frames++;
    idx += 14;
    if (firstAtoms === null) {
      const m = text.slice(idx, idx + 4096).match(/ITEM:\s*NUMBER OF ATOMS\s*\n\s*(\d+)/);
      if (m) firstAtoms = parseInt(m[1], 10);
    }
  }
  return { atoms: firstAtoms, frames };
}

function countXyz(text) {
  // XYZ blocks: count line, comment line, then that many atom lines.
  const lines = text.split('\n');
  let i = 0;
  let frames = 0;
  let firstAtoms = null;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '') { i++; continue; }
    const n = Number(line);
    if (!Number.isInteger(n) || n <= 0) break;
    if (firstAtoms === null) firstAtoms = n;
    frames++;
    i += n + 2;
  }
  return { atoms: firstAtoms, frames };
}

function countDataFile(text) {
  const m = text.match(/^\s*(\d+)\s+atoms\b/m);
  return { atoms: m ? parseInt(m[1], 10) : null, frames: 1 };
}

function countGlimbin(filePath) {
  // Header layout per packages/core/src/glimbin.ts: magic 'GLIM', then
  // u16 version, u16 flags, u32 totalFrames, u32 atomsPerFrame at fixed
  // offsets (4, 6, 8, 12), little-endian.
  const fd = fs.openSync(filePath, 'r');
  const head = Buffer.alloc(64);
  fs.readSync(fd, head, 0, 64, 0);
  fs.closeSync(fd);
  if (head.toString('ascii', 0, 4) !== 'GLIM') return { atoms: null, frames: null };
  return {
    atoms: head.readUInt32LE(12),
    frames: head.readUInt32LE(8),
  };
}

function countMlipJson(text) {
  try {
    const artifact = JSON.parse(text);
    const frames = artifact.frames ?? artifact.trajectory?.frames;
    if (Array.isArray(frames) && frames.length > 0) {
      const f0 = frames[0];
      const atoms = f0.natoms
        ?? (Array.isArray(f0.positions_angstrom) ? f0.positions_angstrom.length : null)
        ?? (Array.isArray(f0.positions) ? Math.floor(f0.positions.length / 3) : null)
        ?? (Array.isArray(f0.species) ? f0.species.length : null);
      return { atoms, frames: frames.length };
    }
  } catch { /* fall through */ }
  return { atoms: null, frames: null };
}

function looksLikeXyz(text) {
  const lines = text.split('\n', 3);
  return lines.length >= 1 && /^\d+\s*$/.test(lines[0]);
}

function actualCounts(filePath) {
  const ext = filePath.replace(/\.gz$/i, '').toLowerCase();
  if (ext.endsWith('.glimbin')) return countGlimbin(filePath);
  const text = readMaybeGz(filePath).toString('utf-8');
  // Content beats extension — several gallery fixtures are extended-XYZ
  // content saved as *.lammpstrj (the viewer sniffs the same way).
  if (text.startsWith('ITEM: TIMESTEP')) return countDump(text);
  if (ext.endsWith('.json')) return countMlipJson(text);
  if (looksLikeXyz(text)) return countXyz(text);
  if (ext.endsWith('.lammpstrj') || ext.endsWith('.dump') || /\/dump\./.test(ext)) return countDump(text);
  if (ext.endsWith('.data') || ext.endsWith('.lmp')) return countDataFile(text);
  return { atoms: null, frames: null };
}

// ── Label parsing / formatting ──────────────────────────────────────

function parseCountLabel(label) {
  if (label === undefined || label === null) return null;
  const s = String(label).trim().toLowerCase().replace(/[~>≈+]/g, '').trim();
  const m = s.match(/^([\d.,]+)\s*([km]?)/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1;
  return Math.round(num * mult);
}

const fmt = (n) => n.toLocaleString('en-US');

// ── Audit ───────────────────────────────────────────────────────────

const entries = JSON.parse(fs.readFileSync(galleryDataPath, 'utf-8'));
const report = { ok: 0, fixed: [], mismatches: [], missing: [], remote: [], unparsed: [] };

for (const entry of entries) {
  // Route cards (dedicated pages, e.g. the billion-atom testbed) have no
  // asset file — their claims are the page's own accounting.
  if (entry.route) continue;
  if (entry.file.startsWith('http://') || entry.file.startsWith('https://')) {
    report.remote.push(entry.id);
    continue;
  }
  const assetPath = path.join(publicRoot, entry.file);
  if (!fs.existsSync(assetPath)) {
    report.missing.push({ id: entry.id, file: entry.file, available: entry.available });
    continue;
  }

  let actual;
  try {
    actual = actualCounts(assetPath);
  } catch (err) {
    report.unparsed.push({ id: entry.id, file: entry.file, error: String(err).slice(0, 80) });
    continue;
  }
  if (actual.atoms === null) {
    report.unparsed.push({ id: entry.id, file: entry.file, error: 'format not recognized' });
    continue;
  }

  const claimedAtoms = parseCountLabel(entry.atoms);
  const claimedFrames = parseCountLabel(entry.frames);
  const atomsWrong = claimedAtoms !== null && claimedAtoms !== actual.atoms;
  const framesWrong = actual.frames !== null && claimedFrames !== null && claimedFrames !== actual.frames;

  if (!atomsWrong && !framesWrong) {
    report.ok++;
    continue;
  }

  const issue = {
    id: entry.id,
    file: entry.file,
    atoms: { claimed: entry.atoms, actual: actual.atoms },
    frames: { claimed: entry.frames, actual: actual.frames },
    atomsWrong,
    framesWrong,
  };
  report.mismatches.push(issue);

  if (WRITE) {
    if (atomsWrong) entry.atoms = fmt(actual.atoms);
    if (framesWrong) entry.frames = String(actual.frames);
    report.fixed.push(entry.id);
  }
}

if (WRITE && report.fixed.length > 0) {
  fs.writeFileSync(galleryDataPath, JSON.stringify(entries, null, 2) + '\n');
}

// ── Output ──────────────────────────────────────────────────────────

console.log(`\nGallery claims audit — ${entries.length} entries`);
console.log(`  accurate: ${report.ok}`);
console.log(`  remote-only (not audited): ${report.remote.length}${report.remote.length ? ' — ' + report.remote.join(', ') : ''}`);

if (report.mismatches.length > 0) {
  console.log(`\n  MISMATCHED CLAIMS: ${report.mismatches.length}`);
  for (const m of report.mismatches) {
    const parts = [];
    if (m.atomsWrong) parts.push(`atoms claimed "${m.atoms.claimed}" actual ${fmt(m.atoms.actual)}`);
    if (m.framesWrong) parts.push(`frames claimed "${m.frames.claimed}" actual ${m.frames.actual}`);
    console.log(`    ${m.id}  (${m.file})\n      ${parts.join('; ')}`);
  }
}
if (report.missing.length > 0) {
  console.log(`\n  MISSING LOCAL ASSETS: ${report.missing.length}`);
  for (const m of report.missing) {
    console.log(`    ${m.id}  (${m.file})  available=${m.available}`);
  }
}
if (report.unparsed.length > 0) {
  console.log(`\n  UNPARSEABLE: ${report.unparsed.length}`);
  for (const u of report.unparsed) console.log(`    ${u.id}  (${u.file}) — ${u.error}`);
}
if (WRITE && report.fixed.length > 0) {
  console.log(`\n  WROTE corrected labels for: ${report.fixed.join(', ')}`);
}

const failures = report.mismatches.length + report.missing.filter((m) => m.available).length;
process.exit(WRITE ? 0 : failures > 0 ? 1 : 0);
