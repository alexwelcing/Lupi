/** Chemical category for periodic-table grouping and coloring. Follows the
 *  common textbook/IUPAC scheme; judgment calls, applied consistently:
 *  - metalloids = B, Si, Ge, As, Sb, Te (At is classed with the halogens);
 *  - Po is classed as a post-transition metal;
 *  - Rf–Cn (Z 104–112) are classed as transition metals by group placement;
 *  - Nh–Og (Z 113–118) are 'unknown' because their chemistry is predicted
 *    only (Ts is therefore not classed as a halogen, nor Og as a noble gas). */
export type ElementCategory =
  | 'alkali-metal' | 'alkaline-earth' | 'transition-metal' | 'post-transition-metal'
  | 'metalloid' | 'nonmetal' | 'halogen' | 'noble-gas'
  | 'lanthanide' | 'actinide' | 'unknown';

export type ElementData = {
  symbol: string,
  name: string,
  mass: number,
  /** Single-bond covalent radius in Å (Cordero et al. 2008, "Covalent radii
   *  revisited"). Drives bond detection: cutoff = r_cov(A)+r_cov(B)+tolerance.
   *  For elements with no published covalent radius (Po, At, Rn, heavy
   *  actinides) the value is taken from Pyykkö 2009 single-bond radii. */
  radius: number,
  /** Render radius in Å used by the atom mesh. Decoupled from `radius` so
   *  bonds remain visible: when an atom is drawn at full covalent radius
   *  the bond cylinder (which spans atom-center to atom-center) is fully
   *  buried inside the sphere for tight pairs (C–C, Cu–Cu, Au–Au, …). The
   *  formula clamp(0.5·radius, 0.30, 0.70) gives a conventional ball-and-
   *  stick proportion across the periodic table. */
  displayRadius: number,
  block: string,
  role: string,
  color: string,
  /** IUPAC group 1–18; null for Ce–Lu (58–71) and Th–Lr (90–103) per common
   *  convention (La and Ac keep group 3), and for synthesized fallback
   *  elements. */
  group: number | null,
  /** Period 1–7 for all real elements; null only for fallback elements. */
  period: number | null,
  category: ElementCategory,
  /** Pauling electronegativity; null where no Pauling value exists (He, Ne,
   *  Ar — note Kr 3.00 and Xe 2.60 do have values — and the transactinides
   *  Z ≥ 104). */
  electronegativity: number | null,
};

/** Convert covalent radius to a sensible ball-and-stick display radius. The
 *  clamp keeps tiny atoms (H, He) visible at ≥0.30 Å and prevents big atoms
 *  (Cs, Ba, La) from swallowing their bonds — for any pair the half-bond
 *  (≈ ½·(r_A + r_B + slack)) exceeds the display radius, so the bond cylinder
 *  pokes out. Fallback elements (`getElementSpec` for unknown types) reuse
 *  this rule. */
function ballAndStickRadius(covalent: number): number {
  return Math.min(0.70, Math.max(0.30, covalent * 0.5));
}

