/**
 * artDirection — the brand layer that turns a bare molecule render into a
 * "Lupi Molecular Portrait": a moody, gallery-grade composition rather than a
 * cut-out floating on a tint.
 *
 * It supplies three things the composer (printComposer.ts) needs:
 *
 *   1. A MoleculeDescriptor — the *text* of the piece: display name, the
 *      chemical formula (computed from the actual geometry, Hill order, with
 *      subscript parts), a systematic (IUPAC) name and a one-line caption for
 *      the well-known molecules, the atom count, and a molecule-derived accent
 *      colour (drawn from the characteristic heteroatom) used for the aura and
 *      keylines.
 *   2. The Lupi palette + type ramp — the design tokens every product shares so
 *      the store grid reads as one editioned series.
 *   3. ensureBrandFonts() — loads the display serif (Fraunces) and the
 *      technical mono (IBM Plex Mono) as same-origin FontFaces so the canvas
 *      typography is identical in the headless renderer and in production.
 *
 * The molecule maths is framework-free (only @atlas/core) so it can run in the
 * CLI too; the font loader is a browser-only no-op elsewhere.
 */

import { getElementSpec, type Frame } from '@atlas/core';

// ─── Descriptor ─────────────────────────────────────────────────────

export interface FormulaPart {
  /** Element symbol, e.g. "C". */
  symbol: string;
  /** Count in the molecule (rendered as a subscript when > 1). */
  count: number;
}

export interface MoleculeDescriptor {
  /** Title-case display name, e.g. "Caffeine". */
  name: string;
  /** SKU short code, e.g. "CAF". */
  code: string;
  /** Molecular formula in Hill order, e.g. [C×8, H×10, N×4, O×2]. */
  formulaParts: FormulaPart[];
  /** Flat formula string, e.g. "C8H10N4O2". */
  formula: string;
  /** Systematic name for the title block (well-known molecules only). */
  iupac?: string;
  /** One-line caption for the poster / hero tile. */
  tagline?: string;
  /** Molecule-derived accent hex (aura, hairline, ticks). */
  accent: string;
  /** Atom count, printed as an edition-style annotation. */
  atomCount: number;
}

/**
 * Curated copy for the flagship molecules — a systematic name and a short line
 * that gives the poster a voice. Unknown molecules still get a full descriptor
 * (name + formula + accent), just without the prose.
 */
const MOLECULE_META: Record<string, { iupac: string; tagline: string; accent?: string }> = {
  caffeine: {
    iupac: '1,3,7-trimethyl-3,7-dihydro-1H-purine-2,6-dione',
    tagline: 'The molecule that wakes the world.',
  },
  dopamine: {
    iupac: '4-(2-aminoethyl)benzene-1,2-diol',
    tagline: 'The shape of wanting.',
  },
  serotonin: {
    iupac: '3-(2-aminoethyl)-1H-indol-5-ol',
    tagline: 'A quiet chemistry of calm.',
  },
  creatine: {
    iupac: '2-[carbamimidoyl(methyl)amino]acetic acid',
    tagline: 'Fuel, folded into form.',
  },
  glucose: {
    iupac: '(2R,3S,4R,5R)-2,3,4,5,6-pentahydroxyhexanal',
    tagline: 'The sugar that runs on everything.',
  },
  adrenaline: {
    iupac: '4-[1-hydroxy-2-(methylamino)ethyl]benzene-1,2-diol',
    tagline: 'The body, struck by lightning.',
  },
  benzene: {
    iupac: 'benzene',
    tagline: 'Six atoms, endlessly aromatic.',
  },
  aspirin: {
    iupac: '2-(acetyloxy)benzoic acid',
    tagline: 'A century of relief, drawn small.',
  },
  testosterone: {
    iupac: '17β-hydroxyandrost-4-en-3-one',
    tagline: 'Architecture of drive.',
  },
  cholesterol: {
    iupac: 'cholest-5-en-3β-ol',
    tagline: 'The membrane, made visible.',
  },
  capsaicin: {
    iupac: '(E)-N-(4-hydroxy-3-methoxybenzyl)-8-methylnon-6-enamide',
    tagline: 'The geometry of heat.',
  },
  theobromine: {
    iupac: '3,7-dimethyl-1H-purine-2,6-dione',
    tagline: 'The gentler cousin of the cup.',
  },
  ethanol: {
    iupac: 'ethanol',
    tagline: 'Two carbons and a long history.',
  },
  water: {
    iupac: 'oxidane',
    tagline: 'The simplest reason for everything.',
  },
};

/** Normalize a molecule name to the metadata / code key. */
function metaKey(name: string): string {
  return name.trim().toLowerCase().replace(/^mcp:\s*/, '').replace(/\s+molecule$/, '');
}

