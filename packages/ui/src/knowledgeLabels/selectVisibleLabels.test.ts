import { describe, it, expect } from 'vitest';
import { selectVisibleLabels } from './selectVisibleLabels';
import type { KnowledgeLabel } from '../store';

function makeLabel(overrides: Partial<KnowledgeLabel> & { id: string; position: [number, number, number] }): KnowledgeLabel {
  return {
    kind: 'node',
    text: 'Label',
    salience: 0,
    ...overrides,
  } as KnowledgeLabel;
}

const DEFAULT_OPTS = {
  visible: true,
  threshold: 1,
  maxCount: 10,
  cullDistance: 100,
  cameraPosition: [0, 0, 0] as [number, number, number],
  hoveredAtom: null as number | null,
  visibleKinds: new Set(['sphere', 'node']),
};

describe('selectVisibleLabels', () => {
  it('returns empty when visible=false', () => {
    const labels = [makeLabel({ id: 'a', position: [1, 0, 0], salience: 2 })];
    const result = selectVisibleLabels({ ...DEFAULT_OPTS, labels, visible: false });
    expect(result.visibleLabels).toEqual([]);
    expect(result.hoverLabelToRender).toBeUndefined();
  });

  it('returns empty when labels array is empty', () => {
    const result = selectVisibleLabels({ ...DEFAULT_OPTS, labels: [] });
    expect(result.visibleLabels).toEqual([]);
    expect(result.hoverLabelToRender).toBeUndefined();
  });

  it('filters out kinds not in visibleKinds', () => {
    const labels = [
      makeLabel({ id: 'sphere', kind: 'sphere', position: [1, 0, 0] }),
      makeLabel({ id: 'node', kind: 'node', position: [2, 0, 0], salience: 2 }),
      makeLabel({ id: 'other', kind: 'other', position: [3, 0, 0], salience: 2 }),
    ];
    const result = selectVisibleLabels({ ...DEFAULT_OPTS, labels, visibleKinds: new Set(['node']) });
    expect(result.visibleLabels.map((l) => l.id)).toEqual(['node']);
  });

  it('spheres always render regardless of salience', () => {
    const labels = [
      makeLabel({ id: 'sphere', kind: 'sphere', position: [1, 0, 0], salience: 0 }),
    ];
    const result = selectVisibleLabels({ ...DEFAULT_OPTS, labels, threshold: 5 });
    expect(result.visibleLabels.map((l) => l.id)).toEqual(['sphere']);
  });

  it('nodes below threshold are hidden', () => {
    const labels = [
      makeLabel({ id: 'low', kind: 'node', position: [1, 0, 0], salience: 0 }),
      makeLabel({ id: 'high', kind: 'node', position: [2, 0, 0], salience: 2 }),
    ];
    const result = selectVisibleLabels({ ...DEFAULT_OPTS, labels, threshold: 1 });
    expect(result.visibleLabels.map((l) => l.id)).toEqual(['high']);
  });

  it('nodes at or above threshold are visible', () => {
    const labels = [
      makeLabel({ id: 'exact', kind: 'node', position: [1, 0, 0], salience: 1 }),
      makeLabel({ id: 'above', kind: 'node', position: [2, 0, 0], salience: 2 }),
    ];
    const result = selectVisibleLabels({ ...DEFAULT_OPTS, labels, threshold: 1 });
    expect(result.visibleLabels.map((l) => l.id)).toEqual(['exact', 'above']);
  });

  it('labels beyond cullDistance are hidden', () => {
    const labels = [
      makeLabel({ id: 'near', kind: 'node', position: [5, 0, 0], salience: 2 }),
      makeLabel({ id: 'far', kind: 'node', position: [50, 0, 0], salience: 2 }),
    ];
    const result = selectVisibleLabels({ ...DEFAULT_OPTS, labels, cullDistance: 10 });
    expect(result.visibleLabels.map((l) => l.id)).toEqual(['near']);
  });

  it('only closest maxCount labels are kept', () => {
    const labels = [
      makeLabel({ id: 'a', kind: 'node', position: [1, 0, 0], salience: 2 }),
      makeLabel({ id: 'b', kind: 'node', position: [2, 0, 0], salience: 2 }),
      makeLabel({ id: 'c', kind: 'node', position: [3, 0, 0], salience: 2 }),
    ];
    const result = selectVisibleLabels({ ...DEFAULT_OPTS, labels, maxCount: 2 });
    expect(result.visibleLabels.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('hovered node below threshold is revealed as hoverLabelToRender', () => {
    const labels = [
      makeLabel({ id: 'low', kind: 'node', position: [1, 0, 0], salience: 0, atomIndex: 5 }),
      makeLabel({ id: 'high', kind: 'node', position: [2, 0, 0], salience: 2, atomIndex: 6 }),
    ];
    const result = selectVisibleLabels({ ...DEFAULT_OPTS, labels, threshold: 1, hoveredAtom: 5 });
    expect(result.visibleLabels.map((l) => l.id)).toEqual(['high']);
    expect(result.hoverLabelToRender).toBeDefined();
    expect(result.hoverLabelToRender!.id).toBe('low');
  });

  it('hovered node already visible does not duplicate in hoverLabelToRender', () => {
    const labels = [
      makeLabel({ id: 'high', kind: 'node', position: [2, 0, 0], salience: 2, atomIndex: 6 }),
    ];
    const result = selectVisibleLabels({ ...DEFAULT_OPTS, labels, threshold: 1, hoveredAtom: 6 });
    expect(result.visibleLabels.map((l) => l.id)).toEqual(['high']);
    expect(result.hoverLabelToRender).toBeUndefined();
  });

  it('sorts by distance ascending', () => {
    const labels = [
      makeLabel({ id: 'far', kind: 'node', position: [10, 0, 0], salience: 2 }),
      makeLabel({ id: 'near', kind: 'node', position: [2, 0, 0], salience: 2 }),
      makeLabel({ id: 'mid', kind: 'node', position: [5, 0, 0], salience: 2 }),
    ];
    const result = selectVisibleLabels({ ...DEFAULT_OPTS, labels });
    expect(result.visibleLabels.map((l) => l.id)).toEqual(['near', 'mid', 'far']);
  });

  it('spheres are also distance-culled', () => {
    const labels = [
      makeLabel({ id: 'nearSphere', kind: 'sphere', position: [5, 0, 0] }),
      makeLabel({ id: 'farSphere', kind: 'sphere', position: [50, 0, 0] }),
    ];
    const result = selectVisibleLabels({ ...DEFAULT_OPTS, labels, cullDistance: 10 });
    expect(result.visibleLabels.map((l) => l.id)).toEqual(['nearSphere']);
  });
});