const RAW_ELEMENT_DATA: Record<number, Omit<ElementData, 'displayRadius'> & { displayRadius?: number }> = {
  1:  { symbol: 'H',  name: 'Hydrogen',     mass: 1.008,    radius: 0.31, block: 's', role: 'Terminator',          color: '#ffffff',
      group: 1,     period: 1,  category: 'nonmetal',               electronegativity: 2.20 },
  2:  { symbol: 'He', name: 'Helium',       mass: 4.0026,   radius: 0.28, block: 's', role: 'Inert Gas',           color: '#d9ffff',
      group: 18,    period: 1,  category: 'noble-gas',              electronegativity: null },
  3:  { symbol: 'Li', name: 'Lithium',      mass: 6.94,     radius: 1.28, block: 's', role: 'Intercalant',         color: '#cc80ff',
      group: 1,     period: 2,  category: 'alkali-metal',           electronegativity: 0.98 },
  4:  { symbol: 'Be', name: 'Beryllium',    mass: 9.0122,   radius: 0.96, block: 's', role: 'Matrix',              color: '#c2ff00',
      group: 2,     period: 2,  category: 'alkaline-earth',         electronegativity: 1.57 },
  5:  { symbol: 'B',  name: 'Boron',        mass: 10.81,    radius: 0.84, block: 'p', role: 'Dopant',              color: '#ffb5b5',
      group: 13,    period: 2,  category: 'metalloid',              electronegativity: 2.04 },
  6:  { symbol: 'C',  name: 'Carbon',       mass: 12.011,   radius: 0.76, block: 'p', role: 'Framework',           color: '#909090',
      group: 14,    period: 2,  category: 'nonmetal',               electronegativity: 2.55 },
  7:  { symbol: 'N',  name: 'Nitrogen',     mass: 14.007,   radius: 0.71, block: 'p', role: 'Ligand',              color: '#3050f8',
      group: 15,    period: 2,  category: 'nonmetal',               electronegativity: 3.04 },
  8:  { symbol: 'O',  name: 'Oxygen',       mass: 15.999,   radius: 0.66, block: 'p', role: 'Framework',           color: '#ff0d0d',
      group: 16,    period: 2,  category: 'nonmetal',               electronegativity: 3.44 },
  9:  { symbol: 'F',  name: 'Fluorine',     mass: 18.998,   radius: 0.57, block: 'p', role: 'Ligand',              color: '#90e050',
      group: 17,    period: 2,  category: 'halogen',                electronegativity: 3.98 },
  10: { symbol: 'Ne', name: 'Neon',         mass: 20.180,   radius: 0.58, block: 'p', role: 'Inert Gas',           color: '#b3e3f5',
      group: 18,    period: 2,  category: 'noble-gas',              electronegativity: null },
  11: { symbol: 'Na', name: 'Sodium',       mass: 22.990,   radius: 1.66, block: 's', role: 'Intercalant',         color: '#ab5cf2',
      group: 1,     period: 3,  category: 'alkali-metal',           electronegativity: 0.93 },
  12: { symbol: 'Mg', name: 'Magnesium',    mass: 24.305,   radius: 1.41, block: 's', role: 'Matrix',              color: '#8aff00',
      group: 2,     period: 3,  category: 'alkaline-earth',         electronegativity: 1.31 },
  13: { symbol: 'Al', name: 'Aluminum',     mass: 26.982,   radius: 1.21, block: 'p', role: 'Framework',           color: '#bfa6a6',
      group: 13,    period: 3,  category: 'post-transition-metal',  electronegativity: 1.61 },
  14: { symbol: 'Si', name: 'Silicon',      mass: 28.085,   radius: 1.11, block: 'p', role: 'Semiconductor',       color: '#f0c8a0',
      group: 14,    period: 3,  category: 'metalloid',              electronegativity: 1.90 },
  15: { symbol: 'P',  name: 'Phosphorus',   mass: 30.974,   radius: 1.07, block: 'p', role: 'Dopant',              color: '#ff8000',
      group: 15,    period: 3,  category: 'nonmetal',               electronegativity: 2.19 },
  16: { symbol: 'S',  name: 'Sulfur',       mass: 32.06,    radius: 1.05, block: 'p', role: 'Ligand',              color: '#ffff30',
      group: 16,    period: 3,  category: 'nonmetal',               electronegativity: 2.58 },
  17: { symbol: 'Cl', name: 'Chlorine',     mass: 35.45,    radius: 1.02, block: 'p', role: 'Ligand',              color: '#1ff01f',
      group: 17,    period: 3,  category: 'halogen',                electronegativity: 3.16 },
  18: { symbol: 'Ar', name: 'Argon',        mass: 39.95,    radius: 1.06, block: 'p', role: 'Inert Gas',           color: '#80d1e3',
      group: 18,    period: 3,  category: 'noble-gas',              electronegativity: null },
  19: { symbol: 'K',  name: 'Potassium',    mass: 39.098,   radius: 2.03, block: 's', role: 'Intercalant',         color: '#8f40d4',
      group: 1,     period: 4,  category: 'alkali-metal',           electronegativity: 0.82 },
  20: { symbol: 'Ca', name: 'Calcium',      mass: 40.078,   radius: 1.76, block: 's', role: 'Matrix',              color: '#3dff00',
      group: 2,     period: 4,  category: 'alkaline-earth',         electronegativity: 1.00 },
  21: { symbol: 'Sc', name: 'Scandium',     mass: 44.956,   radius: 1.70, block: 'd', role: 'Alloy Component',     color: '#e6e6e6',
      group: 3,     period: 4,  category: 'transition-metal',       electronegativity: 1.36 },
  22: { symbol: 'Ti', name: 'Titanium',     mass: 47.867,   radius: 1.60, block: 'd', role: 'Alloy Matrix',        color: '#bfc2c7',
      group: 4,     period: 4,  category: 'transition-metal',       electronegativity: 1.54 },
  23: { symbol: 'V',  name: 'Vanadium',     mass: 50.942,   radius: 1.53, block: 'd', role: 'Alloy Component',     color: '#a6a6ab',
      group: 5,     period: 4,  category: 'transition-metal',       electronegativity: 1.63 },
  24: { symbol: 'Cr', name: 'Chromium',     mass: 51.996,   radius: 1.39, block: 'd', role: 'Alloy Component',     color: '#8a99c7',
      group: 6,     period: 4,  category: 'transition-metal',       electronegativity: 1.66 },
  25: { symbol: 'Mn', name: 'Manganese',    mass: 54.938,   radius: 1.39, block: 'd', role: 'Alloy Component',     color: '#9c7ac7',
      group: 7,     period: 4,  category: 'transition-metal',       electronegativity: 1.55 },
  26: { symbol: 'Fe', name: 'Iron',         mass: 55.845,   radius: 1.32, block: 'd', role: 'Magnetic Core',       color: '#e06633',
      group: 8,     period: 4,  category: 'transition-metal',       electronegativity: 1.83 },
  27: { symbol: 'Co', name: 'Cobalt',       mass: 58.933,   radius: 1.26, block: 'd', role: 'Magnetic Core',       color: '#f090a0',
      group: 9,     period: 4,  category: 'transition-metal',       electronegativity: 1.88 },
  28: { symbol: 'Ni', name: 'Nickel',       mass: 58.693,   radius: 1.24, block: 'd', role: 'Alloy Matrix',        color: '#50d050',
      group: 10,    period: 4,  category: 'transition-metal',       electronegativity: 1.91 },
  29: { symbol: 'Cu', name: 'Copper',       mass: 63.546,   radius: 1.32, block: 'd', role: 'Conductor',           color: '#c88033',
      group: 11,    period: 4,  category: 'transition-metal',       electronegativity: 1.90 },
  30: { symbol: 'Zn', name: 'Zinc',         mass: 65.38,    radius: 1.22, block: 'd', role: 'Alloy Component',     color: '#7d80b0',
      group: 12,    period: 4,  category: 'transition-metal',       electronegativity: 1.65 },
  31: { symbol: 'Ga', name: 'Gallium',      mass: 69.723,   radius: 1.22, block: 'p', role: 'Semiconductor',       color: '#c28f8f',
      group: 13,    period: 4,  category: 'post-transition-metal',  electronegativity: 1.81 },
  32: { symbol: 'Ge', name: 'Germanium',    mass: 72.630,   radius: 1.20, block: 'p', role: 'Semiconductor',       color: '#668f8f',
      group: 14,    period: 4,  category: 'metalloid',              electronegativity: 2.01 },
  33: { symbol: 'As', name: 'Arsenic',      mass: 74.922,   radius: 1.19, block: 'p', role: 'Dopant',              color: '#bd80e3',
      group: 15,    period: 4,  category: 'metalloid',              electronegativity: 2.18 },
  34: { symbol: 'Se', name: 'Selenium',     mass: 78.971,   radius: 1.20, block: 'p', role: 'Chalcogen',           color: '#ffa100',
      group: 16,    period: 4,  category: 'nonmetal',               electronegativity: 2.55 },
  35: { symbol: 'Br', name: 'Bromine',      mass: 79.904,   radius: 1.20, block: 'p', role: 'Ligand',              color: '#a62929',
      group: 17,    period: 4,  category: 'halogen',                electronegativity: 2.96 },
  36: { symbol: 'Kr', name: 'Krypton',      mass: 83.798,   radius: 1.16, block: 'p', role: 'Inert Gas',           color: '#5cb8d1',
      group: 18,    period: 4,  category: 'noble-gas',              electronegativity: 3.00 },
  37: { symbol: 'Rb', name: 'Rubidium',     mass: 85.468,   radius: 2.20, block: 's', role: 'Intercalant',         color: '#702eb0',
      group: 1,     period: 5,  category: 'alkali-metal',           electronegativity: 0.82 },
  38: { symbol: 'Sr', name: 'Strontium',    mass: 87.62,    radius: 1.95, block: 's', role: 'Matrix',              color: '#00ff00',
      group: 2,     period: 5,  category: 'alkaline-earth',         electronegativity: 0.95 },
  39: { symbol: 'Y',  name: 'Yttrium',      mass: 88.906,   radius: 1.90, block: 'd', role: 'Alloy Component',     color: '#94ffff',
      group: 3,     period: 5,  category: 'transition-metal',       electronegativity: 1.22 },
  40: { symbol: 'Zr', name: 'Zirconium',    mass: 91.224,   radius: 1.75, block: 'd', role: 'Alloying Agent',      color: '#94e0e0',
      group: 4,     period: 5,  category: 'transition-metal',       electronegativity: 1.33 },
  41: { symbol: 'Nb', name: 'Niobium',      mass: 92.906,   radius: 1.64, block: 'd', role: 'Refractory',          color: '#73c2c9',
      group: 5,     period: 5,  category: 'transition-metal',       electronegativity: 1.60 },
  42: { symbol: 'Mo', name: 'Molybdenum',   mass: 95.95,    radius: 1.54, block: 'd', role: 'Alloying Agent',      color: '#54b5b5',
      group: 6,     period: 5,  category: 'transition-metal',       electronegativity: 2.16 },
  43: { symbol: 'Tc', name: 'Technetium',   mass: 98.0,     radius: 1.47, block: 'd', role: 'Radioisotope',        color: '#3b9e9e',
      group: 7,     period: 5,  category: 'transition-metal',       electronegativity: 1.90 },
  44: { symbol: 'Ru', name: 'Ruthenium',    mass: 101.07,   radius: 1.46, block: 'd', role: 'Catalyst',            color: '#248f8f',
      group: 8,     period: 5,  category: 'transition-metal',       electronegativity: 2.20 },
  45: { symbol: 'Rh', name: 'Rhodium',      mass: 102.91,   radius: 1.42, block: 'd', role: 'Catalyst',            color: '#0a7d8c',
      group: 9,     period: 5,  category: 'transition-metal',       electronegativity: 2.28 },
  46: { symbol: 'Pd', name: 'Palladium',    mass: 106.42,   radius: 1.39, block: 'd', role: 'Catalyst',            color: '#006985',
      group: 10,    period: 5,  category: 'transition-metal',       electronegativity: 2.20 },
  47: { symbol: 'Ag', name: 'Silver',       mass: 107.87,   radius: 1.45, block: 'd', role: 'Conductor',           color: '#c0c0c0',
      group: 11,    period: 5,  category: 'transition-metal',       electronegativity: 1.93 },
  48: { symbol: 'Cd', name: 'Cadmium',      mass: 112.41,   radius: 1.44, block: 'd', role: 'Semiconductor',       color: '#ffd98f',
      group: 12,    period: 5,  category: 'transition-metal',       electronegativity: 1.69 },
  49: { symbol: 'In', name: 'Indium',       mass: 114.82,   radius: 1.42, block: 'p', role: 'Semiconductor',       color: '#a67573',
      group: 13,    period: 5,  category: 'post-transition-metal',  electronegativity: 1.78 },
  50: { symbol: 'Sn', name: 'Tin',          mass: 118.71,   radius: 1.39, block: 'p', role: 'Solder',              color: '#668080',
      group: 14,    period: 5,  category: 'post-transition-metal',  electronegativity: 1.96 },
  51: { symbol: 'Sb', name: 'Antimony',     mass: 121.76,   radius: 1.39, block: 'p', role: 'Dopant',              color: '#9e63b5',
      group: 15,    period: 5,  category: 'metalloid',              electronegativity: 2.05 },
  52: { symbol: 'Te', name: 'Tellurium',    mass: 127.60,   radius: 1.38, block: 'p', role: 'Chalcogen',           color: '#d47a00',
      group: 16,    period: 5,  category: 'metalloid',              electronegativity: 2.10 },
  53: { symbol: 'I',  name: 'Iodine',       mass: 126.90,   radius: 1.39, block: 'p', role: 'Ligand',              color: '#940094',
      group: 17,    period: 5,  category: 'halogen',                electronegativity: 2.66 },
  54: { symbol: 'Xe', name: 'Xenon',        mass: 131.29,   radius: 1.40, block: 'p', role: 'Inert Gas',           color: '#429eb0',
      group: 18,    period: 5,  category: 'noble-gas',              electronegativity: 2.60 },
  55: { symbol: 'Cs', name: 'Cesium',       mass: 132.91,   radius: 2.44, block: 's', role: 'Intercalant',         color: '#57178f',
      group: 1,     period: 6,  category: 'alkali-metal',           electronegativity: 0.79 },
  56: { symbol: 'Ba', name: 'Barium',       mass: 137.33,   radius: 2.15, block: 's', role: 'Matrix',              color: '#00c900',
      group: 2,     period: 6,  category: 'alkaline-earth',         electronegativity: 0.89 },
  57: { symbol: 'La', name: 'Lanthanum',    mass: 138.91,   radius: 2.07, block: 'f', role: 'Garnet Cation',       color: '#70d4ff',
      group: 3,     period: 6,  category: 'lanthanide',             electronegativity: 1.10 },
  58: { symbol: 'Ce', name: 'Cerium',       mass: 140.12,   radius: 2.04, block: 'f', role: 'Catalyst',            color: '#ffffc7',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.12 },
  59: { symbol: 'Pr', name: 'Praseodymium', mass: 140.91,   radius: 2.03, block: 'f', role: 'Magnet Component',    color: '#d9ffc7',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.13 },
  60: { symbol: 'Nd', name: 'Neodymium',    mass: 144.24,   radius: 2.01, block: 'f', role: 'Magnet Component',    color: '#c7ffc7',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.14 },
  61: { symbol: 'Pm', name: 'Promethium',   mass: 145.0,    radius: 1.99, block: 'f', role: 'Radioisotope',        color: '#a3ffc7',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.13 },
  62: { symbol: 'Sm', name: 'Samarium',     mass: 150.36,   radius: 1.98, block: 'f', role: 'Magnet Component',    color: '#8fffc7',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.17 },
  63: { symbol: 'Eu', name: 'Europium',     mass: 151.96,   radius: 1.98, block: 'f', role: 'Phosphor',            color: '#61ffc7',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.20 },
  64: { symbol: 'Gd', name: 'Gadolinium',   mass: 157.25,   radius: 1.96, block: 'f', role: 'Contrast Agent',      color: '#45ffc7',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.20 },
  65: { symbol: 'Tb', name: 'Terbium',      mass: 158.93,   radius: 1.94, block: 'f', role: 'Phosphor',            color: '#30ffc7',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.10 },
  66: { symbol: 'Dy', name: 'Dysprosium',   mass: 162.50,   radius: 1.92, block: 'f', role: 'Magnet Component',    color: '#1fffc7',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.22 },
  67: { symbol: 'Ho', name: 'Holmium',      mass: 164.93,   radius: 1.92, block: 'f', role: 'Magnet Component',    color: '#00ff9c',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.23 },
  68: { symbol: 'Er', name: 'Erbium',       mass: 167.26,   radius: 1.89, block: 'f', role: 'Phosphor',            color: '#00e675',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.24 },
  69: { symbol: 'Tm', name: 'Thulium',      mass: 168.93,   radius: 1.90, block: 'f', role: 'Phosphor',            color: '#00d452',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.25 },
  70: { symbol: 'Yb', name: 'Ytterbium',    mass: 173.05,   radius: 1.87, block: 'f', role: 'Laser Dopant',        color: '#00bf38',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.10 },
  71: { symbol: 'Lu', name: 'Lutetium',     mass: 174.97,   radius: 1.87, block: 'd', role: 'Catalyst',            color: '#00ab24',
      group: null,  period: 6,  category: 'lanthanide',             electronegativity: 1.27 },
  72: { symbol: 'Hf', name: 'Hafnium',      mass: 178.49,   radius: 1.75, block: 'd', role: 'High-K Dielectric',   color: '#4dc2ff',
      group: 4,     period: 6,  category: 'transition-metal',       electronegativity: 1.30 },
  73: { symbol: 'Ta', name: 'Tantalum',     mass: 180.95,   radius: 1.70, block: 'd', role: 'Capacitor',           color: '#4da6ff',
      group: 5,     period: 6,  category: 'transition-metal',       electronegativity: 1.50 },
  74: { symbol: 'W',  name: 'Tungsten',     mass: 183.84,   radius: 1.62, block: 'd', role: 'Refractory',          color: '#2194d6',
      group: 6,     period: 6,  category: 'transition-metal',       electronegativity: 2.36 },
  75: { symbol: 'Re', name: 'Rhenium',      mass: 186.21,   radius: 1.51, block: 'd', role: 'Catalyst',            color: '#267dab',
      group: 7,     period: 6,  category: 'transition-metal',       electronegativity: 1.90 },
  76: { symbol: 'Os', name: 'Osmium',       mass: 190.23,   radius: 1.44, block: 'd', role: 'Refractory',          color: '#266696',
      group: 8,     period: 6,  category: 'transition-metal',       electronegativity: 2.20 },
  77: { symbol: 'Ir', name: 'Iridium',      mass: 192.22,   radius: 1.41, block: 'd', role: 'Catalyst',            color: '#175487',
      group: 9,     period: 6,  category: 'transition-metal',       electronegativity: 2.20 },
  78: { symbol: 'Pt', name: 'Platinum',     mass: 195.08,   radius: 1.36, block: 'd', role: 'Catalyst',            color: '#d0d0e0',
      group: 10,    period: 6,  category: 'transition-metal',       electronegativity: 2.28 },
  79: { symbol: 'Au', name: 'Gold',         mass: 196.97,   radius: 1.36, block: 'd', role: 'Conductor',           color: '#ffd123',
      group: 11,    period: 6,  category: 'transition-metal',       electronegativity: 2.54 },
  80: { symbol: 'Hg', name: 'Mercury',      mass: 200.59,   radius: 1.32, block: 'd', role: 'Liquid Metal',        color: '#b8b8d0',
      group: 12,    period: 6,  category: 'transition-metal',       electronegativity: 2.00 },
  81: { symbol: 'Tl', name: 'Thallium',     mass: 204.38,   radius: 1.45, block: 'p', role: 'Dopant',              color: '#a6544d',
      group: 13,    period: 6,  category: 'post-transition-metal',  electronegativity: 1.62 },
  82: { symbol: 'Pb', name: 'Lead',         mass: 207.2,    radius: 1.46, block: 'p', role: 'Heavy Shield',        color: '#575961',
      group: 14,    period: 6,  category: 'post-transition-metal',  electronegativity: 2.33 },
  83: { symbol: 'Bi', name: 'Bismuth',      mass: 208.98,   radius: 1.48, block: 'p', role: 'Topological Solid',   color: '#9e4fb5',
      group: 15,    period: 6,  category: 'post-transition-metal',  electronegativity: 2.02 },
  84: { symbol: 'Po', name: 'Polonium',     mass: 209.0,    radius: 1.40, block: 'p', role: 'Radioisotope',        color: '#ab5c00',
      group: 16,    period: 6,  category: 'post-transition-metal',  electronegativity: 2.00 },
  85: { symbol: 'At', name: 'Astatine',     mass: 210.0,    radius: 1.50, block: 'p', role: 'Halogen',             color: '#754f45',
      group: 17,    period: 6,  category: 'halogen',                electronegativity: 2.20 },
  86: { symbol: 'Rn', name: 'Radon',        mass: 222.0,    radius: 1.50, block: 'p', role: 'Inert Gas',           color: '#428296',
      group: 18,    period: 6,  category: 'noble-gas',              electronegativity: 2.20 },
  // Selected actinides for hero scenes (U fission, Pu reactor, Th cycle).
  // Pyykkö 2009 single-bond covalent radii.
  88: { symbol: 'Ra', name: 'Radium',       mass: 226.0,    radius: 2.21, block: 's', role: 'Radioisotope',        color: '#42d046',
      group: 2,     period: 7,  category: 'alkaline-earth',         electronegativity: 0.90 },
  90: { symbol: 'Th', name: 'Thorium',      mass: 232.04,   radius: 2.06, block: 'f', role: 'Reactor Fuel',        color: '#00baff',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.30 },
  92: { symbol: 'U',  name: 'Uranium',      mass: 238.03,   radius: 1.96, block: 'f', role: 'Reactor Fuel',        color: '#008fff',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.38 },
  94: { symbol: 'Pu', name: 'Plutonium',    mass: 244.0,    radius: 1.87, block: 'f', role: 'Reactor Fuel',        color: '#006bff',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.28 },
  // Remaining actinides and superheavy elements. Where measured Cordero
  // values are unavailable, radii are Pyykko single-bond/theoretical values.
  87: { symbol: 'Fr', name: 'Francium',      mass: 223.0, radius: 2.60, block: 's', role: 'Radioisotope',      color: '#420066',
      group: 1,     period: 7,  category: 'alkali-metal',           electronegativity: 0.70 },
  89: { symbol: 'Ac', name: 'Actinium',      mass: 227.0, radius: 2.15, block: 'f', role: 'Radioisotope',      color: '#70abfa',
      group: 3,     period: 7,  category: 'actinide',               electronegativity: 1.10 },
  91: { symbol: 'Pa', name: 'Protactinium',  mass: 231.04, radius: 2.00, block: 'f', role: 'Radioisotope',     color: '#00a1ff',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.50 },
  93: { symbol: 'Np', name: 'Neptunium',     mass: 237.0, radius: 1.90, block: 'f', role: 'Radioisotope',      color: '#0080ff',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.36 },
  95: { symbol: 'Am', name: 'Americium',     mass: 243.0, radius: 1.80, block: 'f', role: 'Radioisotope',      color: '#545cf2',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.30 },
  96: { symbol: 'Cm', name: 'Curium',        mass: 247.0, radius: 1.69, block: 'f', role: 'Radioisotope',      color: '#785ce3',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.30 },
  97: { symbol: 'Bk', name: 'Berkelium',     mass: 247.0, radius: 1.68, block: 'f', role: 'Synthetic Element', color: '#8a4fe3',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.30 },
  98: { symbol: 'Cf', name: 'Californium',   mass: 251.0, radius: 1.68, block: 'f', role: 'Synthetic Element', color: '#a136d4',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.30 },
  99: { symbol: 'Es', name: 'Einsteinium',   mass: 252.0, radius: 1.65, block: 'f', role: 'Synthetic Element', color: '#b31fd4',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.30 },
 100: { symbol: 'Fm', name: 'Fermium',       mass: 257.0, radius: 1.67, block: 'f', role: 'Synthetic Element', color: '#b31fba',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.30 },
 101: { symbol: 'Md', name: 'Mendelevium',   mass: 258.0, radius: 1.73, block: 'f', role: 'Synthetic Element', color: '#b30da6',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.30 },
 102: { symbol: 'No', name: 'Nobelium',      mass: 259.0, radius: 1.76, block: 'f', role: 'Synthetic Element', color: '#bd0d87',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.30 },
 103: { symbol: 'Lr', name: 'Lawrencium',    mass: 266.0, radius: 1.61, block: 'd', role: 'Synthetic Element', color: '#c70066',
      group: null,  period: 7,  category: 'actinide',               electronegativity: 1.30 },
 104: { symbol: 'Rf', name: 'Rutherfordium', mass: 267.0, radius: 1.57, block: 'd', role: 'Synthetic Element', color: '#cc0059',
      group: 4,     period: 7,  category: 'transition-metal',       electronegativity: null },
 105: { symbol: 'Db', name: 'Dubnium',       mass: 268.0, radius: 1.49, block: 'd', role: 'Synthetic Element', color: '#d1004f',
      group: 5,     period: 7,  category: 'transition-metal',       electronegativity: null },
 106: { symbol: 'Sg', name: 'Seaborgium',    mass: 269.0, radius: 1.43, block: 'd', role: 'Synthetic Element', color: '#d90045',
      group: 6,     period: 7,  category: 'transition-metal',       electronegativity: null },
 107: { symbol: 'Bh', name: 'Bohrium',       mass: 270.0, radius: 1.41, block: 'd', role: 'Synthetic Element', color: '#e00038',
      group: 7,     period: 7,  category: 'transition-metal',       electronegativity: null },
 108: { symbol: 'Hs', name: 'Hassium',       mass: 269.0, radius: 1.34, block: 'd', role: 'Synthetic Element', color: '#e6002e',
      group: 8,     period: 7,  category: 'transition-metal',       electronegativity: null },
 109: { symbol: 'Mt', name: 'Meitnerium',    mass: 278.0, radius: 1.29, block: 'd', role: 'Synthetic Element', color: '#eb0026',
      group: 9,     period: 7,  category: 'transition-metal',       electronegativity: null },
 110: { symbol: 'Ds', name: 'Darmstadtium',  mass: 281.0, radius: 1.28, block: 'd', role: 'Synthetic Element', color: '#ef1b1b',
      group: 10,    period: 7,  category: 'transition-metal',       electronegativity: null },
 111: { symbol: 'Rg', name: 'Roentgenium',   mass: 282.0, radius: 1.21, block: 'd', role: 'Synthetic Element', color: '#f02617',
      group: 11,    period: 7,  category: 'transition-metal',       electronegativity: null },
 112: { symbol: 'Cn', name: 'Copernicium',   mass: 285.0, radius: 1.22, block: 'd', role: 'Synthetic Element', color: '#f02e12',
      group: 12,    period: 7,  category: 'transition-metal',       electronegativity: null },
 113: { symbol: 'Nh', name: 'Nihonium',      mass: 286.0, radius: 1.36, block: 'p', role: 'Synthetic Element', color: '#f23a0d',
      group: 13,    period: 7,  category: 'unknown',                electronegativity: null },
 114: { symbol: 'Fl', name: 'Flerovium',     mass: 289.0, radius: 1.43, block: 'p', role: 'Synthetic Element', color: '#f24608',
      group: 14,    period: 7,  category: 'unknown',                electronegativity: null },
 115: { symbol: 'Mc', name: 'Moscovium',     mass: 290.0, radius: 1.62, block: 'p', role: 'Synthetic Element', color: '#f05205',
      group: 15,    period: 7,  category: 'unknown',                electronegativity: null },
 116: { symbol: 'Lv', name: 'Livermorium',   mass: 293.0, radius: 1.75, block: 'p', role: 'Synthetic Element', color: '#ed6000',
      group: 16,    period: 7,  category: 'unknown',                electronegativity: null },
 117: { symbol: 'Ts', name: 'Tennessine',    mass: 294.0, radius: 1.65, block: 'p', role: 'Synthetic Element', color: '#e86e00',
      group: 17,    period: 7,  category: 'unknown',                electronegativity: null },
 118: { symbol: 'Og', name: 'Oganesson',     mass: 294.0, radius: 1.57, block: 'p', role: 'Synthetic Element', color: '#e17b00',
      group: 18,    period: 7,  category: 'unknown',                electronegativity: null },
};

