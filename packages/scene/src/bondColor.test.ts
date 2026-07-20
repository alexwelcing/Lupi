import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { writeDisplayRgbAsLinear } from './bondColor';

describe('writeDisplayRgbAsLinear', () => {
  it('decodes authored display-sRGB exactly once for Three instance colors', () => {
    const target = new Float32Array(3);
    writeDisplayRgbAsLinear(target, 0, [0.5, 0.25, 0.75], new THREE.Color());
    const expected = new THREE.Color().setRGB(0.5, 0.25, 0.75, THREE.SRGBColorSpace);
    expect(target[0]).toBeCloseTo(expected.r);
    expect(target[1]).toBeCloseTo(expected.g);
    expect(target[2]).toBeCloseTo(expected.b);
    expect(target[0]).not.toBeCloseTo(0.5);
  });
});
