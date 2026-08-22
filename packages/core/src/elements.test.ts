import { describe, it, expect } from 'vitest';
import { ELEMENT_DATA, PERIODIC_LAYOUT, getElementSpec, hexToRgb } from './elements';

describe('getElementSpec', () => {
  it('returns known elements by atomic number', () => {
    const carbon = getElementSpec(6);
    expect(carbon.symbol).toBe('C');
    expect(carbon.name).toBe('Carbon');
    expect(carbon.color).toBe('#909090');
  });

  it('returns hydrogen with correct radius', () => {
    const h = getElementSpec(1);
    expect(h.symbol).toBe('H');
    expect(h.radius).toBe(0.31);
    expect(h.role).toBe('Terminator');
  });

  it('generates fallback for unknown atomic numbers', () => {
    const unknown = getElementSpec(999);
    expect(unknown.symbol).toBe('X999');
    expect(unknown.name).toBe('Unknown Isotope');
    expect(unknown.color.startsWith('hsl')).toBe(true);
    // Fallback must still expose a covalent + display radius so the bond
    // detector (which uses .radius) and atom renderer (which uses
    // .displayRadius) don't see undefined.
    expect(unknown.radius).toBeGreaterThan(0);
    expect(unknown.displayRadius).toBeGreaterThan(0);
  });

  it('covers all entries in ELEMENT_DATA', () => {
    for (const [type, data] of Object.entries(ELEMENT_DATA)) {
      const spec = getElementSpec(Number(type));
      expect(spec.symbol).toBe(data.symbol);
    }
  });

  it('covers the full periodic table (1-118) so valid chemistry is not silently degraded', () => {
    // The pre-2026-05-08 table only covered ~30 elements, leaving common
    // materials (LLZO's La, garnet/perovskite/fluorite phases, lanthanide
    // dopants) to fall through to the unknown-isotope fallback. That gave
    // every heavy atom a stub covalent radius of 1.0 Å and missed real
    // bonds (La–O at 2.6 Å rejected because the cutoff collapsed to 2.11).
    for (let z = 1; z <= 118; z++) {
      expect(ELEMENT_DATA[z], `missing element Z=${z}`).toBeDefined();
      expect(ELEMENT_DATA[z].radius).toBeGreaterThan(0);
      expect(ELEMENT_DATA[z].displayRadius).toBeGreaterThan(0);
    }
  });

  it('decouples display radius from covalent radius so bonds remain visible', () => {
    // For tight pairs (C–C ~1.41 Å, half-bond 0.7 Å) the atom must render
    // smaller than half the typical bond, otherwise the bond cylinder is
    // fully buried inside the sphere and the user sees no bonds at all —
    // the carbon-nanotube symptom that motivated this fix.
    const carbon = ELEMENT_DATA[6];
    expect(carbon.displayRadius).toBeLessThan(0.7);
    // But atoms must stay visible — H/He shouldn't collapse to a point.
    const h = ELEMENT_DATA[1];
    expect(h.displayRadius).toBeGreaterThanOrEqual(0.30);
  });

  it('returns proper covalent radius for La so LLZO La–O bonds are detected', () => {
    // Cordero et al. 2008: La covalent radius = 2.07 Å. With this and
    // O = 0.66 Å plus tolerance 0.45 Å, the La–O cutoff is 3.18 Å —
    // comfortably above the ~2.6 Å observed in garnet electrolytes.
    const la = getElementSpec(57);
    expect(la.symbol).toBe('La');
    expect(la.radius).toBeGreaterThanOrEqual(2.0);
  });
});