export const ELEMENT_DATA: Record<number, ElementData> = (() => {
  const out: Record<number, ElementData> = {};
  for (const [key, raw] of Object.entries(RAW_ELEMENT_DATA)) {
    out[Number(key)] = {
      ...raw,
      displayRadius: raw.displayRadius ?? ballAndStickRadius(raw.radius),
    };
  }
  return out;
})();

export function getElementSpec(type: number): ElementData {
  if (ELEMENT_DATA[type]) return ELEMENT_DATA[type];
  const hue = (type * 137.508) % 360;
  // Unknown elements still return a usable covalent radius so bond detection
  // doesn't silently drop them. 1.40 Å is the median Cordero covalent radius
  // across the periodic table — a fair guess for "we have no idea what this
  // type is, treat it as a generic mid-row atom".
  const fallbackCovalent = 1.40;
  return {
    symbol: `X${type}`,
    name: 'Unknown Isotope',
    mass: 0.00,
    radius: fallbackCovalent,
    displayRadius: ballAndStickRadius(fallbackCovalent),
    block: '?',
    role: 'Unassigned',
    color: `hsl(${hue}, 70%, 65%)`,
    group: null,
    period: null,
    category: 'unknown' as const,
    electronegativity: null,
  };
}

// Reverse index: element symbol ("Al", "Fe", …) → spec. Built once from
// ELEMENT_DATA. Used by symbol-keyed consumers (e.g. the NIST potential
// browser, which only knows element symbols, not atomic numbers).
const ELEMENT_DATA_BY_SYMBOL: Record<string, ElementData> = (() => {
  const out: Record<string, ElementData> = {};
  for (const spec of Object.values(ELEMENT_DATA)) {
    out[spec.symbol] = spec;
  }
  return out;
})();

