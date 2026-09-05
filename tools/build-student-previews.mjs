import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Deterministic, static previews from the actual shipped coordinates. No canvas,
// network, random layout, or per-visit rendering. Run explicitly when curating.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'packages/ui/src/gallery-data.json'), 'utf8'));
const collection = fs.readFileSync(path.join(root, 'packages/ui/src/gallery/studentCollection.ts'), 'utf8');
const ids = [...collection.matchAll(/id:\s*["']([^"']+)["']/g)].map(match => match[1]);
if (!ids.length || new Set(ids).size !== ids.length)
  throw new Error('Collection IDs must be non-empty and unique.');
const colors = {
  H: '#f2f0dc',
  C: '#94aaa0',
  N: '#81a9ed',
  O: '#ed927e',
  S: '#e8d283',
};
const radii = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, S: 1.05 };
const out = path.join(root, 'apps/web/public/learn');
fs.mkdirSync(out, { recursive: true });
const receipts = [];
const round = value => Number(value.toFixed(2));
for (const id of ids) {
  const entry = catalog.find(item => item.id === id);
  if (!entry?.available || !entry.file.startsWith('gallery/curated/'))
    throw new Error(`Not a publishable local structure: ${id}`);
  const source = fs
    .readFileSync(path.join(root, 'apps/web/public', entry.file), 'utf8')
    .replace(/\r\n/g, '\n');
  const lines = source.trim().split(/\r?\n/);
  const count = Number(lines[0]);
  const atoms = lines.slice(2, count + 2).map(line => {
    const [el, ...values] = line.trim().split(/\s+/);
    const [x, y, z] = values.map(Number);
    if (![x, y, z].every(Number.isFinite) || !colors[el]) throw new Error(`Invalid atom: ${id}`);
    return {
      el,
      x,
      y,
      z,
      px: x * 0.94 + z * 0.34,
      py: y * 0.94 - (z * 0.94 - x * 0.34) * 0.34,
      depth: z * 0.88 + x * 0.32 + y * 0.34,
    };
  });
  if (atoms.length !== count || Number(entry.atoms.replace(/,/g, '')) !== count)
    throw new Error(`Atom count mismatch: ${id}`);
  const xs = atoms.map(a => a.px),
    ys = atoms.map(a => a.py);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2,
    midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale = Math.min(
    320 / (Math.max(...xs) - Math.min(...xs) + 2),
    210 / (Math.max(...ys) - Math.min(...ys) + 2),
  );
  const point = a => [round(200 + (a.px - midX) * scale), round(135 - (a.py - midY) * scale)];
  const bonds = [];
  for (let i = 0; i < atoms.length; i++)
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i],
        b = atoms[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d > 0.4 && d < (radii[a.el] + radii[b.el]) * 1.2) {
        const [x1, y1] = point(a),
          [x2, y2] = point(b);
        bonds.push(`<path d="M${x1} ${y1}L${x2} ${y2}"/>`);
      }
    }
  const dots = [...atoms]
    .sort((a, b) => a.depth - b.depth)
    .map(a => {
      const [cx, cy] = point(a);
      const r = round(Math.max(2, scale * (a.el === 'H' ? 0.2 : 0.34)));
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${a.el})"/>`;
    });
  const defs = Object.entries(colors)
    .map(
      ([el, color]) =>
        `<radialGradient id="${el}" cx="30%" cy="25%" r="75%"><stop stop-color="#ffffff" stop-opacity=".95"/><stop offset=".35" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".45"/></radialGradient>`,
    )
    .join('');
  const digest = createHash('sha256').update(source).digest('hex');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 270"><title>${entry.title}</title><desc>Projection of ${count} atoms from ${entry.file}. Lines are distance-inferred visual guides, not source bond topology. Source SHA256 ${digest}.</desc><defs>${defs}</defs><rect width="400" height="270" fill="#101a18"/><g stroke="#698478" stroke-width="${round(Math.max(1, scale * 0.12))}" stroke-linecap="round">${bonds.join('')}</g>${dots.join('')}</svg>\n`;
  fs.writeFileSync(path.join(out, `${id}.svg`), svg);
  receipts.push({
    id,
    atoms: count,
    source: entry.file,
    sha256: digest,
    bytes: Buffer.byteLength(svg),
  });
}
console.log(JSON.stringify({ count: receipts.length, previews: receipts }, null, 2));
