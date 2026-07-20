export const RENDERER_REQUEST_PROTOCOL = 'lupi.renderer-request.legacy-v0.1';
export const RENDERER_RESPONSE_PROTOCOL = 'lupi.renderer-response.legacy-v0.1';
export const LEGACY_RENDERER_VERSION = 'lupi-authenticated-png@2026-07-20';
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;
export const MIN_RASTER_DIMENSION = 64;
export const MAX_RASTER_DIMENSION = 2048;
export const MAX_PROCEDURAL_ATOMS = 100_000;

const JOB_ID_PATTERN = /^job-v0-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TEMPLATE_NAMES = new Map([
  ['water', 'Water'],
  ['benzene', 'Benzene'],
  ['caffeine', 'Caffeine'],
]);
const ELEMENT_SYMBOLS = new Map([
  'H', 'He',
  'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
  'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
  'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
  'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn',
  'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr',
  'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
].map((symbol) => [symbol.toLowerCase(), symbol]));

export class RendererRequestError extends Error {
  constructor(code, message, statusCode = 422) {
    super(message);
    this.name = 'RendererRequestError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code, message, statusCode) {
  throw new RendererRequestError(code, message, statusCode);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value, path) {
  if (!isRecord(value)) fail('INVALID_REQUEST', `${path} must be a JSON object.`);
  return value;
}

function requireExactKeys(value, keys, path) {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('INVALID_REQUEST', `${path} must contain exactly: ${expected.join(', ')}.`);
  }
}

function requireString(value, path, maximumLength = 256) {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value !== value.trim()
    || value.length > maximumLength
  ) {
    fail('INVALID_REQUEST', `${path} must be a non-empty string no longer than ${maximumLength} characters.`);
  }
  return value;
}

function requireInteger(value, path, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('INVALID_REQUEST', `${path} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function requireNumber(value, path, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('INVALID_REQUEST', `${path} must be a finite number.`);
  }
  if (value < minimum || value > maximum) {
    fail('INVALID_REQUEST', `${path} must be from ${minimum} through ${maximum}.`);
  }
  return value;
}

function canonicalElement(value, path) {
  const symbol = ELEMENT_SYMBOLS.get(requireString(value, path, 3).trim().toLowerCase());
  if (!symbol) fail('UNSUPPORTED_MOLECULE', `${path} is not a recognized element symbol.`);
  return symbol;
}

function validateTemplateMolecule(molecule) {
  requireExactKeys(molecule, ['input', 'inputType'], '$.request.molecule');
  const input = requireString(molecule.input, '$.request.molecule.input', 64).trim();
  const canonicalTemplate = TEMPLATE_NAMES.get(input.toLowerCase());
  if (!canonicalTemplate) {
    fail(
      'UNSUPPORTED_MOLECULE',
      `The renderer accepts only local templates: ${[...TEMPLATE_NAMES.values()].join(', ')}.`,
    );
  }
  return { inputType: 'template', input: canonicalTemplate };
}

function validateProceduralMolecule(molecule) {
  const allowed = ['atomCount', 'element', 'input', 'inputType', 'lattice', 'spacing'];
  const actual = Object.keys(molecule);
  const unknown = actual.filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail('INVALID_REQUEST', `$.request.molecule contains unsupported field(s): ${unknown.sort().join(', ')}.`);
  }
  if (!actual.includes('input') || !actual.includes('inputType') || !actual.includes('atomCount')) {
    fail('INVALID_REQUEST', '$.request.molecule procedural input requires inputType, input, and atomCount.');
  }
  const input = requireString(molecule.input, '$.request.molecule.input', 160);
  const atomCount = requireInteger(
    molecule.atomCount,
    '$.request.molecule.atomCount',
    1,
    MAX_PROCEDURAL_ATOMS,
  );
  const element = molecule.element === undefined
    ? undefined
    : canonicalElement(molecule.element, '$.request.molecule.element');
  const lattice = molecule.lattice;
  if (lattice !== undefined && lattice !== 'sc' && lattice !== 'bcc' && lattice !== 'fcc') {
    fail('UNSUPPORTED_MOLECULE', '$.request.molecule.lattice must be sc, bcc, or fcc.');
  }
  const spacing = molecule.spacing === undefined
    ? undefined
    : requireNumber(molecule.spacing, '$.request.molecule.spacing', 0.1, 20);
  return {
    inputType: 'procedural',
    input,
    atomCount,
    ...(element === undefined ? {} : { element }),
    ...(lattice === undefined ? {} : { lattice }),
    ...(spacing === undefined ? {} : { spacing }),
  };
}

/**
 * Validate the exact legacy envelope emitted by the Cloudflare Worker. The
 * returned object contains only the fields the bounded browser executor uses.
 */
export function validateRendererEnvelope(value) {
  const envelope = requireRecord(value, '$');
  requireExactKeys(envelope, ['jobId', 'protocol', 'request'], '$');
  if (envelope.protocol !== RENDERER_REQUEST_PROTOCOL) {
    fail('UNSUPPORTED_PROTOCOL', `$.protocol must be ${RENDERER_REQUEST_PROTOCOL}.`);
  }
  const jobId = requireString(envelope.jobId, '$.jobId', 64);
  if (!JOB_ID_PATTERN.test(jobId)) fail('INVALID_JOB_ID', '$.jobId must be a job-v0 UUID generated by the Worker.');

  const request = requireRecord(envelope.request, '$.request');
  requireExactKeys(request, ['asset', 'molecule', 'rendererVersion', 'viewer'], '$.request');
  if (request.rendererVersion !== LEGACY_RENDERER_VERSION) {
    fail('UNSUPPORTED_RENDERER_VERSION', `$.request.rendererVersion must be ${LEGACY_RENDERER_VERSION}.`);
  }
  const viewer = requireRecord(request.viewer, '$.request.viewer');
  if (Object.keys(viewer).length !== 0) {
    fail('UNSUPPORTED_VIEWER_STATE', 'This bounded profile does not accept legacy viewer overrides.');
  }

  const asset = requireRecord(request.asset, '$.request.asset');
  requireExactKeys(asset, ['format', 'height', 'inline', 'maxInlineBytes', 'transparent', 'width'], '$.request.asset');
  if (asset.format !== 'png') fail('UNSUPPORTED_ASSET', '$.request.asset.format must be png.');
  if (asset.transparent !== false) fail('UNSUPPORTED_ASSET', '$.request.asset.transparent must be false.');
  if (typeof asset.inline !== 'boolean') fail('INVALID_REQUEST', '$.request.asset.inline must be a boolean.');
  requireInteger(asset.maxInlineBytes, '$.request.asset.maxInlineBytes', 1024, 64 * 1024 * 1024);
  const width = requireInteger(
    asset.width,
    '$.request.asset.width',
    MIN_RASTER_DIMENSION,
    MAX_RASTER_DIMENSION,
  );
  const height = requireInteger(
    asset.height,
    '$.request.asset.height',
    MIN_RASTER_DIMENSION,
    MAX_RASTER_DIMENSION,
  );

  const molecule = requireRecord(request.molecule, '$.request.molecule');
  const inputType = molecule.inputType;
  const browserMolecule = inputType === 'template'
    ? validateTemplateMolecule(molecule)
    : inputType === 'procedural'
      ? validateProceduralMolecule(molecule)
      : fail('UNSUPPORTED_MOLECULE', '$.request.molecule.inputType must be template or procedural.');

  return {
    jobId,
    width,
    height,
    browserMolecule,
  };
}