const ATOMIC_NUMBER_BY_SYMBOL: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const [atomicNumber, spec] of Object.entries(ELEMENT_DATA)) {
    out[spec.symbol] = Number(atomicNumber);
  }
  return out;
})();

/**
 * Look up an element spec by its symbol (case-sensitive, e.g. "Al", "Fe").
 * Returns `undefined` for unknown symbols — callers should fall back
 * (the periodic-number `getElementSpec` is the synthesizing variant).
 */
export function getElementSpecBySymbol(symbol: string): ElementData | undefined {
  return ELEMENT_DATA_BY_SYMBOL[symbol];
}

export function getAtomicNumberBySymbol(symbol: string): number | undefined {
  return ATOMIC_NUMBER_BY_SYMBOL[symbol];
}

export function hexToRgb(hex: string): [number, number, number] {
  if (hex.startsWith('hsl')) {
    // very basic fallback: mostly gray for generated ones where rgb is expected
    return [0.6, 0.6, 0.6];
  }
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [
    parseInt(result[1], 16) / 255.0,
    parseInt(result[2], 16) / 255.0,
    parseInt(result[3], 16) / 255.0,
  ] : [0.6, 0.6, 0.6];
}

/** One cell of the standard 18-column periodic-table layout. */
export interface PeriodicLayoutCell {
  /** Atomic number; null for the two f-block placeholder cells. */
  z: number | null;
  placeholder?: 'lanthanides' | 'actinides';
  /** 1–18 column. */
  col: number;
  /** Row: 1–7 main table; 9 = lanthanide row, 10 = actinide row (row 8 is a visual gap). */
  row: number;
}

