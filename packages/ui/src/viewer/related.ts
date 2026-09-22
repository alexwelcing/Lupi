/**
 * What to see next: a few gallery molecules near the one on screen, offered
 * the moment it has landed. Same domain first, then shared elements, then a
 * similar size; never the one already showing. Deterministic, local, no
 * network, so the suggestions are there before anyone asks.
 */
import { LOCAL_MOLECULES } from '../landing/moleculeIndex';
import { galleryPool, type SwitchCandidate } from '../switcher/switchIndex';

export interface RelatedQuery {
  /** The gallery id on screen, when it is a gallery molecule. */
  currentId?: string | null;
  /** Element symbols on screen, most numerous first. */
  elements: string[];
  atoms: number;
  limit?: number;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const symbol of setA) if (setB.has(symbol)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

export function relatedMolecules({ currentId, elements, atoms, limit = 3 }: RelatedQuery): SwitchCandidate[] {
  const domainOf = new Map(LOCAL_MOLECULES.map((molecule) => [`gallery:${molecule.id}`, molecule.domain]));
  const currentKey = currentId ? `gallery:${currentId}` : null;
  const currentDomain = currentKey ? domainOf.get(currentKey) : undefined;
  return galleryPool()
    .filter((candidate) => candidate.key !== currentKey)
    .map((candidate, index) => {
      let score = 0;
      if (currentDomain && domainOf.get(candidate.key) === currentDomain) score += 2;
      score += jaccard(elements, candidate.elements) * 2;
      if (atoms > 0 && candidate.atoms > 0) {
        const ratio = Math.max(atoms, candidate.atoms) / Math.min(atoms, candidate.atoms);
        if (ratio <= 4) score += 0.6;
        else if (ratio <= 20) score += 0.25;
      }
      return { candidate, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}
