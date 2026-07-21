import { describe, expect, it } from 'vitest';
import { EXTERNAL_RESEARCH_DATASETS } from '@atlas/core';
import { researchProvider } from './research';

describe('research molecule provider', () => {
  it('browses the complete curated catalog with local proxy URLs and provenance', async () => {
    const hits = await researchProvider.search({ text: '' });

    expect(researchProvider.isAvailable()).toBe(true);
    expect(hits).toHaveLength(EXTERNAL_RESEARCH_DATASETS.length);
    expect(hits.every((hit) => hit.source === 'research')).toBe(true);

    const gst = hits.find((hit) => hit.id === 'gst-phase-change-ace-start')!;
    expect(gst).toMatchObject({
      title: 'Ge-Sb-Te phase-change starting structure',
      elements: ['Ge', 'Sb', 'Te'],
      tags: expect.arrayContaining([
        'phase-change materials',
        'lammps-data',
        'atomic',
        '10.5281/zenodo.12173540',
        'CC-BY-4.0',
      ]),
      provenance: expect.objectContaining({
        sourceUrl: 'https://zenodo.org/records/12173540',
        license: 'CC-BY-4.0',
      }),
      score: 0.64,
    });
    expect(gst.load).toEqual({
      kind: 'url',
      url: '/v1/datasets/research/gst-phase-change-ace-start/files/GST_config.data',
      atomTypeMap: { 1: 32, 2: 51, 3: 52 },
    });
  });

  it('searches scientific metadata, DOI, and explicit type labels', async () => {
    const hydrolysis = await researchProvider.search({ text: 'hydrolysis' });
    const byDoi = await researchProvider.search({ text: '10.5281/zenodo.12173540' });
    const magnesiumType = await researchProvider.search({ text: 'Mg' });

    expect(hydrolysis.map((hit) => hit.id)).toEqual(['pyrophosphate-mg-hydrolysis-md']);
    expect(byDoi.map((hit) => hit.id)).toEqual(['gst-phase-change-ace-start']);
    expect(magnesiumType.map((hit) => hit.id)).toContain('pyrophosphate-mg-hydrolysis-md');
  });

  it('uses AND semantics for required elements and respects result limits', async () => {
    const magnesiumPhosphorus = await researchProvider.search({
      text: '',
      elements: ['Mg', 'P'],
    });
    const impossiblePair = await researchProvider.search({
      text: '',
      elements: ['Mg', 'Te'],
    });
    const limited = await researchProvider.search({ text: '', limit: 2 });

    expect(magnesiumPhosphorus.map((hit) => hit.id)).toEqual(['pyrophosphate-mg-hydrolysis-md']);
    expect(impossiblePair).toEqual([]);
    expect(limited).toHaveLength(2);
  });

  it('keeps coarse-grained bead classes opaque instead of inventing elements', async () => {
    const [hit] = await researchProvider.search({ text: 'amorphous PLGA' });

    expect(hit.id).toBe('plga-amorphous-400k-cg');
    expect(hit.elements).toBeUndefined();
    expect(hit.subtitle).toMatch(/4,320 beads.*snapshot.*polymer coarse-graining/i);
    expect(hit.tags).toContain('coarse-grained');
    expect(hit.tags).toContain('approximate-render');
    expect(hit.notice).toMatch(/anisotropic ellipsoids.*spherical.*orientation.*not yet visualized/i);
    expect(hit.load.kind).toBe('url');
    if (hit.load.kind !== 'url') throw new Error('Expected a URL research hit.');
    expect(hit.load.atomTypeMap).toBeUndefined();
    expect(hit.load.url).toBe('/v1/datasets/research/plga-amorphous-400k-cg/files/plga_amorph_400K.dump');
  });

  it('attaches the source-backed mapping for opaque numeric LAMMPS types', async () => {
    const [hit] = await researchProvider.search({ text: 'Mg-pyrophosphate' });

    expect(hit.id).toBe('pyrophosphate-mg-hydrolysis-md');
    expect(hit.load.kind).toBe('url');
    if (hit.load.kind !== 'url') throw new Error('Expected a URL research hit.');
    expect(hit.load.atomTypeMap).toEqual({ 1: 1, 2: 8, 3: 12, 4: 15 });
  });
});
