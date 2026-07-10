/**
 * Lupi render backend — HTTP service implementing the Cloudflare mcp-worker
 * renderer handoff contract, plus a merch design API with product-level control.
 *
 * Endpoints:
 *   GET  /health           — readiness + viewer bridge status
 *   POST /                 — mcp-worker contract: {jobId, assetId, request} -> {asset:{dataBase64,...}}
 *                            (request.viewer.lupiColorway selects a colorway; transparent -> matted)
 *   POST /v1/merch-asset   — design API: {molecule, colorway, product, size?, masterSize?}
 *                            -> {asset:{dataBase64, mimeType, width, height}, design:{...}}
 *
 * Env: PORT (8080), RENDERER_TOKEN (optional bearer auth), VIEWER_URL (default https://lupi.live)
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMolecule, applyColorway, renderTransparentMaster, composeProduct, shutdown } from './engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const COLORWAYS = Object.fromEntries(JSON.parse(readFileSync(join(HERE, 'colorways.json'), 'utf8')).colorways.map((c) => [c.id, c]));
const PRODUCTS = JSON.parse(readFileSync(join(HERE, 'products.json'), 'utf8'));

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.RENDERER_TOKEN || '';

let busy = Promise.resolve(); // single render lane: the viewer page is stateful

function enqueue(fn) {
  const run = busy.then(fn, fn);
  busy = run.catch(() => {});
  return run;
}

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
  req.on('error', reject);
});

const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

async function renderWorkerContract(payload) {
  const req = payload.request || {};
  const molecule = req.molecule || { inputType: 'name', input: 'caffeine' };
  const asset = req.asset || {};
  const viewer = req.viewer || {};
  const size = Math.min(4096, Math.max(64, asset.width || 2160));
  const cwId = viewer.lupiColorway;
  const cw = cwId ? COLORWAYS[cwId] : null;
  if (cwId && !cw) throw new Error(`unknown colorway: ${cwId}`);

  await loadMolecule(molecule);
  if (cw) await applyColorway(cw);

  let png;
  if (asset.transparent) {
    png = await renderTransparentMaster(size);
  } else {
    // opaque render composited onto the colorway poster background (or deep default)
    const master = await renderTransparentMaster(size);
    png = await composeProduct(master, { px: [size, size], background: cw ? 'colorway' : '#06080d', contentWidthFraction: 0.78 }, cw || { poster_bg: '#06080d' });
  }
  const sha256 = createHash('sha256').update(png).digest('hex');
  return {
    jobId: payload.jobId,
    assetId: payload.assetId,
    asset: { dataBase64: png.toString('base64'), mimeType: 'image/png', sha256, byteLength: png.length },
  };
}

async function renderMerchAsset(body) {
  const cw = COLORWAYS[body.colorway];
  if (!cw) throw new Error(`unknown colorway: ${body.colorway} (have: ${Object.keys(COLORWAYS).join(', ')})`);
  const product = PRODUCTS[body.product];
  if (!product) throw new Error(`unknown product: ${body.product} (have: ${Object.keys(PRODUCTS).join(', ')})`);
  const masterSize = Math.min(4096, body.masterSize || 2160);
  const molecule = typeof body.molecule === 'string' ? { inputType: 'name', input: body.molecule } : body.molecule;

  await loadMolecule(molecule);
  await applyColorway(cw);
  const master = await renderTransparentMaster(masterSize);
  const overrides = body.layout ? { ...product, ...body.layout } : product;
  const png = product.master === true ? master : await composeProduct(master, overrides, cw);
  const meta = { product: body.product, colorway: cw.id, px: product.master ? 'trimmed-master' : product.px, dpi: product.dpi ?? null };
  return { asset: { dataBase64: png.toString('base64'), mimeType: 'image/png', byteLength: png.length }, design: meta };
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true, service: 'lupi-render-backend', colorways: Object.keys(COLORWAYS), products: Object.keys(PRODUCTS) });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    if (TOKEN) {
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'unauthorized' });
    }
    const body = await readBody(req);
    if (req.url === '/' || req.url === '/render') {
      const out = await enqueue(() => renderWorkerContract(body));
      return send(res, 200, out);
    }
    if (req.url === '/v1/merch-asset') {
      const out = await enqueue(() => renderMerchAsset(body));
      return send(res, 200, out);
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String(e && e.message || e).slice(0, 400) });
  }
});

server.listen(PORT, () => console.log(`[render-backend] listening :${PORT}`));
process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
