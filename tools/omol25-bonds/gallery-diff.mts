#!/usr/bin/env -S npx tsx
/**
 * gallery-diff.mts — the gallery no-op check for lupi-bonds.molecular.v1.
 *
 * Runs over every gallery entry in packages/ui/src/gallery-data.json whose
 * file is `.xyz` with at most 2,000 atoms (and, separately, the other
 * XYZ-content entries: .extxyz and the extended-XYZ .lammpstrj):
 *   - today: the viewer's CPU rule (scene/bondDetectCpu.ts with the radii
 *     table and maxBondLength the viewer passes it), on every frame;
 *   - lupi-bonds.distance.v1 through perceiveBonds, which must give
 *     identical pairs (the gallery looks exactly as it does today);
 *   - the recipe selectBondRecipe picks on auto (distance for every file
 *     that declares no chemistry);
 *   - what lupi-bonds.molecular.v1 would draw instead, as owner evidence
 *     for limiting the recipe to files that declare chemistry.
 *
 *   pnpm exec tsx tools/omol25-bonds/gallery-diff.mts [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOND_KIND_NAMES,
  DEFAULT_BOND_TOLERANCE,
  DISTANCE_RECIPE_ID,
  MOLECULAR_RECIPE_ID,
  MOLECULAR_RECIPE_MAX_ATOMS,
  REMOVAL_REASON,
  perceiveBonds,
  selectBondRecipe,
  type PerceivedBonds,
} from '../../packages/core/src/bonds/index';
import { getElementSpec } from '../../packages/core/src/elements';
import { parseXyzText } from '../../packages/parsers/src/xyzParser';
import { detectBondsCpu } from '../../packages/scene/src/bondDetectCpu';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_FRAMES_CHECKED = 50;
const REASON_NAMES = Object.fromEntries(Object.entries(REMOVAL_REASON).map(([name, code]) => [code, name]));

export interface GalleryFileDiff {
  file: string;
  atoms: number;
  frames: number;
  framesChecked: number;
  autoRecipe: string | null;
  distanceIdenticalToToday: boolean;
  todayBonds: number;
  molecular: {
    identicalPairs: boolean;
    added: number;
    dropped: number;
    kinds: Record<string, number>;
    removedByReason: Record<string, number>;
    clashes: number;
  };
}

export interface GalleryDiff {
  files: number;
  identicalPairs: boolean;
  autoRecipe: Record<string, number>;
  molecularIdenticalFiles: number;
  molecularChangedFiles: Array<{ file: string; added: number; dropped: number; kinds: Record<string, number>; removedByReason: Record<string, number> }>;
  otherXyzContent: { files: number; identicalPairs: boolean; molecularChangedFiles: number };
  details: GalleryFileDiff[];
}

/** The viewer's CPU path today: radii by atomic number in a Float32Array, maxBondLength from ViewerScene. */
function todayPairs(z: Int32Array, positions: Float32Array, natoms: number, tolerance: number): Set<string> {
  const covalentRadii = new Float32Array(119);
  let maxR = 0;
  for (let i = 0; i < natoms; i += 1) {
    const r = getElementSpec(z[i]).radius;
    covalentRadii[z[i]] = r;
    if (r > maxR) maxR = r;
  }
  const out = detectBondsCpu({
    positions,
    types: z,
    natoms,
    maxBondLength: Math.min(6, 2 * (maxR || 1.4) + tolerance + 0.5),
    covalentRadii,
    tolerance,
  });
  const pairs = new Set<string>();
  for (let k = 0; k < out.count; k += 1) pairs.add(`${out.bondPairs[2 * k]}-${out.bondPairs[2 * k + 1]}`);
  return pairs;
}

