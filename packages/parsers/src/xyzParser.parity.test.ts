// Parity against the retired WASM XYZ path: the same bytes must produce the
// same frames (types, ids, positions, box) so route-level behavior is stable.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initSync, parseXyzFile as wasmParseXyz } from '../pkg/atlas_parsers.js';
import { parseXyzText } from './xyzParser';

initSync({ module: readFileSync(resolve(__dirname, '../pkg/atlas_parsers_bg.wasm')) });

function lattice(n: number): string {
  const lines: string[] = [];
  const symbols = ['Cu', 'Ni', 'Fe', '8'];
  let k = 0;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    lines.push(`${symbols[k++ % symbols.length]} ${(x * 3.615).toFixed(4)} ${(y * 3.615 - 1.25).toFixed(3)} ${(z * 3.615).toExponential(5)}`);
  }
  return `${lines.length}\n12\n${lines.join('\n')}\n${lines.length}\nsecond\n${lines.join('\n')}\n`;
}

describe('xyzParser parity with the WASM parser', () => {
  it('matches frame count, timesteps, ids, types, positions and padded box', () => {
    const text = lattice(6);
    const ours = parseXyzText(text).frames;
    const theirs = wasmParseXyz(text) as Array<Record<string, any>>;
    expect(ours).toHaveLength(theirs.length);
    for (let f = 0; f < ours.length; f++) {
      expect(ours[f].timestep).toBe(Number(theirs[f].timestep));
      expect(ours[f].natoms).toBe(theirs[f].natoms);
      expect(Array.from(ours[f].types)).toEqual(Array.from(theirs[f].types));
      expect(Array.from(ours[f].ids)).toEqual(Array.from(theirs[f].ids));
      expect(Array.from(ours[f].positions)).toEqual(Array.from(Float32Array.from(theirs[f].positions)));
      expect(Array.from(ours[f].boxBounds)).toEqual(Array.from(theirs[f].box_bounds ?? theirs[f].boxBounds));
    }
  });
});
