#!/usr/bin/env node
/**
 * build-hero-data.mjs: the C60 geometry behind the home page's ink buckyball.
 *
 * Reads apps/web/public/gallery/curated/c60_buckyball.xyz and writes
 * packages/ui/src/landing/hero/c60Hero.data.ts: atom positions centred on the
 * bounds centre (the viewer's fit target, so the hero's pose carries into 3D),
 * the 90 bonds (d <= 1.6 Å), and the turntable the hero spins on.
 *
 * The turntable: the hero turns about world +Y (the viewer's camera up) and
 * clicks onto faces. The file's orientation puts at most 3 or 4 face normals
 * within 2° of any one azimuth circle, which leaves 110°+ gaps between
 * detents (a release would swing a third of a turn), so a detent is any
 * hexagon or pentagon whose normal lies within BAND_DEG of the circle, and it
 * stores that face's exact elevation: a release lands dead face-on with a
 * small nod. The circle's elevation is the one in [0°, 40°] (0.25° steps)
 * whose detents leave the smallest largest azimuth gap; ties go to more
 * detents, then to the elevation nearest 15°.
 *
 *   node tools/build-hero-data.mjs            # write the file
 *   node tools/build-hero-data.mjs --check    # exit 1 when the file is stale
 *
 * Deterministic: no network, no randomness, no TypeScript imports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'apps/web/public/gallery/curated/c60_buckyball.xyz';
const TARGET = 'packages/ui/src/landing/hero/c60Hero.data.ts';
const BOND_MAX = 1.6;
const EL_MAX_DEG = 40;
const EL_STEP_DEG = 0.25;
const EL_PREFERRED_DEG = 15;
const BAND_DEG = 12;
const OPENING_NEAR_DEG = 30;

const DEG = Math.PI / 180;
const round = (value, digits = 4) => {
  const r = Number(value.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

/** The first frame of a plain element-symbol XYZ (same reader as build-gallery-previews.mjs). */
function parseFirstFrame(source) {
  const lines = source.split(/\r?\n/);
  const count = Number(lines[0]);
  if (!Number.isInteger(count) || count <= 0) return null;
  const atoms = [];
  for (const line of lines.slice(2, count + 2)) {
    const [el, ...values] = line.trim().split(/\s+/);
    const [x, y, z] = values.map(Number);
    if (![x, y, z].every(Number.isFinite) || !/^[A-Z][a-z]?$/.test(el ?? '')) return null;
    atoms.push({ el, x, y, z });
  }
  return atoms.length === count ? atoms : null;
}

const atoms = parseFirstFrame(fs.readFileSync(path.join(root, SOURCE), 'utf8'));
if (!atoms || atoms.length !== 60 || atoms.some((atom) => atom.el !== 'C')) {
  throw new Error(`${SOURCE}: expected 60 carbon atoms`);
}

// Centre on the bounds centre: the viewer fits its camera target there.
const centre = ['x', 'y', 'z'].map((axis) => {
  const values = atoms.map((atom) => atom[axis]);
  return (Math.min(...values) + Math.max(...values)) / 2;
});
const points = atoms.map((atom) => [atom.x - centre[0], atom.y - centre[1], atom.z - centre[2]]);
const radius = Math.max(...points.map((p) => Math.hypot(p[0], p[1], p[2])));

// Bonds and the 3-regular graph.
const bonds = [];
const neighbours = points.map(() => []);
for (let i = 0; i < points.length; i += 1) {
  for (let j = i + 1; j < points.length; j += 1) {
    const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1], points[i][2] - points[j][2]);
    if (d <= BOND_MAX) {
      bonds.push(i, j);
      neighbours[i].push(j);
      neighbours[j].push(i);
    }
  }
}
if (bonds.length !== 180 || neighbours.some((list) => list.length !== 3)) {
  throw new Error(`expected 90 bonds on a 3-regular graph, got ${bonds.length / 2}`);
}
const adjacent = (a, b) => neighbours[a].includes(b);

// Faces: the chordless 5- and 6-cycles, each found once (smallest index first,
// then the smaller of its two neighbours on the ring).
const faces = [];
const seen = new Set();
function walk(path) {
  const last = path[path.length - 1];
  for (const next of neighbours[last]) {
    if (next === path[0] && path.length >= 5) {
      const key = [...path].sort((a, b) => a - b).join(',');
      const chordless = path.every((a, i) => path.every((b, j) => {
        const gap = Math.abs(i - j);
        return gap <= 1 || gap === path.length - 1 || !adjacent(a, b);
      }));
      if (chordless && !seen.has(key)) {
        seen.add(key);
        faces.push([...path]);
      }
      continue;
    }
    if (path.length >= 6 || next < path[0] || path.includes(next)) continue;
    path.push(next);
    walk(path);
    path.pop();
  }
}
for (let start = 0; start < points.length; start += 1) walk([start]);
const pentagons = faces.filter((face) => face.length === 5).length;
const hexagons = faces.filter((face) => face.length === 6).length;
if (pentagons !== 12 || hexagons !== 20) throw new Error(`expected 12 pentagons and 20 hexagons, got ${pentagons} and ${hexagons}`);

