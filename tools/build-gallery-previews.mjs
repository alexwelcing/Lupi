#!/usr/bin/env node
/**
 * build-gallery-previews.mjs — deterministic static previews for the gallery.
 *
 * Extends tools/build-student-previews.mjs (which stays authoritative for the
 * twelve student entries) to every other locally shipped `.xyz` gallery entry
 * under the atom cap. Same projection, same source-SHA binding in the SVG
 * description, a wider CPK-style palette. No canvas, network, or randomness.
 *
 * Writes apps/web/public/learn/<id>.svg and packages/ui/src/gallery/previews.json,
 * the manifest the landing index and the Library read to decide which entries
 * have art. Run explicitly when curating:
 *
 *   node tools/build-gallery-previews.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'packages/ui/src/gallery-data.json'), 'utf8'));
const studentSource = fs.readFileSync(path.join(root, 'packages/ui/src/gallery/studentCollection.ts'), 'utf8');
const studentIds = new Set([...studentSource.matchAll(/id:\s*["']([^"']+)["']/g)].map((match) => match[1]));
const ATOM_CAP = 1200;
const out = path.join(root, 'apps/web/public/learn');
fs.mkdirSync(out, { recursive: true });

const colors = {
  H: '#f2f0dc', C: '#94aaa0', N: '#81a9ed', O: '#ed927e', S: '#e8d283', P: '#f0a45a', F: '#9be07c', Cl: '#7fdc7f',
  Br: '#c77a63', I: '#a862c9', Na: '#b58ce8', K: '#a05cd0', Mg: '#9ee06a', Ca: '#7ee85a', Li: '#d0a0ff', Al: '#c7c7c7',
  Si: '#e9c49a', Fe: '#d98060', Cu: '#d09a5a', Zn: '#9ea0c4', Ni: '#7fc08f', Ti: '#c3c6cc', Au: '#e8cf6a', Ag: '#d6d6d6',
  Pt: '#cfd4dc', B: '#f2b6a7', Se: '#f3b26b',
};
const radii = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, S: 1.05, P: 1.07, F: 0.57, Cl: 1.02, Br: 1.2, I: 1.39, Na: 1.66, K: 2.03, Mg: 1.41, Ca: 1.76, Li: 1.28, Al: 1.21, Si: 1.11, B: 0.84, Se: 1.2 };
const FALLBACK_COLOR = '#b9c2bd';
const round = (value) => Number(value.toFixed(2));

function parseFirstFrame(source) {
  const lines = source.split(/\r?\n/);
  const count = Number(lines[0]);
  if (!Number.isInteger(count) || count <= 0) return null;
  const atoms = [];
  for (const line of lines.slice(2, count + 2)) {
    const [el, ...values] = line.trim().split(/\s+/);
    const [x, y, z] = values.map(Number);
    if (![x, y, z].every(Number.isFinite) || !/^[A-Z][a-z]?$/.test(el ?? '')) return null;
    atoms.push({ el, x, y, z, px: x * 0.94 + z * 0.34, py: y * 0.94 - (z * 0.94 - x * 0.34) * 0.34, depth: z * 0.88 + x * 0.32 + y * 0.34 });
  }
  return atoms.length === count ? atoms : null;
}

const receipts = [];
const skipped = [];
for (const entry of catalog) {
  if (studentIds.has(entry.id) || !entry.available || !entry.file || /^https?:/.test(entry.file) || !/\.xyz$/i.test(entry.file)) continue;
  const declared = Number(String(entry.atoms).replace(/,/g, ''));
  if (declared > ATOM_CAP) {
    skipped.push({ id: entry.id, reason: `over ${ATOM_CAP} atoms` });
    continue;
  }
  const filePath = path.join(root, 'apps/web/public', entry.file.replace(/^\/+/, ''));
  const source = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const atoms = parseFirstFrame(source);
  if (!atoms || atoms.length !== declared) {
    skipped.push({ id: entry.id, reason: atoms ? `declared ${declared} atoms, file has ${atoms.length}` : 'not a plain element-symbol XYZ' });
    continue;
  }
  const xs = atoms.map((a) => a.px);
  const ys = atoms.map((a) => a.py);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale = Math.min(320 / (Math.max(...xs) - Math.min(...xs) + 2), 210 / (Math.max(...ys) - Math.min(...ys) + 2));
  const point = (a) => [round(200 + (a.px - midX) * scale), round(135 - (a.py - midY) * scale)];
  const bonds = [];
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i];
      const b = atoms[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d > 0.4 && d < ((radii[a.el] ?? 0.9) + (radii[b.el] ?? 0.9)) * 1.2) {
        const [x1, y1] = point(a);
        const [x2, y2] = point(b);
        bonds.push(`<path d="M${x1} ${y1}L${x2} ${y2}"/>`);
      }
    }
  }
  const present = [...new Set(atoms.map((a) => a.el))];
  const dots = [...atoms]
    .sort((a, b) => a.depth - b.depth)
    .map((a) => {
      const [cx, cy] = point(a);
      const r = round(Math.max(1.4, scale * (a.el === 'H' ? 0.2 : 0.34)));
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${a.el})"/>`;
    });
  const defs = present
    .map((el) => {
      const color = colors[el] ?? FALLBACK_COLOR;
      return `<radialGradient id="${el}" cx="30%" cy="25%" r="75%"><stop stop-color="#ffffff" stop-opacity=".95"/><stop offset=".35" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".45"/></radialGradient>`;
    })
    .join('');
  const digest = createHash('sha256').update(source).digest('hex');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 270"><title>${entry.title.replace(/[<>&]/g, '')}</title><desc>Projection of ${atoms.length} atoms from ${entry.file}. Lines are distance-inferred visual guides, not source bond topology. Source SHA256 ${digest}.</desc><defs>${defs}</defs><rect width="400" height="270" fill="#101a18"/><g stroke="#698478" stroke-width="${round(Math.max(0.8, scale * 0.12))}" stroke-linecap="round">${bonds.join('')}</g>${dots.join('')}</svg>\n`;
  fs.writeFileSync(path.join(out, `${entry.id}.svg`), svg);
  receipts.push({ id: entry.id, atoms: atoms.length, source: entry.file, sha256: digest, bytes: Buffer.byteLength(svg) });
}

const ids = [...studentIds, ...receipts.map((r) => r.id)].filter((id) => fs.existsSync(path.join(out, `${id}.svg`))).sort();
fs.writeFileSync(
  path.join(root, 'packages/ui/src/gallery/previews.json'),
  `${JSON.stringify({ generatedBy: 'tools/build-student-previews.mjs + tools/build-gallery-previews.mjs', atomCap: ATOM_CAP, ids }, null, 2)}\n`,
);
console.log(JSON.stringify({ generated: receipts.length, skipped, manifest: ids.length, largestBytes: Math.max(0, ...receipts.map((r) => r.bytes)) }, null, 2));
