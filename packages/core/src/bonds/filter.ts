import { BOND_KIND, type DrawnBonds, type PerceivedBonds } from './types';

/**
 * The bonds the viewer draws: drops pairs touching a hidden atom type and,
 * when contacts are off, ionic contacts. Every consumer that shows drawn
 * bonds uses this one filter, so the view, atom card, MCP and exports agree.
 * `sourceIndex[k]` is the index of drawn bond k in `p`.
 */
export function filterPerceivedBonds(
  p: PerceivedBonds,
  opts: { types: ArrayLike<number>; hiddenTypes?: ReadonlySet<number>; showContacts: boolean },
): DrawnBonds {
  const hidden = opts.hiddenTypes && opts.hiddenTypes.size > 0 ? opts.hiddenTypes : null;
  const keep: number[] = [];
  for (let k = 0; k < p.count; k += 1) {
    if (!opts.showContacts && p.kinds[k] === BOND_KIND.ionicContact) continue;
    if (hidden && (hidden.has(opts.types[p.pairs[2 * k]]) || hidden.has(opts.types[p.pairs[2 * k + 1]]))) continue;
    keep.push(k);
  }
  const count = keep.length;
  const pairs = new Int32Array(count * 2);
  const kinds = new Uint8Array(count);
  const distances = new Float32Array(count);
  const excess = new Float32Array(count);
  const sourceIndex = new Int32Array(count);
  keep.forEach((k, m) => {
    pairs[2 * m] = p.pairs[2 * k];
    pairs[2 * m + 1] = p.pairs[2 * k + 1];
    kinds[m] = p.kinds[k];
    distances[m] = p.distances[k];
    excess[m] = p.excess[k];
    sourceIndex[m] = k;
  });
  return { count, pairs, kinds, distances, excess, sourceIndex };
}
