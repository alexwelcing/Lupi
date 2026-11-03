import assert from 'node:assert/strict';
import test from 'node:test';
import registry from '../../web/public/launch/campaigns.json' with { type: 'json' };
import { handleLaunchRequest } from '../src/launch.ts';

const marker = '<meta name="lupi-launch" content="v1">';
const html = `<!doctype html><html><head>${marker}</head><body>Lupi launch</body></html>`;
const request = (path, init) => new Request(`https://lupi.live${path}`, init);
const binding = (body = html, headers = { 'content-type': 'text/html' }, status = 200) => ({
  async fetch() { return new Response(body, { status, headers }); },
});

test('reserves only the launch namespace and rejects unknown pages before asset fallback', async () => {
  let calls = 0;
  const fallback = { async fetch() { calls++; return new Response(html); } };
  for (const path of ['/', '/launcher/', '/launching', '/m/caffeine']) {
    assert.equal(await handleLaunchRequest(request(path), fallback), null);
  }
  for (const path of ['/launch/unknown/', '/launch/caffeine/unregistered/', '/launch/assets/',
    '/launch/caffeine/extra/path/', '/launch/%63affeine/', '/launch/model.mjs/']) {
    assert.equal((await handleLaunchRequest(request(path), fallback)).status, 404, path);
  }
  assert.equal(calls, 0);
});

test('all 16 registered pages serve marked HTML and canonicalize their trailing slash', async () => {
  const paths = ['/launch/', ...registry.campaigns.flatMap((campaign) => [
    `/launch/${campaign.slug}/`, ...campaign.placements.map((placement) => `/launch/${campaign.slug}/${placement.id}/`),
  ])];
  assert.equal(paths.length, 16);
  for (const path of paths) {
    const response = await handleLaunchRequest(request(path), binding());
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), html);
    const redirect = await handleLaunchRequest(request(`${path.slice(0, -1)}?utm_source=youtube`));
    assert.equal(redirect.status, 308, path);
    assert.equal(redirect.headers.get('location'), `${path}?utm_source=youtube`);
    assert.equal(await redirect.text(), '');
  }
});

test('GET and HEAD share document validation, omit cookies and preserve HEAD bodies', async () => {
  let fetched;
  const source = { async fetch(value) {
    fetched = value;
    return new Response(html, { headers: { 'content-type': 'text/html', 'set-cookie': 'unwanted=1', etag: 'launch-v1' } });
  } };
  const head = await handleLaunchRequest(request('/launch/caffeine/', {
    method: 'HEAD', headers: { cookie: 'private=1', authorization: 'Bearer private', range: 'bytes=0-9' },
  }), source);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(html)));
  assert.equal(head.headers.get('set-cookie'), null);
  assert.equal(head.headers.get('etag'), 'launch-v1');
  assert.equal(fetched.method, 'GET');
  assert.equal(fetched.credentials, 'omit');
  assert.equal(fetched.redirect, 'manual');
  for (const header of ['cookie', 'authorization', 'range']) assert.equal(fetched.headers.get(header), null);
  assert.equal((await handleLaunchRequest(request('/launch/nope/', { method: 'HEAD' }))).status, 404);
  assert.equal(await (await handleLaunchRequest(request('/launch/nope/', { method: 'HEAD' }))).text(), '');
});

test('missing assets and SPA fallback never masquerade as a launch page', async () => {
  assert.equal((await handleLaunchRequest(request('/launch/'))).status, 503);
  assert.equal((await handleLaunchRequest(request('/launch/'), binding('<html>Main viewer SPA</html>'))).status, 503);
  assert.equal((await handleLaunchRequest(request('/launch/'), binding(html, { 'content-type': 'text/plain' }))).status, 503);
  assert.equal((await handleLaunchRequest(request('/launch/'), binding('Missing', {}, 404))).status, 404);
  assert.equal((await handleLaunchRequest(request('/launch/'), binding('', { location: '/' }, 302))).status, 503);
  assert.equal((await handleLaunchRequest(request('/launch/'), { async fetch() { throw new Error('offline'); } })).status, 503);
  const head = await handleLaunchRequest(request('/launch/', { method: 'HEAD' }), binding('<html>SPA</html>'));
  assert.equal(head.status, 503);
  assert.equal(await head.text(), '');
});

test('only registered assets pass, with matching content types and no HTML fallback', async () => {
  const fixtures = [
    ['/launch/campaigns.json', JSON.stringify(registry), 'application/json'],
    ['/launch/model.mjs', 'export const model = true;', 'text/javascript'],
    ['/launch/page.mjs', '// owned page\nconst page = true;', 'application/javascript'],
    ['/launch/style.css', '/* owned style */ body { color: black; }', 'text/css'],
    ['/launch/assets/caffeine-app.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'],
    ['/launch/assets/c60-app.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'],
  ];
  for (const [path, body, mime] of fixtures) {
    const response = await handleLaunchRequest(request(path), binding(body, { 'content-type': mime }));
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await handleLaunchRequest(request(path), binding('<html>SPA</html>'))).status, 503, path);
    assert.equal((await handleLaunchRequest(request(path), binding('<html>SPA</html>', { 'content-type': mime }))).status, 503, path);
  }
  for (const path of ['/launch/assets/unregistered.png', '/launch/assets/water.png', '/launch/local-fonts.css',
    '/launch/campaigns.json.bak', '/launch/model.mjs/extra', '/launch/assets/caffeine-app.png/']) {
    assert.equal((await handleLaunchRequest(request(path), binding())).status, 404, path);
  }
});

test('unsupported methods and oversized documents fail without exposing content', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await handleLaunchRequest(request('/launch/caffeine/', { method }), binding());
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
  const oversized = html + ' '.repeat(256 * 1024);
  assert.equal((await handleLaunchRequest(request('/launch/'), binding(oversized))).status, 503);
  assert.equal((await handleLaunchRequest(request('/launch/'), binding(html, {
    'content-type': 'text/html', 'content-length': String(256 * 1024 + 1),
  }))).status, 503);
});
