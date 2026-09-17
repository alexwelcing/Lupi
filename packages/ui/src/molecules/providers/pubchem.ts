import type { MoleculeHit, MoleculeProvider, MoleculeQuery } from '../types';
import { pubchemAutocomplete } from '../pubchemLoad';

/**
 * PubChem type-ahead: the compound dictionary autocomplete endpoint returns
 * names for a short prefix in one cached round trip, so two letters reach the
 * whole 100M+ compound set. Loading resolves by name through `pubchemLoad`
 * (3D conformer, 2D fallback) with no MCP bridge in the loop.
 */
export const pubchemProvider: MoleculeProvider = {
  id: 'pubchem',
  label: 'PubChem',
  isAvailable: () => typeof fetch === 'function',
  async search(query: MoleculeQuery): Promise<MoleculeHit[]> {
    const prefix = query.text.trim();
    if (prefix.length < 2) return [];
    const names = await pubchemAutocomplete(prefix, query.limit ?? 8);
    return names.map((name) => ({
      id: `name-${name.toLowerCase()}`,
      source: 'pubchem',
      title: name,
      subtitle: 'PubChem compound',
      tags: ['pubchem'],
      load: { kind: 'generate', inputType: 'name', input: name },
      score: 0.5,
    }));
  },
};
