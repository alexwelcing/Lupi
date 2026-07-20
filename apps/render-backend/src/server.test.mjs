import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createRenderHttpServer,
  requireRendererToken,
  stopRenderServer,
} from './server.mjs';
import {
  LEGACY_RENDERER_VERSION,
  MAX_REQUEST_BODY_BYTES,
  RENDERER_REQUEST_PROTOCOL,
  RENDERER_RESPONSE_PROTOCOL,
} from './protocol.mjs';

const TOKEN = 'focused-renderer-test-token';
let baseUrl;
let renderCalls = 0;
let renderImplementation = async () => {
  throw new Error('The HTTP boundary tests must never enter the browser render lane.');
};
let server;

before(async () => {
  server = createRenderHttpServer({
    token: TOKEN,
    renderDeadlineMs: 5_000,
    renderJob: async (job, deadlineAt) => {
      renderCalls += 1;
      return renderImplementation(job, deadlineAt);
    },
    readLaneState: () => ({ active: false, queued: 0 }),
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) await stopRenderServer(server);
});

async function responseJson(response) {
  return JSON.parse(await response.text());
}

function validEnvelope() {
  return {
    protocol: RENDERER_REQUEST_PROTOCOL,
    jobId: 'job-v0-123e4567-e89b-42d3-a456-426614174000',
    request: {
      molecule: { inputType: 'template', input: 'Water' },
      asset: {
        format: 'png',
        width: 64,
        height: 64,
        transparent: false,
        inline: false,
        maxInlineBytes: 8192,
      },
      viewer: {},
      rendererVersion: LEGACY_RENDERER_VERSION,
    },
  };
}

test('requireRendererToken fails closed and trims a configured secret', () => {
  assert.throws(() => requireRendererToken({}), /RENDERER_TOKEN is required/);
  assert.throws(() => requireRendererToken({ RENDERER_TOKEN: '' }), /RENDERER_TOKEN is required/);
  assert.throws(() => requireRendererToken({ RENDERER_TOKEN: '   ' }), /RENDERER_TOKEN is required/);
  assert.equal(requireRendererToken({ RENDERER_TOKEN: `  ${TOKEN}  ` }), TOKEN);
});

test('health is unauthenticated, bounded, and does not reveal the renderer token', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text();
  assert.equal(text.includes(TOKEN), false);
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.equal(body.service, 'lupi-render-backend');
  assert.equal(body.profile.maxBodyBytes, MAX_REQUEST_BODY_BYTES);
  assert.deepEqual(body.lane, { active: false, queued: 0 });
});

test('render route requires POST and rejects every other path', async () => {
  const wrongMethod = await fetch(`${baseUrl}/render`);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');

  const wrongPath = await fetch(`${baseUrl}/`);
  assert.equal(wrongPath.status, 404);
});

test('render route rejects non-JSON content before reading or rendering', async () => {
  const response = await fetch(`${baseUrl}/render`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'text/plain',
    },
    body: '{}',
  });
  assert.equal(response.status, 415);
  assert.equal((await responseJson(response)).error.code, 'UNSUPPORTED_MEDIA_TYPE');
  assert.equal(renderCalls, 0);
});

test('render route requires the exact bearer token', async () => {
  for (const authorization of [undefined, 'Bearer wrong-token', TOKEN]) {
    const headers = { 'content-type': 'application/json' };
    if (authorization !== undefined) headers.authorization = authorization;
    const response = await fetch(`${baseUrl}/render`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.equal(response.status, 401);
    assert.equal((await responseJson(response)).error.code, 'UNAUTHORIZED');
  }
  assert.equal(renderCalls, 0);
});

test('render route rejects bodies over 256 KiB before JSON parsing or rendering', async () => {
  const response = await fetch(`${baseUrl}/render`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1),
  });
  assert.equal(response.status, 413);
  assert.equal((await responseJson(response)).error.code, 'BODY_TOO_LARGE');
  assert.equal(renderCalls, 0);
});

test('authenticated malformed envelopes fail protocol validation without entering Chromium', async () => {
  const response = await fetch(`${baseUrl}/render`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: '{}',
  });
  assert.equal(response.status, 422);
  assert.equal((await responseJson(response)).error.code, 'INVALID_REQUEST');
  assert.equal(renderCalls, 0);
});

test('authenticated valid envelopes reach only the injected lane and preserve response identity', async () => {
  const png = Buffer.from([137, 80, 78, 71]);
  const browserReceipt = {
    provenanceOnly: true,
    identifiesResponseAsset: false,
    artifactDigest: 'sha256:browser-only',
  };
  renderImplementation = async (job, deadlineAt) => {
    assert.equal(job.jobId, validEnvelope().jobId);
    assert.equal(job.width, 64);
    assert.equal(job.height, 64);
    assert.ok(deadlineAt > Date.now());
    return { png, browserReceipt };
  };

  const response = await fetch(`${baseUrl}/render`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(validEnvelope()),
  });
  assert.equal(response.status, 200);
  const body = await responseJson(response);
  assert.equal(body.protocol, RENDERER_RESPONSE_PROTOCOL);
  assert.equal(body.jobId, validEnvelope().jobId);
  assert.deepEqual(body.asset, {
    mimeType: 'image/png',
    width: 64,
    height: 64,
    byteLength: png.length,
    dataBase64: png.toString('base64'),
  });
  assert.deepEqual(body.browserReceipt, browserReceipt);
  assert.equal(renderCalls, 1);
});