describe('element group/period/category/electronegativity', () => {
  it('fills all four fields for every element Z=1-118 with in-range values', () => {
    for (let z = 1; z <= 118; z++) {
      const spec = ELEMENT_DATA[z];
      expect(spec.category, `Z=${z} category`).toBeDefined();
      expect(
        spec.group === null || (spec.group >= 1 && spec.group <= 18),
        `Z=${z} group ${spec.group}`,
      ).toBe(true);
      // Every real element has a period; only the synthesized fallback is null.
      expect(spec.period, `Z=${z} period`).not.toBeNull();
      expect(spec.period!, `Z=${z} period ${spec.period}`).toBeGreaterThanOrEqual(1);
      expect(spec.period!, `Z=${z} period ${spec.period}`).toBeLessThanOrEqual(7);
      expect(
        spec.electronegativity === null ||
          (spec.electronegativity > 0 && spec.electronegativity <= 3.98),
        `Z=${z} electronegativity ${spec.electronegativity}`,
      ).toBe(true);
    }
  });

  it('spot-checks canonical values', () => {
    const h = ELEMENT_DATA[1];
    expect(h.group).toBe(1);
    expect(h.period).toBe(1);
    expect(h.category).toBe('nonmetal');
    expect(h.electronegativity).toBe(2.20);

    const he = ELEMENT_DATA[2];
    expect(he.group).toBe(18);
    expect(he.period).toBe(1);
    expect(he.category).toBe('noble-gas');
    expect(he.electronegativity).toBeNull();

    const fe = ELEMENT_DATA[26];
    expect(fe.group).toBe(8);
    expect(fe.period).toBe(4);
    expect(fe.category).toBe('transition-metal');
    expect(fe.electronegativity).toBe(1.83);

    const o = ELEMENT_DATA[8];
    expect(o.group).toBe(16);
    expect(o.period).toBe(2);
    expect(o.category).toBe('nonmetal');
    expect(o.electronegativity).toBe(3.44);

    const nd = ELEMENT_DATA[60];
    expect(nd.category).toBe('lanthanide');
    expect(nd.group).toBeNull();
    expect(nd.period).toBe(6);

    const u = ELEMENT_DATA[92];
    expect(u.category).toBe('actinide');
    expect(u.group).toBeNull();
    expect(u.period).toBe(7);

    // Fluorine has the maximum Pauling electronegativity.
    expect(ELEMENT_DATA[9].electronegativity).toBe(3.98);
  });

  it('gives the fallback element unknown category and null group/period/EN', () => {
    const unknown = getElementSpec(999);
    expect(unknown.group).toBeNull();
    expect(unknown.period).toBeNull();
    expect(unknown.category).toBe('unknown');
    expect(unknown.electronegativity).toBeNull();
  });
});

describe('PERIODIC_LAYOUT', () => {
  it('has exactly 120 cells (118 elements + 2 f-block placeholders)', () => {
    expect(PERIODIC_LAYOUT).toHaveLength(120);
  });

  it('has no (col,row) collisions and stays inside the 18-column grid', () => {
    const seen = new Set<string>();
    for (const cell of PERIODIC_LAYOUT) {
      expect(cell.col, `col of ${JSON.stringify(cell)}`).toBeGreaterThanOrEqual(1);
      expect(cell.col, `col of ${JSON.stringify(cell)}`).toBeLessThanOrEqual(18);
      expect(cell.row, `row of ${JSON.stringify(cell)}`).toBeGreaterThanOrEqual(1);
      expect(cell.row, `row of ${JSON.stringify(cell)}`).toBeLessThanOrEqual(10);
      // Row 8 is a visual gap and must stay empty.
      expect(cell.row, `row of ${JSON.stringify(cell)}`).not.toBe(8);
      const key = `${cell.col}:${cell.row}`;
      expect(seen.has(key), `duplicate cell at ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('places every atomic number 1-118 exactly once', () => {
    const zs = PERIODIC_LAYOUT.map((cell) => cell.z).filter((z) => z !== null);
    expect(zs).toHaveLength(118);
    const seen = new Set(zs);
    for (let z = 1; z <= 118; z++) {
      expect(seen.has(z), `missing Z=${z}`).toBe(true);
    }
  });

  it('has exactly two placeholder cells at group 3 of periods 6 and 7', () => {
    const placeholders = PERIODIC_LAYOUT.filter((cell) => cell.z === null);
    expect(placeholders).toHaveLength(2);
    expect(placeholders).toContainEqual({ z: null, placeholder: 'lanthanides', col: 3, row: 6 });
    expect(placeholders).toContainEqual({ z: null, placeholder: 'actinides', col: 3, row: 7 });
  });
});

describe('hexToRgb', () => {
  it('converts hex color to normalized RGB', () => {
    const rgb = hexToRgb('#ff0000');
    expect(rgb[0]).toBeCloseTo(1.0);
    expect(rgb[1]).toBeCloseTo(0.0);
    expect(rgb[2]).toBeCloseTo(0.0);
  });

  it('converts white correctly', () => {
    const rgb = hexToRgb('#ffffff');
    expect(rgb[0]).toBeCloseTo(1.0);
    expect(rgb[1]).toBeCloseTo(1.0);
    expect(rgb[2]).toBeCloseTo(1.0);
  });

  it('handles shorthand hex', () => {
    // The regex only matches 6-char hex, so shorthand returns fallback
    const rgb = hexToRgb('#f00');
    expect(rgb).toEqual([0.6, 0.6, 0.6]);
  });

  it('returns gray for HSL strings', () => {
    const rgb = hexToRgb('hsl(120, 50%, 50%)');
    expect(rgb).toEqual([0.6, 0.6, 0.6]);
  });
});
