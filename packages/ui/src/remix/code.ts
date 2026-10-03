/**
 * code.ts — Remix codes (`r1-K7QDM`): a short, versioned name for one look.
 *
 * A code is not a seed for whatever the viewer happens to do today. It names
 * a look in a frozen catalog, so the same code gives the same look on any
 * device, any molecule, any atom count and any later build (K09):
 *
 * - **Version.** `r1` pins this file's resolver: the catalog tables, the
 *   order of the draws and the rounding below. Changing any of them (even
 *   appending an entry) is a new version, `r2`, with its own resolver; `r1`
 *   codes keep resolving here forever.
 * - **Payload.** Five Crockford base32 characters, 25 bits: two flags and a
 *   23-bit seed.
 *   - bit 24 `colors`: the code also sets a decorative atom palette. Without
 *     it the code leaves atom colours alone (CPK stays CPK).
 *   - bit 23 `worlds`: the backdrop may be a world or a moving field.
 *   - bits 0–22: the seed of the integer-exact mulberry32 stream.
 * - **No state.** The resolver reads nothing from the viewer: not the current
 *   look, not the atom count, not a device tier. Transmission is not in the
 *   r1 catalog (it was the only atom-count-dependent choice), and every
 *   backdrop is an unadjusted preset, so a remixed view stays exportable.
 * - **Foil.** Rarity is a pure function of the code text: foil when
 *   `fmix32(fnv1a(text)) mod 24 == 0`, the finish from the next digits. A
 *   shared code carries its foil; there is no hidden state, no pity timer and
 *   no counter.
 *
 * All arithmetic is 32-bit integer or correctly rounded IEEE double, so the
 * result is bit-identical in every browser.
 */
import type { AppState } from '../store';

export const REMIX_CODE_VERSION = 1;
/** One roll in this many comes up Foil. */
export const REMIX_FOIL_ODDS = 24;

export type FoilKind = 'holo' | 'gold' | 'pearl';
export const FOIL_KINDS: readonly FoilKind[] = ['holo', 'gold', 'pearl'];
export const FOIL_LABEL: Readonly<Record<FoilKind, string>> = {
  holo: 'Holo',
  gold: 'Gold leaf',
  pearl: 'Pearl',
};
/** What each finish does, for titles and screen readers. */
export const FOIL_DESCRIPTION: Readonly<Record<FoilKind, string>> = {
  holo: 'a thin-film rainbow on the rims that slides as you turn it',
  gold: 'a gold-leaf rim and gilded bond edges; the atoms keep their colours',
  pearl: 'a soft nacre sheen over every atom',
};
/** The published odds, as the tray and the sheet print them. */
export const FOIL_ODDS_TEXT = `Foil 1 in ${REMIX_FOIL_ODDS} · each finish 1 in ${REMIX_FOIL_ODDS * FOIL_KINDS.length}`;