function pairSet(p: PerceivedBonds): Set<string> {
  const pairs = new Set<string>();
  for (let k = 0; k < p.count; k += 1) pairs.add(`${p.pairs[2 * k]}-${p.pairs[2 * k + 1]}`);
  return pairs;
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

function diffFile(file: string): GalleryFileDiff | null {
  const text = fs.readFileSync(path.join(ROOT, 'apps/web/public', file), 'utf8');
  const { frames } = parseXyzText(text);
  const first = frames[0];
  if (!first || first.natoms > MOLECULAR_RECIPE_MAX_ATOMS) return null;
  const tolerance = DEFAULT_BOND_TOLERANCE;
  let distanceIdenticalToToday = true;
  let todayBonds = 0;
  const framesChecked = Math.min(frames.length, MAX_FRAMES_CHECKED);
  for (let f = 0; f < framesChecked; f += 1) {
    const frame = frames[f];
    const today = todayPairs(frame.types, frame.positions, frame.natoms, tolerance);
    if (f === 0) todayBonds = today.size;
    const distance = perceiveBonds({ atomicNumbers: frame.types, positions: frame.positions, natoms: frame.natoms, tolerance, recipe: DISTANCE_RECIPE_ID });
    if (!sameSet(today, pairSet(distance))) distanceIdenticalToToday = false;
  }
  const input = { atomicNumbers: first.types, positions: first.positions, natoms: first.natoms, tolerance };
  const distance = pairSet(perceiveBonds({ ...input, recipe: DISTANCE_RECIPE_ID }));
  const molecular = perceiveBonds({ ...input, recipe: MOLECULAR_RECIPE_ID });
  const molecularPairs = pairSet(molecular);
  const kinds: Record<string, number> = {};
  for (let k = 0; k < molecular.count; k += 1) kinds[BOND_KIND_NAMES[molecular.kinds[k]]] = (kinds[BOND_KIND_NAMES[molecular.kinds[k]]] ?? 0) + 1;
  const removedByReason: Record<string, number> = {};
  molecular.evidence!.reasons.forEach((reason) => {
    if (reason === REMOVAL_REASON.clash) return;
    removedByReason[REASON_NAMES[reason]] = (removedByReason[REASON_NAMES[reason]] ?? 0) + 1;
  });
  const autoRecipe = selectBondRecipe({
    natoms: first.natoms,
    frameCount: frames.length,
    sourceBondCount: first.bonds.length / 2,
    inferenceAllowed: true,
    periodic: first.periodic,
    chemistry: first.chemistry,
    isOmol25Record: first.sourceRecord?.dataset === 'omol25',
    profile: 'auto',
  });
  return {
    file,
    atoms: first.natoms,
    frames: frames.length,
    framesChecked,
    autoRecipe,
    distanceIdenticalToToday,
    todayBonds,
    molecular: {
      identicalPairs: sameSet(distance, molecularPairs),
      added: [...molecularPairs].filter((pair) => !distance.has(pair)).length,
      dropped: [...distance].filter((pair) => !molecularPairs.has(pair)).length,
      kinds,
      removedByReason,
      clashes: molecular.counts.clashes,
    },
  };
}

/** Gallery entries whose file holds XYZ text of at most 2,000 atoms, split into `.xyz` and the rest. */
function galleryXyzFiles(): { xyz: string[]; other: string[] } {
  const gallery = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/ui/src/gallery-data.json'), 'utf8')) as Array<{ file?: string }>;
  const xyz: string[] = [];
  const other: string[] = [];
  const seen = new Set<string>();
  for (const entry of gallery) {
    const file = entry.file?.replace(/^\//, '');
    if (!file || seen.has(file) || /^https?:/.test(file)) continue;
    seen.add(file);
    const full = path.join(ROOT, 'apps/web/public', file);
    if (!fs.existsSync(full)) continue;
    const head = fs.readFileSync(full, 'utf8').slice(0, 64).split(/\r?\n/)[0].trim();
    if (!/^\d+$/.test(head) || Number(head) > MOLECULAR_RECIPE_MAX_ATOMS) continue;
    (file.endsWith('.xyz') ? xyz : other).push(file);
  }
  return { xyz: xyz.sort(), other: other.sort() };
}

export function runGalleryDiff(): GalleryDiff {
  const { xyz, other } = galleryXyzFiles();
  const details = xyz.map(diffFile).filter((d): d is GalleryFileDiff => d !== null);
  const others = other.map(diffFile).filter((d): d is GalleryFileDiff => d !== null);
  const autoRecipe: Record<string, number> = {};
  for (const d of details) autoRecipe[String(d.autoRecipe)] = (autoRecipe[String(d.autoRecipe)] ?? 0) + 1;
  return {
    files: details.length,
    identicalPairs: details.every((d) => d.distanceIdenticalToToday),
    autoRecipe,
    molecularIdenticalFiles: details.filter((d) => d.molecular.identicalPairs && !d.molecular.kinds.coordination && !d.molecular.kinds.ionicContact).length,
    molecularChangedFiles: details
      .filter((d) => !d.molecular.identicalPairs || d.molecular.kinds.coordination || d.molecular.kinds.ionicContact)
      .map((d) => ({ file: d.file, added: d.molecular.added, dropped: d.molecular.dropped, kinds: d.molecular.kinds, removedByReason: d.molecular.removedByReason })),
    otherXyzContent: {
      files: others.length,
      identicalPairs: others.every((d) => d.distanceIdenticalToToday),
      molecularChangedFiles: others.filter((d) => !d.molecular.identicalPairs).length,
    },
    details,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const diff = runGalleryDiff();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(diff, null, 2));
  } else {
    console.log(`${diff.files} gallery .xyz files ≤ 2,000 atoms; distance recipe identical to today: ${diff.identicalPairs}`);
    console.log(`auto recipe: ${JSON.stringify(diff.autoRecipe)}`);
    console.log(`molecular identical on ${diff.molecularIdenticalFiles}/${diff.files}; changed:`);
    for (const change of diff.molecularChangedFiles) console.log(`  ${change.file}: +${change.added} −${change.dropped} ${JSON.stringify(change.removedByReason)} ${JSON.stringify(change.kinds)}`);
    console.log(`other XYZ-content entries: ${JSON.stringify(diff.otherXyzContent)}`);
  }
}
