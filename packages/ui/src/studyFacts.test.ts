import { describe, expect, it } from 'vitest';
import type { LoadedFile } from './store';
import { createMockFrame } from '@atlas/core/test-utils';
import { buildMoleculeStudyFacts, findGalleryExample, renderStudySheetHtml } from './studyFacts';

function makeFile(
  sourceUrl = 'https://lupi.live/gallery/curated/popular/aspirin.xyz',
  name = 'aspirin.xyz',
): LoadedFile {
  const frame = createMockFrame({
    natoms: 5,
    types: [6, 6, 1, 1, 8],
    positions: new Float32Array([
      0, 0, 0,
      1.4, 0, 0,
      -0.8, 0.7, 0,
      -0.8, -0.7, 0,
      2.4, 0, 0,
    ]),
    bonds: new Int32Array([0, 1, 1, 4]),
  });
  frame.properties.set('partial_charge', new Float32Array([-0.1, 0.2, 0.05, 0.04, -0.4]));

  return {
    name,
    size: 1234,
    sourceUrl,
    trajectory: {
      frames: [frame],
      totalFrames: 1,
      atomTypes: [1, 6, 8],
      globalBounds: { min: [0, 0, 0], max: [3, 3, 3] },
    },
    thermo: null,
  };
}

describe('study facts', () => {
  it('matches a loaded gallery file back to its curated example', () => {
    const example = findGalleryExample(makeFile());

    expect(example?.id).toBe('aspirin');
    expect(example?.title).toBe('Aspirin');
  });

  it('does not invent small-molecule bonds when source topology is absent', () => {
    const file = makeFile('local://pending-bonds.xyz', 'pending-bonds.xyz');
    file.trajectory.frames[0].bonds = new Int32Array(0);

    const facts = buildMoleculeStudyFacts({
      file,
      frameIndex: 0,
      showBonds: true,
    });

    expect(facts?.bondSummary).toBe('No source bonds');
    expect(facts?.bondInfo.isScientific).toBe(false);
    expect(facts?.dataProvenance.bonds).toContain('does not invent a bond count');
  });

  it('labels renderer bond counts as visual guides, not source topology', () => {
    const file = makeFile('local://visual-bonds.xyz', 'visual-bonds.xyz');
    file.trajectory.frames[0].bonds = new Int32Array(0);

    const facts = buildMoleculeStudyFacts({
      file,
      frameIndex: 0,
      lastBondCount: 4,
      showBonds: true,
    });

    expect(facts?.bondSummary).toBe('Visual guide only');
    expect(facts?.bondInfo.detail).toContain('not source bonds');
  });

  it('falls back gracefully for non-gallery structures', () => {
    const file = makeFile('local://unknown.xyz', 'unknown.xyz');
    file.trajectory.frames[0].properties.clear();
    const facts = buildMoleculeStudyFacts({
      file,
      frameIndex: 0,
    });

    expect(facts?.galleryExample).toBeNull();
    expect(facts?.functionalGroups).toEqual([]);
    expect(facts?.sourceLabel).toBe('Local import');
    expect(renderStudySheetHtml(facts!)).toContain('No curated organic functional-group mapping');
    expect(renderStudySheetHtml(facts!)).toContain('No rendered view image was captured');
    expect(renderStudySheetHtml(facts!)).toContain('No source scalar property columns');
  });
});