export interface RemixCode {
  version: 1;
  /** The 25-bit payload. */
  payload: number;
  seed: number;
  /** The code sets a decorative atom palette. */
  colors: boolean;
  /** The backdrop may be a world or a moving field. */
  worlds: boolean;
  /** Canonical text, e.g. `r1-K7QDM`. */
  text: string;
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHARS = 5;
const SEED_BITS = 23;
export const REMIX_SEED_MASK = (1 << SEED_BITS) - 1;
const WORLDS_BIT = 1 << SEED_BITS;
const COLORS_BIT = 1 << (SEED_BITS + 1);
const PAYLOAD_MASK = (1 << (CHARS * 5)) - 1;

// ── Codec ─────────────────────────────────────────────────────────────

function encodePayload(payload: number): string {
  let out = '';
  for (let i = CHARS - 1; i >= 0; i -= 1) out += ALPHABET[(payload >>> (i * 5)) & 31];
  return out;
}

/** Crockford decoding: case-insensitive, I and L read as 1, O as 0. */
function decodeChar(char: string): number {
  const c = char.toUpperCase();
  if (c === 'I' || c === 'L') return 1;
  if (c === 'O') return 0;
  return ALPHABET.indexOf(c);
}

/** The code for a payload (flags and seed). */
export function remixCodeFromPayload(payload: number): RemixCode {
  const p = (payload >>> 0) & PAYLOAD_MASK;
  return {
    version: 1,
    payload: p,
    seed: p & REMIX_SEED_MASK,
    colors: (p & COLORS_BIT) !== 0,
    worlds: (p & WORLDS_BIT) !== 0,
    text: `r${REMIX_CODE_VERSION}-${encodePayload(p)}`,
  };
}

/** The code for a seed and flags. */
export function makeRemixCode(seed: number, flags: { colors: boolean; worlds: boolean }): RemixCode {
  return remixCodeFromPayload(
    (seed & REMIX_SEED_MASK) | (flags.worlds ? WORLDS_BIT : 0) | (flags.colors ? COLORS_BIT : 0),
  );
}

export type RemixCodeParse =
  | { ok: true; code: RemixCode }
  | { ok: false; reason: 'empty' | 'shape' | 'version'; version?: number };

const PARAM_RE = /[?&#]remix=([^&#\s]+)/i;

/**
 * Read a code as a person types or pastes it: `r1-K7QDM`, `R1 k7qdm`,
 * `r1k7qdm`, a bare `K7QDM` (taken as r1), or a whole link with `remix=`.
 */
export function parseRemixCode(input: string): RemixCodeParse {
  let text = (input ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  const param = PARAM_RE.exec(text);
  if (param) {
    try {
      text = decodeURIComponent(param[1]);
    } catch {
      text = param[1];
    }
  }
  const compact = text.replace(/[\s\-_.·:]/g, '').toUpperCase();
  if (!compact) return { ok: false, reason: 'empty' };
  let version = REMIX_CODE_VERSION;
  let body = compact;
  // `R` + one or two version digits + the five payload characters (the
  // payload may itself start with digits, so split from the end).
  const digits = compact.slice(1, -CHARS);
  if (compact[0] === 'R' && compact.length > CHARS + 1 && /^\d{1,2}$/.test(digits)) {
    version = Number(digits);
    body = compact.slice(-CHARS);
  }
  if (body.length !== CHARS) return { ok: false, reason: 'shape' };
  if (version !== REMIX_CODE_VERSION) return { ok: false, reason: 'version', version };
  let payload = 0;
  for (const char of body) {
    const value = decodeChar(char);
    if (value < 0) return { ok: false, reason: 'shape' };
    payload = payload * 32 + value;
  }
  return { ok: true, code: remixCodeFromPayload(payload) };
}

const TEXT_CODE_RE = /(?:^|[^0-9a-z])(r\d{1,2}[-\s]?[0-9a-z]{5})(?![0-9a-z])/i;

/**
 * A code inside pasted text, only when it is unmistakably one (the `r1-`
 * prefix or a `remix=` link). Bare five-letter words are never taken.
 */
export function findRemixCodeInText(text: string): RemixCodeParse | null {
  if (!text) return null;
  if (PARAM_RE.test(text)) return parseRemixCode(text);
  const match = TEXT_CODE_RE.exec(text);
  return match ? parseRemixCode(match[1]) : null;
}

/** Why a typed code was refused, in words. */
export function remixParseMessage(parse: RemixCodeParse): string {
  if (parse.ok) return '';
  if (parse.reason === 'version') return `That code is from a newer Lupi (r${parse.version}). Reload to get it.`;
  if (parse.reason === 'empty') return 'Type or paste a code like r1-K7QDM.';
  return 'Codes look like r1-K7QDM: five letters and digits after r1-.';
}

// ── Hashes and the integer stream ────────────────────────────────────

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** murmur3's finalizer: spreads every input bit over the low bits mod 24 reads. */
function fmix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** The finish a code carries, or null (about 23 codes in 24). */
export function remixFoil(code: RemixCode): FoilKind | null {
  const h = fmix32(fnv1a(code.text));
  if (h % REMIX_FOIL_ODDS !== 0) return null;
  return FOIL_KINDS[Math.floor(h / REMIX_FOIL_ODDS) % FOIL_KINDS.length];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── The r1 catalog (frozen: any change is r2) ────────────────────────

/** Unadjusted gradient backdrops. */
const R1_GRADIENTS = [
  'sage-plate', 'gallery-studio', 'slate', 'midnight', 'studio', 'warm',
  'fog', 'deep', 'dark', 'blueprint', 'white', 'void',
] as const;
/** Light backdrops get the Paper post and a neutral rig. */
const R1_LIGHT_BACKDROPS: readonly string[] = ['white'];
/** Worlds and moving fields (the `worlds` flag). */
const R1_WORLDS = [
  'manifold-field', 'hopf-current', 'harmonic-bloom', 'reaction-lattice', 'moire-crystal',
  'nebula', 'aurora', 'neutral-atrium', 'graphite-orbit', 'cryo-haze', 'spectrum-quiet',
  'quantum-fog', 'protein-dream', 'enzyme-aurora', 'xray-lagoon', 'iridescent',
] as const;

interface R1Recipe {
  scene: string;
  material: Exclude<AppState['materialPreset'], 'transmission'>;
  post: AppState['postprocessPreset'];
}
/** The material recipes (MATERIAL_SCENES ids), transmission excluded. */
const R1_RECIPES: readonly R1Recipe[] = [
  { scene: 'laboratory', material: 'default', post: 'paper' },
  { scene: 'specimen', material: 'default', post: 'studio' },
  { scene: 'blueprint', material: 'matte', post: 'diagram' },
  { scene: 'forge', material: 'metallic', post: 'studio' },
  { scene: 'crystallography', material: 'glass', post: 'editorial' },
  { scene: 'deep_space', material: 'default', post: 'cinematic' },
  { scene: 'holograph', material: 'glass', post: 'editorial' },
  { scene: 'subsurface', material: 'plastic', post: 'studio' },
  { scene: 'picnic', material: 'default', post: 'cinematic' },
];
/** Fill and rim light colours, chosen as designed pairs. */
const R1_LIGHT_PAIRS: readonly (readonly [string, string])[] = [
  ['#b5d8ff', '#8bdeff'],
  ['#d5b6ff', '#ffb7df'],
  ['#ffe1b8', '#ffe9bc'],
  ['#a7eadb', '#bbffde'],
  ['#dfe8ef', '#ffffff'],
  ['#bda9ff', '#76efff'],
  ['#d5ef9c', '#e9f7c8'],
  ['#ffc9a8', '#9fd8ff'],
];
const R1_STYLES = ['radial', 'radial', 'spotlight', 'linear'] as const;
const R1_TEXTURES = ['none', 'none', 'none', 'noise'] as const;
/** The filter shell is mostly off: it hides the floor shadow and crowds small molecules. */
const R1_SHELLS = ['off', 'off', 'off', 'off', 'off', 'off', 'off', 'off', 'sphere', 'sphere', 'sphere', 'cube'] as const;
const R1_SHELL_PRESETS = ['prism', 'cryo', 'haze', 'graphite'] as const;
const R1_COLORMAPS = [
  'viridis', 'plasma', 'inferno', 'coolwarm', 'turbo', 'neon', 'cyberpunk', 'sunset', 'ocean', 'vaporwave',
] as const;

/** The look keys a code sets (without the viewer's own motion pause). */
export type RemixLook = Pick<AppState,
  | 'backgroundPreset' | 'backgroundStyle' | 'backgroundBackdropShape' | 'backgroundBackdropPattern'
  | 'backgroundOpacity' | 'backgroundBrightness' | 'backgroundSaturation' | 'backgroundContrast'
  | 'backgroundMotionSpeed' | 'backgroundYawDegrees' | 'backgroundPitchDegrees'
  | 'materialScene' | 'materialPreset' | 'materialIntensity' | 'environmentPreset' | 'atomTexture'
  | 'surfaceRoughness' | 'surfacePolish' | 'surfaceClearcoat'
  | 'ambientLightIntensity' | 'dirLightIntensity' | 'rimLightIntensity'
  | 'keyLightAzimuth' | 'keyLightElevation' | 'fillLightAzimuth' | 'fillLightElevation'
  | 'rimLightAzimuth' | 'rimLightElevation' | 'fillLightColor' | 'rimLightColor'
  | 'filterShellShape' | 'filterShellPreset' | 'filterShellOpacity' | 'filterShellRadius'
  | 'postprocessPreset' | 'postprocessIntensity' | 'effectOverrides'
> & Partial<Pick<AppState, 'colorScheme' | 'atomColorSource' | 'colorMode' | 'colorProperty' | 'colormap'>>;

/**
 * The look a code names (r1). Every draw happens whatever the flags say, so
 * the same seed with a flag toggled changes only the backdrop or the palette.
 */
export function resolveRemixCode(code: RemixCode): RemixLook {
  const random = mulberry32(fmix32(code.payload ^ 0x52454d58));
  const pick = <T,>(items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  const between = (min: number, max: number) => Math.round((min + random() * (max - min)) * 100) / 100;

  const gradient = pick(R1_GRADIENTS);
  const world = pick(R1_WORLDS);
  const useWorld = random() < 0.5;
  const backgroundPreset: string = code.worlds && useWorld ? world : gradient;
  const light = R1_LIGHT_BACKDROPS.includes(backgroundPreset);
  const recipe = pick(R1_RECIPES);
  const style = pick(R1_STYLES);
  const pair = pick(R1_LIGHT_PAIRS);
  const look: RemixLook = {
    backgroundPreset,
    backgroundStyle: style,
    backgroundBackdropShape: 'dome',
    backgroundBackdropPattern: 'image',
    backgroundOpacity: 1,
    backgroundBrightness: 1,
    backgroundSaturation: 1,
    backgroundContrast: 1,
    backgroundMotionSpeed: between(0.35, 0.8),
    backgroundYawDegrees: 0,
    backgroundPitchDegrees: 0,
    materialScene: recipe.scene,
    materialPreset: recipe.material,
    materialIntensity: between(0.45, 0.95),
    environmentPreset: 'softbox',
    atomTexture: pick(R1_TEXTURES),
    surfaceRoughness: between(-0.1, 0.3),
    surfacePolish: between(0.1, 0.6),
    surfaceClearcoat: between(0.15, 0.7),
    ambientLightIntensity: between(0.45, 0.85),
    dirLightIntensity: between(1.1, 2.2),
    rimLightIntensity: between(0.2, 0.8),
    keyLightAzimuth: between(-90, 90),
    keyLightElevation: between(25, 70),
    fillLightAzimuth: between(-160, -70),
    fillLightElevation: between(5, 30),
    rimLightAzimuth: between(110, 180),
    rimLightElevation: between(20, 60),
    fillLightColor: light ? '#dfe8ef' : pair[0],
    rimLightColor: light ? '#ffffff' : pair[1],
    filterShellShape: pick(R1_SHELLS),
    filterShellPreset: pick(R1_SHELL_PRESETS),
    filterShellOpacity: between(0.22, 0.42),
    filterShellRadius: between(1.04, 1.14),
    postprocessPreset: light && recipe.post !== 'diagram' ? 'paper' : recipe.post,
    postprocessIntensity: between(0.8, 1.1),
    effectOverrides: null,
  };
  const colormap = pick(R1_COLORMAPS);
  if (code.colors) {
    look.colorScheme = 'colorway';
    look.atomColorSource = 'colormap';
    look.colorMode = 'type';
    look.colorProperty = null;
    look.colormap = colormap;
  }
  return look;
}

/** The parts of a viewer state a roll must change to read as new. */
export interface RemixRollBase {
  backgroundPreset: string;
  materialScene: string;
  colormap?: string;
}

/**
 * Roll a new code: a fresh random seed, stepped until its look differs from
 * `base` in backdrop and recipe (and palette, when the code sets one). The
 * code itself stays a pure function; only the roll looks at the viewer.
 */
export function rollRemixCode(
  base: RemixRollBase,
  flags: { colors: boolean; worlds: boolean },
  random: () => number = Math.random,
): RemixCode {
  const start = Math.floor(Math.max(0, Math.min(0.999999999, random())) * (REMIX_SEED_MASK + 1)) & REMIX_SEED_MASK;
  let code = makeRemixCode(start, flags);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    code = makeRemixCode((start + attempt * 0x2545f5) & REMIX_SEED_MASK, flags);
    const look = resolveRemixCode(code);
    const fresh = look.backgroundPreset !== base.backgroundPreset
      && look.materialScene !== base.materialScene
      && (!flags.colors || look.colormap !== base.colormap);
    if (fresh) return code;
  }
  return code;
}