/** Title-case a molecule name for display ("caffeine" → "Caffeine"). */
export function displayName(name: string): string {
  const clean = name.replace(/^MCP:\s*/i, '').replace(/\s+molecule$/i, '').trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Count elements in a frame and order them by the Hill system: carbon first,
 * hydrogen second, then every other element alphabetically. (If the molecule
 * has no carbon, all elements are listed alphabetically.) `frame.types` holds
 * atomic numbers for molecule files, so getElementSpec resolves the symbol.
 */
export function computeFormula(frame: Frame): FormulaPart[] {
  const counts = new Map<string, number>();
  for (let i = 0; i < frame.natoms; i++) {
    const symbol = getElementSpec(frame.types[i]).symbol;
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  const symbols = Array.from(counts.keys());
  const hasCarbon = counts.has('C');
  symbols.sort((a, b) => {
    if (hasCarbon) {
      if (a === 'C') return b === 'C' ? 0 : -1;
      if (b === 'C') return 1;
      if (a === 'H') return b === 'H' ? 0 : -1;
      if (b === 'H') return 1;
    }
    return a.localeCompare(b);
  });
  return symbols.map((symbol) => ({ symbol, count: counts.get(symbol)! }));
}

/** Flatten formula parts to a string, e.g. "C8H10N4O2". */
export function formulaString(parts: FormulaPart[]): string {
  return parts.map((p) => (p.count > 1 ? `${p.symbol}${p.count}` : p.symbol)).join('');
}

/**
 * Choose the accent colour that keys the whole composition. We take the CPK
 * colour of the most abundant *heteroatom* (anything that is not carbon or
 * hydrogen) — nitrogen's blue, oxygen's red, sulfur's gold — because that is
 * what visually distinguishes one molecule from the next. Pure hydrocarbons
 * fall back to a cool editorial cyan so they still read as part of the series.
 */
export function deriveAccent(frame: Frame): string {
  const heteroCounts = new Map<number, number>();
  for (let i = 0; i < frame.natoms; i++) {
    const z = frame.types[i];
    if (z === 1 || z === 6) continue; // skip H, C
    heteroCounts.set(z, (heteroCounts.get(z) ?? 0) + 1);
  }
  if (heteroCounts.size === 0) return '#5fb7c8'; // hydrocarbon → cool cyan
  let bestZ = -1;
  let bestCount = -1;
  // Deterministic: highest count, ties broken by lower atomic number.
  for (const [z, count] of Array.from(heteroCounts.entries()).sort((a, b) => a[0] - b[0])) {
    if (count > bestCount) { bestCount = count; bestZ = z; }
  }
  return getElementSpec(bestZ).color ?? '#5fb7c8';
}

/**
 * Assemble the full descriptor for a molecule from its geometry plus the
 * curated copy table.
 */
export function buildDescriptor(name: string, code: string, frame: Frame): MoleculeDescriptor {
  const key = metaKey(name);
  const meta = MOLECULE_META[key];
  const formulaParts = computeFormula(frame);
  return {
    name: displayName(name),
    code,
    formulaParts,
    formula: formulaString(formulaParts),
    iupac: meta?.iupac || undefined,
    tagline: meta?.tagline || undefined,
    accent: meta?.accent ?? deriveAccent(frame),
    atomCount: frame.natoms,
  };
}

// ─── Palette / type ramp ────────────────────────────────────────────

/** Design tokens shared by every product so the series reads as one edition. */
export const LUPI_PALETTE = {
  /** Deep-space ground (poster / hero tile), top → bottom gradient. */
  groundTop: '#0d0f18',
  groundBottom: '#050609',
  /** Warm bone text on the dark ground. */
  bone: '#ece6d8',
  /** Muted annotation text on dark. */
  boneMuted: '#8b8f9e',
  /** Charcoal ink for light substrates (white ceramic / paper). */
  ink: '#1b1d24',
  /** Muted ink for annotations on light. */
  inkMuted: '#6b6f7a',
  // ── flat-lay studio / garment tones (The Row × Magic School Bus) ──
  /** Warm studio backdrop for the lookbook flat-lays. */
  studioTop: '#dcd5c7',
  studioBottom: '#c9c0af',
  /** Signature garment colourways. */
  garmentInk: '#17171a',
  garmentBone: '#e8e2d5',
  garmentClay: '#b8a898',
  ceramic: '#f4efe7',
  /** Poster framing (mat + moulding) and gallery wall. */
  wall: '#d8d0c2',
  frameMoulding: '#1c1c1e',
} as const;

/**
 * Placement — how big the molecule is relative to the print area and where it
 * sits. Scale is expressed as a fraction of the print-area WIDTH and may exceed
 * 1 (an oversized specimen that crops at the print edge). This is the primary
 * design lever: the collection plays extremes of large and small.
 */
export interface Placement {
  /** Molecule width ÷ print-area width. >1 = oversized / cropped. */
  scale: number;
  /** Molecule centre within the print area (0..1). */
  anchor: [number, number];
}

/**
 * A Look is a styled treatment of one product — placement plus the garment
 * colourway the piece is cut in. Each product has a small wardrobe of looks
 * sitting at opposite ends of the scale axis, and every molecule×product pair
 * is assigned one, so the collection alternates extremes deliberately instead
 * of stamping one template.
 */
export interface Look {
  name: string;
  placement: Placement;
  /** Garment colourway key (garments.ts maps it to a hex). */
  colorway: 'ink' | 'bone' | 'clay' | 'ceramic';
}

/** The wardrobe: named looks per product, ordered loud → quiet. */
export const LOOKS: Record<string, Record<string, Look>> = {
  tee: {
    // The specimen blown past the print edge — worn like a body print.
    grand: { name: 'grand', placement: { scale: 1.3, anchor: [0.5, 0.34] }, colorway: 'ink' },
    // A jewel-small mark high on the left chest — pocket-print quiet.
    pocket: { name: 'pocket', placement: { scale: 0.24, anchor: [0.72, 0.14] }, colorway: 'bone' },
  },
  hat: {
    micro: { name: 'micro', placement: { scale: 0.4, anchor: [0.5, 0.44] }, colorway: 'ink' },
  },
  mug: {
    // Editorial wrap: name on one face, molecule bleeding around the other.
    wrap: { name: 'wrap', placement: { scale: 0.52, anchor: [0.75, 0.5] }, colorway: 'ceramic' },
    // A single tiny mark dead-centre on the face. Nothing else.
    mark: { name: 'mark', placement: { scale: 0.2, anchor: [0.5, 0.46] }, colorway: 'ceramic' },
  },
  poster: {
    // Small specimen adrift in a vast dark field — gallery negative space.
    specimen: { name: 'specimen', placement: { scale: 0.62, anchor: [0.5, 0.38] }, colorway: 'ink' },
    // The molecule larger than the sheet — an abstract crop of bonds/atoms.
    colossal: { name: 'colossal', placement: { scale: 1.75, anchor: [0.54, 0.36] }, colorway: 'ink' },
  },
};

/**
 * Curated look per molecule×product for the flagship editions — styled like a
 * collection: light, white-heavy molecules take the grand/dark looks; the
 * colourful heteroatom-rich ones can carry quiet looks on bone. Unlisted
 * molecules alternate extremes deterministically from the name.
 */
const LOOKBOOK: Record<string, Partial<Record<string, string>>> = {
  caffeine: { tee: 'grand', poster: 'specimen', mug: 'wrap' },
  creatine: { tee: 'grand', poster: 'colossal', mug: 'mark' },
  serotonin: { tee: 'grand', poster: 'specimen', mug: 'wrap' },
  dopamine: { tee: 'pocket', poster: 'colossal', mug: 'wrap' },
  glucose: { tee: 'pocket', poster: 'specimen', mug: 'mark' },
  adrenaline: { tee: 'grand', poster: 'colossal', mug: 'wrap' },
  benzene: { tee: 'pocket', poster: 'specimen', mug: 'mark' },
};

/** Stable tiny hash for deterministic look assignment of unknown molecules. */
function nameHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Resolve the styled look for a molecule×product pair. */
export function assignLook(moleculeName: string, productId: string): Look {
  const wardrobe = LOOKS[productId] ?? LOOKS.tee;
  const key = metaKey(moleculeName);
  const curated = LOOKBOOK[key]?.[productId];
  if (curated && wardrobe[curated]) return wardrobe[curated];
  const names = Object.keys(wardrobe);
  return wardrobe[names[nameHash(key) % names.length]];
}

/** Font stacks (Fraunces display + Plex Mono technical) with safe fallbacks. */
export const LUPI_FONTS = {
  display: '"Fraunces", "Bitstream Charter", "DejaVu Serif", Georgia, serif',
  mono: '"IBM Plex Mono", "DejaVu Sans Mono", "Liberation Mono", monospace',
} as const;

// ─── Font loading (browser only) ────────────────────────────────────

let brandFontsPromise: Promise<void> | null = null;

/**
 * Load the Lupi brand fonts as same-origin FontFaces and register them so
 * canvas text uses them. Idempotent; a no-op (resolved) where FontFace/document
 * is unavailable. Individual failures are swallowed so the composer always
 * proceeds (falling back to the serif/mono stacks above).
 */
export function ensureBrandFonts(baseUrl = ''): Promise<void> {
  if (typeof document === 'undefined' || typeof (globalThis as { FontFace?: unknown }).FontFace === 'undefined') {
    return Promise.resolve();
  }
  if (brandFontsPromise) return brandFontsPromise;
  const url = (p: string) => `url(${baseUrl}/fonts/${p}) format('woff2')`;
  brandFontsPromise = (async () => {
    const faces: FontFace[] = [
      new FontFace('Fraunces', url('fraunces-vf.woff2'), { weight: '100 900', style: 'normal', display: 'swap' }),
      new FontFace('Fraunces', url('fraunces-italic-vf.woff2'), { weight: '100 900', style: 'italic', display: 'swap' }),
      new FontFace('IBM Plex Mono', url('plexmono-400.woff2'), { weight: '400', style: 'normal', display: 'swap' }),
      new FontFace('IBM Plex Mono', url('plexmono-500.woff2'), { weight: '500', style: 'normal', display: 'swap' }),
    ];
    await Promise.all(faces.map(async (face) => {
      try {
        await face.load();
        (document.fonts as FontFaceSet).add(face);
      } catch {
        /* fall back to the stack in LUPI_FONTS */
      }
    }));
  })();
  return brandFontsPromise;
}