/** Standard periodic-table layout, derived from ELEMENT_DATA so it cannot
 *  drift from the canonical dataset. Main-table cells sit at
 *  (col = group, row = period); the f-block is pulled out below the table
 *  with placeholder cells at group 3 of periods 6/7, and La–Lu / Ac–Lr laid
 *  out in Z order on rows 9/10, cols 3–17. (La/Ac carry group 3 in the data,
 *  but their layout cell is the f-block row — the placeholder marks the
 *  main-table slot.) Row 8 is a visual gap. */
export const PERIODIC_LAYOUT: PeriodicLayoutCell[] = (() => {
  const cells: PeriodicLayoutCell[] = [
    { z: null, placeholder: 'lanthanides', col: 3, row: 6 },
    { z: null, placeholder: 'actinides', col: 3, row: 7 },
  ];
  for (const [key, spec] of Object.entries(ELEMENT_DATA)) {
    const z = Number(key);
    if (z >= 57 && z <= 71) {
      cells.push({ z, col: 3 + (z - 57), row: 9 });
    } else if (z >= 89 && z <= 103) {
      cells.push({ z, col: 3 + (z - 89), row: 10 });
    } else if (spec.group !== null && spec.period !== null) {
      cells.push({ z, col: spec.group, row: spec.period });
    }
  }
  return cells;
})();
