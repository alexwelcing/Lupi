import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_RESEARCH_DATASETS,
  atomicTypeMap,
  atomicTypeMapForExternalResearchLoadUrl,
  externalResearchDatasetForLoadUrl,
  externalResearchLoadPath,
} from './scienceDataCatalog';

const RAW_TEXT_CEILING = 16 * 1024 * 1024;

describe('external research science-data catalog', () => {
  it('keeps a compact, unique catalog whose payloads remain version-pinned upstream', () => {
    expect(EXTERNAL_RESEARCH_DATASETS).toHaveLength(8);

    const ids = EXTERNAL_RESEARCH_DATASETS.map((dataset) => dataset.id);
    const paths = EXTERNAL_RESEARCH_DATASETS.map(externalResearchLoadPath);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);

    for (const dataset of EXTERNAL_RESEARCH_DATASETS) {
      expect(dataset.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(dataset.remote.provider).toBe('zenodo');
      expect(dataset.remote.bytes).toBeGreaterThan(0);
      expect(dataset.remote.bytes).toBeLessThanOrEqual(RAW_TEXT_CEILING);
      expect(dataset.remote.url).toBe(
        `https://zenodo.org/api/records/${dataset.remote.recordId}/files/${encodeURIComponent(dataset.remote.fileKey)}/content`,
      );
      expect(dataset.remote.checksum).toEqual({
        algorithm: 'sha256',
        value: expect.stringMatching(/^[a-f0-9]{64}$/),
        sourceMd5: expect.stringMatching(/^[a-f0-9]{32}$/),
      });
      expect(dataset.remote.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(externalResearchLoadPath(dataset)).toBe(
        `/v1/datasets/research/${dataset.id}/files/${dataset.remote.fileKey}`,
      );
      expect(externalResearchLoadPath(dataset)).not.toContain('?');
    }
  });

  it('requires complete citation, licensing, and source-truth metadata', () => {
    for (const dataset of EXTERNAL_RESEARCH_DATASETS) {
      expect(dataset.provenance.sourceUrl).toBe(`https://zenodo.org/records/${dataset.remote.recordId}`);
      expect(dataset.provenance.doi).toBe(`10.5281/zenodo.${dataset.remote.recordId}`);
      expect(dataset.provenance.citation.trim().length).toBeGreaterThan(20);
      expect(dataset.provenance.license).toBe('CC-BY-4.0');
      expect(dataset.provenance.licenseUrl).toBe('https://creativecommons.org/licenses/by/4.0/');
      expect(dataset.sourceTruth.coordinates).toBe('source');
      expect(['source-when-present', 'not-provided']).toContain(dataset.sourceTruth.bondTopology);
      expect(dataset.parser.warning.trim().length).toBeGreaterThan(10);
      expect(dataset.atomCount).toBeGreaterThan(0);
      expect(dataset.frameCount).toBeGreaterThan(0);
    }
  });

  it('maps every atomic type explicitly while leaving coarse-grained beads opaque', () => {
    const atomic = EXTERNAL_RESEARCH_DATASETS.filter((dataset) => dataset.representation === 'atomic');
    const coarseGrained = EXTERNAL_RESEARCH_DATASETS.filter((dataset) => dataset.representation === 'coarse-grained');
    expect(atomic.length).toBeGreaterThan(0);
    expect(coarseGrained.length).toBeGreaterThan(0);

    for (const dataset of atomic) {
      const mapping = atomicTypeMap(dataset);
      expect(mapping).not.toBeNull();
      expect(Object.keys(mapping!)).toHaveLength(Object.keys(dataset.typeMap).length);
      for (const [rawType, atomicNumber] of Object.entries(mapping!)) {
        expect(Number(rawType)).toBeGreaterThan(0);
        expect(Number.isInteger(Number(rawType))).toBe(true);
        expect(atomicNumber).toBeGreaterThanOrEqual(1);
        expect(atomicNumber).toBeLessThanOrEqual(118);
      }
    }

    for (const dataset of coarseGrained) {
      expect(atomicTypeMap(dataset)).toBeNull();
      expect(dataset.elements).toEqual([]);
      for (const definition of Object.values(dataset.typeMap)) {
        expect(definition).toMatchObject({ pseudo: true });
        expect(definition.atomicNumber).toBeUndefined();
      }
    }
  });

  it('resolves an exact catalog load path across direct and absolute viewer URLs', () => {
    const hydrolysis = EXTERNAL_RESEARCH_DATASETS.find(
      (dataset) => dataset.id === 'pyrophosphate-mg-hydrolysis-md',
    )!;
    const path = externalResearchLoadPath(hydrolysis);

    expect(externalResearchDatasetForLoadUrl(path)).toBe(hydrolysis);
    expect(externalResearchDatasetForLoadUrl(`http://127.0.0.1:8787${path}`)).toBe(hydrolysis);
    expect(atomicTypeMapForExternalResearchLoadUrl(path)).toEqual({ 1: 1, 2: 8, 3: 12, 4: 15 });
    expect(externalResearchDatasetForLoadUrl(`${path}?download=1`)).toBeNull();
    expect(externalResearchDatasetForLoadUrl('/v1/datasets/research/not-catalogued/files/sample.data')).toBeNull();
  });

  it('labels anisotropic PLGA particles as an explicit spherical-center approximation', () => {
    const plga = EXTERNAL_RESEARCH_DATASETS.filter((dataset) => dataset.id.startsWith('plga-'));
    expect(plga).toHaveLength(2);
    for (const dataset of plga) {
      expect(dataset.parser.status).toBe('approximate-render');
      expect(dataset.parser.warning).toMatch(/anisotropic ellipsoids.*spherical.*orientation.*not yet visualized/i);
    }
  });
});
