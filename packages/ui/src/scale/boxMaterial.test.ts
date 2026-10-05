// The box material's node graph builds without a renderer: every TSL call in
// it exists and composes (a missing method throws here, not on a phone).
import { describe, expect, it } from 'vitest';
import { BOX_ATTR, createBoxGeometry, createBoxMaterial, createSplatMaterial } from './boxMaterial';

describe('box material', () => {
  it('builds the lattice colour node and an instanced unit cube with the grid attributes', () => {
    const material = createBoxMaterial();
    expect(material.colorNode).toBeTruthy();
    const geometry = createBoxGeometry(16);
    expect(geometry.getAttribute(BOX_ATTR.cells).count).toBe(16);
    expect(geometry.getAttribute(BOX_ATTR.grid).count).toBe(16);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.toArray()).toEqual([0, 0, 0]);
    expect(geometry.boundingBox!.max.toArray()).toEqual([1, 1, 1]);
    expect(createSplatMaterial()).toBeTruthy();
    material.dispose();
    geometry.dispose();
  });
});
