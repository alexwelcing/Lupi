#!/usr/bin/env node
/**
 * build-z1-gallery-extxyz.mjs
 *
 * Converts the four Z1 golden paths' image coordinates (16, 0, 14, 27) from
 * the nebDFT2k barrier lock into extended-XYZ trajectories the Lupi viewer
 * loads through the normal gallery/`?sim=` flow. One file per path, one XYZ
 * frame per zero-based NEB image, in source image order.
 *
 * Each frame comment carries the extended-XYZ `Lattice`/`pbc` keys plus
 * `image`, `path_id`, and the source file name so the geometry stays
 * source-bound. The WASM XYZ parser reads atoms/positions and ignores the
 * comment keys; the lattice is preserved here for provenance and future
 * cell-aware rendering.
 *
 * Source (local, no network):
 *   lupine-rhizo data/candidates/z1_nebdft2k_barriers.lock.json
 *     sha256:192fe54a5579cc421f6644d5d76fb442c6dfb985f014dc4741549e29052efb68
 *
 * Usage:
 *   node tools/build-z1-gallery-extxyz.mjs \
 *     [--rhizo ../lupine-rhizo] [--out apps/web/public/gallery/research/z1]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const RHIZO = path.resolve(flag('rhizo', path.join(os.homedir(), 'Dev/lupine/lupine-rhizo')));
const OUT_DIR = path.resolve(flag('out', 'apps/web/public/gallery/research/z1'));
const LOCK = path.join(RHIZO, 'data/candidates/z1_nebdft2k_barriers.lock.json');

const GOLDEN_PATH_INDICES = [16, 0, 14, 27];

const fmt = (v) => {
  // Plain decimal, 8 fractional digits — no exponent notation in XYZ columns.
  const s = Number(v).toFixed(8);
  return s === '-0.00000000' ? '0.00000000' : s;
};

const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const pathIndex of GOLDEN_PATH_INDICES) {
  const p = lock.paths[pathIndex];
  if (!p) throw new Error(`lock file has no paths[${pathIndex}]`);
  const images = p.input_images;
  if (!Array.isArray(images) || images.length < 2) {
    throw new Error(`paths[${pathIndex}] (${p.path_id}): expected ≥2 input_images`);
  }
  const natoms = images[0].symbols.length;
  const chunks = [];
  images.forEach((img, imageIndex) => {
    if (img.symbols.length !== natoms || img.positions_angstrom.length !== natoms) {
      throw new Error(`paths[${pathIndex}] image ${imageIndex}: ragged symbols/positions`);
    }
    const lattice = img.cell_angstrom.flat().map(fmt).join(' ');
    const pbc = (img.pbc ?? [true, true, true]).map((b) => (b ? 'T' : 'F')).join(' ');
    const comment =
      `Lattice="${lattice}" Properties=species:S:1:pos:R:3 pbc="${pbc}" ` +
      `image=${imageIndex} path_id=${p.path_id} chemical_system=${p.chemical_system} ` +
      `source=z1_nebdft2k_barriers.lock.json`;
    const lines = [String(natoms), comment];
    for (let a = 0; a < natoms; a++) {
      const [x, y, z] = img.positions_angstrom[a];
      lines.push(`${img.symbols[a]} ${fmt(x)} ${fmt(y)} ${fmt(z)}`);
    }
    chunks.push(lines.join('\n'));
  });
  const out = path.join(OUT_DIR, `z1-path-${pathIndex}.extxyz`);
  fs.writeFileSync(out, chunks.join('\n') + '\n');
  console.log(
    `z1-path-${pathIndex}.extxyz: ${images.length} images × ${natoms} atoms ` +
    `(${p.path_id}, ${p.chemical_system})`,
  );
}
