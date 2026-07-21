import {
  EXTERNAL_RESEARCH_DATASETS,
  atomicTypeMap,
  externalResearchLoadPath,
} from '@atlas/core';
import { scienceDataUrl } from '../dataEndpoints';
import type { MoleculeHit, MoleculeProvider, MoleculeQuery } from '../types';

/** Real, versioned research files whose bytes remain at their source. */
export const researchProvider: MoleculeProvider = {
  id: 'research',
  label: 'Research data',
  isAvailable: () => true,
  async search(query: MoleculeQuery): Promise<MoleculeHit[]> {
    const q = query.text.toLowerCase().trim();
    const requiredElements = query.elements ?? [];
    return EXTERNAL_RESEARCH_DATASETS
      .filter((dataset) => requiredElements.every((element) => dataset.elements.includes(element)))
      .filter((dataset) => {
        if (!q) return true;
        const haystack = [
          dataset.title,
          dataset.summary,
          dataset.domain,
          dataset.provenance.doi,
          dataset.provenance.citation,
          dataset.representation,
          ...dataset.elements,
          ...Object.values(dataset.typeMap).map((definition) => definition.label),
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, query.limit ?? 25)
      .map((dataset) => {
        const unit = dataset.representation === 'coarse-grained' ? 'beads' : 'atoms';
        const frameLabel = dataset.frameCount === 1 ? 'snapshot' : `${dataset.frameCount} frames`;
        return {
          id: dataset.id,
          source: 'research',
          title: dataset.title,
          subtitle: `${dataset.atomCount.toLocaleString()} ${unit} · ${frameLabel} · ${dataset.domain}`,
          elements: dataset.elements.length ? dataset.elements : undefined,
          tags: [
            dataset.domain,
            dataset.format,
            dataset.sequenceKind,
            dataset.representation,
            dataset.parser.status,
            dataset.provenance.doi,
            dataset.provenance.license,
          ],
          load: {
            kind: 'url',
            url: scienceDataUrl(externalResearchLoadPath(dataset)),
            atomTypeMap: atomicTypeMap(dataset) ?? undefined,
          },
          notice: dataset.parser.status === 'approximate-render'
            ? dataset.parser.warning
            : undefined,
          provenance: dataset.provenance,
          score: q ? undefined : 0.64,
        } satisfies MoleculeHit;
      });
  },
};
