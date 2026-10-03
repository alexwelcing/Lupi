import { omol25Collection, omolStructurePath, omolTitle } from '@atlas/core/omol25';
import { openMolecule } from '../viewer/openMolecule';
import type { ViewerOpenResult } from '../viewer/openTypes';
import { useStore } from '../store';
import { scienceDataUrl } from './dataEndpoints';
import { formulaFromTypes } from './pubchemLoad';

/** Every row of the complete neutral training split opens through the edge by its index. */
export const OMOL25_RANDOM_ROWS = omol25Collection('neutral-train').sourceRows;
export const OMOL25_RANDOM_FAILURE = 'OMol25’s host didn’t answer. Try again, or open a pick.';

const UINT32_RANGE = 2 ** 32;

function cryptoUint32(): number {
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return value[0];
}

/**
 * A uniform integer in [0, n) from 32-bit draws, rejecting the top sliver of
 * the range so no row is likelier than another (plain `% n` would favour the
 * first rows of a 34.3M range).
 */
export function uniformRandomInt(n: number, draw: () => number = cryptoUint32): number {
  if (!Number.isSafeInteger(n) || n <= 0 || n > UINT32_RANGE) throw new RangeError(`n must be an integer in (0, 2^32], got ${n}`);
  const limit = UINT32_RANGE - (UINT32_RANGE % n);
  for (;;) {
    const value = draw();
    if (value < limit) return value % n;
  }
}

/** The edge route for one random neutral-train row; no index is downloaded. */
export function randomOmol25Url(row: number = uniformRandomInt(OMOL25_RANDOM_ROWS)): string {
  return scienceDataUrl(omolStructurePath('neutral-train', row));
}

/**
 * Open one random structure from the 34.3M-row neutral training split. One
 * attempt: a failure names the host and leaves the next try to the visitor.
 */
export async function openRandomOmol25Molecule(): Promise<ViewerOpenResult> {
  const url = randomOmol25Url();
  const result = await openMolecule({ kind: 'url', url, history: 'push' });
  if (!result.ok) {
    // A newer open replaced this one: nothing failed.
    if (/superseded/i.test(result.message)) return result;
    useStore.getState().setError(OMOL25_RANDOM_FAILURE);
    return { ok: false, message: OMOL25_RANDOM_FAILURE };
  }
  const file = useStore.getState().file;
  const frame = file?.trajectory.frames[0];
  if (file?.sourceUrl === url && frame) {
    const name = omolTitle(formulaFromTypes(frame.types));
    useStore.setState({ file: { ...file, name } });
    return { ...result, fileName: name };
  }
  return result;
}