const faceDirs = faces.map((face) => {
  const c = [0, 0, 0];
  for (const index of face) for (let k = 0; k < 3; k += 1) c[k] += points[index][k] / face.length;
  const length = Math.hypot(c[0], c[1], c[2]);
  const dir = c.map((value) => value / length);
  return {
    label: face.length === 6 ? 'Hexagon' : 'Pentagon',
    elevation: Math.asin(Math.max(-1, Math.min(1, dir[1]))),
    // viewDir = (cos el·sin az, sin el, cos el·cos az)
    azimuth: Math.atan2(dir[0], dir[2]),
  };
});

// The turntable: the circle whose band of faces leaves the smallest gap.
let best = null;
for (let step = 0; step * EL_STEP_DEG <= EL_MAX_DEG + 1e-9; step += 1) {
  const elDeg = step * EL_STEP_DEG;
  const onCircle = faceDirs
    .filter((face) => Math.abs(face.elevation - elDeg * DEG) <= BAND_DEG * DEG)
    .sort((a, b) => a.azimuth - b.azimuth);
  if (onCircle.length < 2) continue;
  let gap = 0;
  for (let i = 0; i < onCircle.length; i += 1) {
    const next = i + 1 < onCircle.length ? onCircle[i + 1].azimuth : onCircle[0].azimuth + 2 * Math.PI;
    gap = Math.max(gap, next - onCircle[i].azimuth);
  }
  gap = Math.round(gap / DEG * 1000) / 1000; // degrees, rounded so float noise cannot break ties
  const tie = Math.abs(elDeg - EL_PREFERRED_DEG);
  if (
    !best ||
    gap < best.gap ||
    (gap === best.gap && (onCircle.length > best.onCircle.length || (onCircle.length === best.onCircle.length && tie < best.tie)))
  ) {
    best = { elDeg, gap, tie, onCircle };
  }
}
const wrap = (angle) => {
  let a = angle % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
};
const detents = best.onCircle
  .map((face) => ({ azimuth: wrap(face.azimuth), elevation: face.elevation, label: face.label }))
  .sort((a, b) => a.azimuth - b.azimuth);
const hexDetents = detents.filter((detent) => detent.label === 'Hexagon');
if (hexDetents.length === 0) throw new Error('no hexagon on the turntable circle');
const opening = hexDetents.reduce((nearest, detent) =>
  Math.abs(wrap(detent.azimuth - OPENING_NEAR_DEG * DEG)) < Math.abs(wrap(nearest.azimuth - OPENING_NEAR_DEG * DEG)) ? detent : nearest,
);

const list = (values, perLine) => {
  const lines = [];
  for (let i = 0; i < values.length; i += perLine) lines.push(`    ${values.slice(i, i + perLine).join(', ')},`);
  return lines.join('\n');
};
const output = `// Generated by tools/build-hero-data.mjs from ${SOURCE}. Do not edit.
// Regenerate: node tools/build-hero-data.mjs
//
// C60 centred on its bounds centre (the viewer's fit target), Å. The
// turntable at ${best.elDeg}° passes ${detents.length} faces within ${BAND_DEG}° (${detents.filter((d) => d.label === 'Hexagon').length} hexagons, ${detents.filter((d) => d.label === 'Pentagon').length} pentagons;
// largest gap ${best.gap.toFixed(1)}°). Angles are radians: camera azimuth about world +Y
// and elevation, viewDir = (cos el·sin az, sin el, cos el·cos az).

export interface C60HeroDetent {
  azimuth: number;
  /** The face's own elevation: a detent is exactly face-on. */
  elevation: number;
  label: 'Hexagon' | 'Pentagon';
}

export interface C60HeroData {
  /** x, y, z per atom (Å, bounds-centred). */
  positions: number[];
  /** Atom index pairs. */
  bonds: number[];
  /** Largest atom distance from the centre (Å). */
  radius: number;
  /** The turntable circle's elevation (rad); each detent carries its face's own. */
  elevation: number;
  /** Face-on azimuths along the turntable, ascending in (−π, π]. */
  detents: C60HeroDetent[];
  /** The hexagon detent nearest ${OPENING_NEAR_DEG}° (its elevation is openingElevation): the pose the page opens on. */
  openingAzimuth: number;
  openingElevation: number;
}

export const C60_HERO: C60HeroData = {
  positions: [
${list(points.flat().map((value) => round(value)), 12)}
  ],
  bonds: [
${list(bonds, 20)}
  ],
  radius: ${round(radius)},
  elevation: ${round(best.elDeg * DEG, 6)},
  detents: [
${detents.map((detent) => `    { azimuth: ${round(detent.azimuth, 6)}, elevation: ${round(detent.elevation, 6)}, label: '${detent.label}' },`).join('\n')}
  ],
  openingAzimuth: ${round(opening.azimuth, 6)},
  openingElevation: ${round(opening.elevation, 6)},
};
`;

const target = path.join(root, TARGET);
if (process.argv.includes('--check')) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (current !== output) {
    console.error(`${TARGET} is stale; run node tools/build-hero-data.mjs`);
    process.exit(1);
  }
  console.log(`${TARGET} is up to date`);
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, output);
  console.log(
    `wrote ${TARGET}: turntable ${best.elDeg}°, ${detents.length} detents, largest gap ${best.gap.toFixed(1)}° ` +
      `(${detents.map((d) => `${d.label[0]}${(d.azimuth / DEG).toFixed(0)}/${(d.elevation / DEG).toFixed(0)}`).join(' ')}), ` +
      `opening ${(opening.azimuth / DEG).toFixed(1)}°/${(opening.elevation / DEG).toFixed(1)}°`,
  );
}
