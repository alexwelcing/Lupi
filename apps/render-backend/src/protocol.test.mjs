import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_RENDERER_VERSION,
  RENDERER_REQUEST_PROTOCOL,
  RendererRequestError,
  validateRendererEnvelope,
} from './protocol.mjs';

const VALID_JOB_ID = 'job-v0-123e4567-e89b-42d3-a456-426614174000';

function templateEnvelope(input = 'Caffeine') {
  return {
    protocol: RENDERER_REQUEST_PROTOCOL,
    jobId: VALID_JOB_ID,
    request: {
      molecule: { inputType: 'template', input },
      asset: {
        format: 'png',
        width: 1024,
        height: 768,
        transparent: false,
        inline: false,
        maxInlineBytes: 8 * 1024 * 1024,
      },
      viewer: {},
      rendererVersion: LEGACY_RENDERER_VERSION,
    },
  };
}

function expectRequestError(envelope, code, message) {
  assert.throws(
    () => validateRendererEnvelope(envelope),
    (error) => {
      assert.ok(error instanceof RendererRequestError);
      assert.equal(error.code, code);
      if (message) assert.match(error.message, message);
      return true;
    },
  );
}

test('accepts the exact normalized template envelope and canonicalizes local template names', () => {
  const expected = new Map([
    ['Water', 'Water'],
    ['benzene', 'Benzene'],
    ['CAFFEINE', 'Caffeine'],
  ]);
  for (const [input, canonical] of expected) {
    assert.deepEqual(validateRendererEnvelope(templateEnvelope(input)), {
      jobId: VALID_JOB_ID,
      width: 1024,
      height: 768,
      browserMolecule: { inputType: 'template', input: canonical },
    });
  }
});

test('accepts the exact procedural upper boundary without widening its semantics', () => {
  const envelope = templateEnvelope();
  envelope.request.molecule = {
    inputType: 'procedural',
    input: '100k oganesson BCC lattice',
    atomCount: 100_000,
    element: 'Og',
    lattice: 'bcc',
    spacing: 20,
  };
  envelope.request.asset.width = 64;
  envelope.request.asset.height = 2048;

  assert.deepEqual(validateRendererEnvelope(envelope), {
    jobId: VALID_JOB_ID,
    width: 64,
    height: 2048,
    browserMolecule: {
      inputType: 'procedural',
      input: '100k oganesson BCC lattice',
      atomCount: 100_000,
      element: 'Og',
      lattice: 'bcc',
      spacing: 20,
    },
  });
});

test('rejects protocol drift and non-exact envelope fields', () => {
  const wrongProtocol = templateEnvelope();
  wrongProtocol.protocol = 'lupi.renderer-request.legacy-v0';
  expectRequestError(wrongProtocol, 'UNSUPPORTED_PROTOCOL', /protocol/);

  const extraEnvelopeField = templateEnvelope();
  extraEnvelopeField.assetId = 'not-part-of-this-protocol';
  expectRequestError(extraEnvelopeField, 'INVALID_REQUEST', /exactly/);

  const viewerOverride = templateEnvelope();
  viewerOverride.request.viewer = { cameraPreset: 'iso' };
  expectRequestError(viewerOverride, 'UNSUPPORTED_VIEWER_STATE', /does not accept/);
});

test('rejects job IDs outside the Worker job-v0 UUID v4 shape', () => {
  for (const jobId of [
    'job-0123456789abcdef01234567',
    'job-v0-123e4567-e89b-12d3-a456-426614174000',
    'job-v0-123E4567-E89B-42D3-A456-426614174000',
    'job-v0-not-a-uuid',
  ]) {
    const envelope = templateEnvelope();
    envelope.jobId = jobId;
    expectRequestError(envelope, 'INVALID_JOB_ID', /job-v0 UUID/);
  }
});

test('rejects renderer-version drift', () => {
  const envelope = templateEnvelope();
  envelope.request.rendererVersion = 'lupi-render-contract@2026-07-09';
  expectRequestError(envelope, 'UNSUPPORTED_RENDERER_VERSION', /lupi-authenticated-png/);
});

test('rejects remote-looking or unknown template names and template field widening', () => {
  for (const input of ['Aspirin', 'https://example.com/molecule.xyz', '']) {
    const envelope = templateEnvelope(input);
    expectRequestError(envelope, input ? 'UNSUPPORTED_MOLECULE' : 'INVALID_REQUEST', /template|non-empty/);
  }

  const extraTemplateField = templateEnvelope();
  extraTemplateField.request.molecule.name = 'Caffeine';
  expectRequestError(extraTemplateField, 'INVALID_REQUEST', /exactly/);
});

test('rejects unsupported input kinds and every procedural safety-boundary violation', () => {
  const unsupportedKind = templateEnvelope();
  unsupportedKind.request.molecule = { inputType: 'smiles', input: 'CCO' };
  expectRequestError(unsupportedKind, 'UNSUPPORTED_MOLECULE', /template or procedural/);

  const invalidProceduralCases = [
    [{ atomCount: 0 }, 'INVALID_REQUEST', /atomCount/],
    [{ atomCount: 100_001 }, 'INVALID_REQUEST', /atomCount/],
    [{ atomCount: '1000' }, 'INVALID_REQUEST', /atomCount/],
    [{ spacing: 0.09 }, 'INVALID_REQUEST', /spacing/],
    [{ spacing: 20.01 }, 'INVALID_REQUEST', /spacing/],
    [{ spacing: '3.5' }, 'INVALID_REQUEST', /spacing/],
    [{ element: 'Xx' }, 'UNSUPPORTED_MOLECULE', /element/],
    [{ lattice: 'hcp' }, 'UNSUPPORTED_MOLECULE', /lattice/],
    [{ elements: ['Cu', 'Zr'] }, 'INVALID_REQUEST', /unsupported field/],
  ];

  for (const [patch, code, message] of invalidProceduralCases) {
    const envelope = templateEnvelope();
    envelope.request.molecule = {
      inputType: 'procedural',
      input: 'bounded copper lattice',
      atomCount: 1000,
      ...patch,
    };
    expectRequestError(envelope, code, message);
  }
});

test('rejects non-PNG, transparent, and out-of-range raster requests', () => {
  const cases = [
    [{ format: 'jpeg' }, 'UNSUPPORTED_ASSET'],
    [{ transparent: true }, 'UNSUPPORTED_ASSET'],
    [{ width: 63 }, 'INVALID_REQUEST'],
    [{ width: 2049 }, 'INVALID_REQUEST'],
    [{ height: 63 }, 'INVALID_REQUEST'],
    [{ height: 2049 }, 'INVALID_REQUEST'],
  ];
  for (const [patch, code] of cases) {
    const envelope = templateEnvelope();
    Object.assign(envelope.request.asset, patch);
    expectRequestError(envelope, code, /asset|width|height/);
  }
});
