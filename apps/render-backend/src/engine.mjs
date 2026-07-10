/**
 * Lupi render engine — drives the LUPI viewer (production or a co-deployed build)
 * through the in-page MCP bridge (`__lupiViewerMcp`, v2026-07-07.asset-export+)
 * to produce print-grade molecule assets with design-level control:
 *
 *   - PCA auto-orientation: every molecule presents its principal structural plane.
 *   - Colorways: per-element color maps applied through the viewer's Controls panel.
 *   - True transparency: dual-pass difference matting (the viewer's export path is
 *     opaque; we render on two known background plates and solve for alpha).
 *   - Product renditions: exact-pixel poster/apparel/mug composites via sharp.
 *
 * All viewer calls run with in-page timeouts + one retry — a render can fail, but
 * it can never hang the service.
 */
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const VIEWER_URL = process.env.VIEWER_URL || 'https://lupi.live/?sim=caffeine';
const BG_DARK = 'off';
const BG_LIGHT = 'pub-figure-neutral';

let browser = null;
let page = null;
let controlsOpen = false;
const plateCache = new Map(); // `${size}` -> { dark: Buffer(raw), light: Buffer(raw), info }

async function ensurePage() {
  if (page && !page.isClosed()) return page;
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--renderer-process-limit=1', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
    });
  }
  const ctx = await browser.newContext({
    viewport: { width: 840, height: 840 },
    // A default headless UA trips bot protection in front of production lupi.live.
    // Harmless for the in-container localhost viewer; required for VIEWER_URL=https://lupi.live.
    userAgent: process.env.RENDER_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  page = await ctx.newPage();
  controlsOpen = false;
  plateCache.clear();
  await page.goto(VIEWER_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__lupiViewerMcpReady === true, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  return page;
}

async function openControls() {
  if (controlsOpen) return;
  const p = await ensurePage();
  await p.getByRole('button', { name: 'Controls' }).click({ timeout: 15000 });
  await p.waitForTimeout(500);
  controlsOpen = true;
}

/** Bridge call with an in-page timeout and one retry — never hangs. */
async function call(tool, args, ms = 30000) {
  const p = await ensurePage();
  const once = () => p.evaluate(async ({ tool, args, ms }) => {
    const timeout = new Promise((res) => setTimeout(() => res({ ok: false, err: `IN-PAGE TIMEOUT ${ms}ms` }), ms));
    const run = window.__lupiViewerMcp.execute({ tool, arguments: args }).then((r) => {
      if (r?.result?.asset?.dataBase64) {
        return { ok: r.ok, b64: r.result.asset.dataBase64, mime: r.result.asset.mimeType };
      }
      if (r?.result?.export?.contents) return { ok: r.ok, text: r.result.export.contents };
      return { ok: r.ok, err: r.error?.message };
    }).catch((e) => ({ ok: false, err: String(e).slice(0, 200) }));
    return await Promise.race([run, timeout]);
  }, { tool, args, ms });
  let r = await once();
  if (!r.ok && /TIMEOUT/.test(r.err || '')) r = await once();
  if (!r.ok) throw new Error(`${tool}: ${r.err}`);
  return r;
}

/** Load a molecule (gallery URL when available, else resolver) and face its principal plane. */
export async function loadMolecule(molecule) {
  const p = await ensurePage();
  let loaded = false;
  if (molecule.galleryId || (molecule.inputType === 'name' && molecule.input)) {
    const id = (molecule.galleryId || molecule.input).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
    const status = await p.evaluate(async (u) => (await fetch(u, { method: 'HEAD' })).status, `/gallery/curated/popular/${id}.xyz`);
    if (status === 200) {
      await call('lupi.load_molecule_url', { url: `/gallery/curated/popular/${id}.xyz` });
      loaded = true;
    }
  }
  if (!loaded) {
    await call('lupi.generate_molecule', { ...molecule }, 45000);
  }
  await call('lupi.set_viewer', { postprocessPreset: 'studio' });
  await p.waitForTimeout(2200);
  await orientToPrincipalPlane();
}

/** PCA of atom coordinates -> camera on the least-variance axis, tight framing. */
async function orientToPrincipalPlane(fov = 35, fillMargin = 1.12) {
  const xyz = (await call('lupi.export_xyz', {})).text;
  const rows = String(xyz).trim().split('\n').slice(2).map((l) => l.trim().split(/\s+/));
  const pts = rows.map((t) => [parseFloat(t[1]), parseFloat(t[2]), parseFloat(t[3])]).filter((v) => v.every(Number.isFinite));
  if (pts.length < 2) { await call('lupi.fit_camera', {}); return; }
  const n = pts.length;
  const c = [0, 1, 2].map((i) => pts.reduce((s, q) => s + q[i], 0) / n);
  const X = pts.map((q) => [q[0] - c[0], q[1] - c[1], q[2] - c[2]]);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const v of X) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += (v[i] * v[j]) / n;
  const mul = (M, v) => [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
  const nrm = (v) => { const L = Math.hypot(...v) || 1; return v.map((x) => x / L); };
  const pit = (M) => { let v = nrm([0.7, 0.5, 0.51]); for (let k = 0; k < 80; k++) v = nrm(mul(M, v)); return v; };
  const v1 = pit(C);
  const l1 = mul(C, v1).reduce((s, x, i) => s + x * v1[i], 0);
  const D = C.map((row, i) => row.map((x, j) => x - l1 * v1[i] * v1[j]));
  const v2 = pit(D);
  const v3 = nrm([v1[1] * v2[2] - v1[2] * v2[1], v1[2] * v2[0] - v1[0] * v2[2], v1[0] * v2[1] - v1[1] * v2[0]]);
  let h = 0;
  for (const v of X) h = Math.max(h, Math.abs(v[0] * v1[0] + v[1] * v1[1] + v[2] * v1[2]), Math.abs(v[0] * v2[0] + v[1] * v2[1] + v[2] * v2[2]));
  h += 1.6;
  const dist = (h / Math.tan((fov / 2) * (Math.PI / 180))) * fillMargin;
  await call('lupi.set_camera', { position: [v3[0] * dist, v3[1] * dist, v3[2] * dist], target: [0, 0, 0], fov });
  await (await ensurePage()).waitForTimeout(300);
}

/** Apply a colorway's per-element map through the Controls panel (React-safe native setters). */
export async function applyColorway(cw) {
  await openControls();
  const p = await ensurePage();
  await p.getByRole('button', { name: 'Element', exact: true }).click({ timeout: 10000 });
  await p.waitForTimeout(150);
  const opts = await p.evaluate(() => {
    const sel = Array.from(document.querySelectorAll('select')).find((s) => /\b[A-Z][a-z]?\s*\d+/.test(s.textContent));
    if (!sel) return null;
    sel.setAttribute('data-lupi-elsel', '1');
    return Array.from(sel.options).map((o) => ({ value: o.value, text: o.textContent.trim() }));
  });
  if (!opts) throw new Error('element color select not found in Controls panel');
  for (const o of opts) {
    const sym = (o.text.match(/^[A-Za-z]{1,2}/) || [o.value])[0];
    const hex = cw.elements[sym] || cw.elements.default;
    if (!hex) continue;
    await p.evaluate(({ v, hex }) => {
      const sel = document.querySelector('select[data-lupi-elsel]');
      const setSel = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setSel.call(sel, v);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      const inp = document.querySelector('input[type="color"]');
      if (!inp) throw new Error('no color input');
      const setInp = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setInp.call(inp, hex);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }, { v: o.value, hex });
    await p.waitForTimeout(90);
  }
}

async function exportPng(size, baseName) {
  const r = await call('lupi.export_asset', { format: 'png', width: size, height: size, baseName, fitCamera: false }, 90000);
  return Buffer.from(r.b64, 'base64');
}

async function setBackground(preset) {
  await call('lupi.set_background', { preset, motionPaused: true });
  await (await ensurePage()).waitForTimeout(300);
}

async function rawPixels(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

/** Capture (and cache) the two background plates for a size, with atoms hidden. */
async function plates(size) {
  const key = String(size);
  if (plateCache.has(key)) return plateCache.get(key);
  await call('lupi.set_atom_visibility', { hiddenAtomTypes: Array.from({ length: 118 }, (_, i) => i + 1) });
  await (await ensurePage()).waitForTimeout(250);
  await setBackground(BG_DARK);
  const dark = await rawPixels(await exportPng(size, 'plate-dark'));
  await setBackground(BG_LIGHT);
  const light = await rawPixels(await exportPng(size, 'plate-light'));
  await call('lupi.set_atom_visibility', { hiddenAtomTypes: [] });
  await (await ensurePage()).waitForTimeout(250);
  const entry = { dark, light };
  plateCache.set(key, entry);
  return entry;
}

/**
 * Render the current molecule+colorway as a TRUE-TRANSPARENCY master:
 * two composite passes over known plates, per-pixel alpha solve, content trim.
 */
export async function renderTransparentMaster(size = 2160, trimMargin = 0.06) {
  const { dark: B1, light: B2 } = await plates(size);
  await setBackground(BG_DARK);
  const C1 = await rawPixels(await exportPng(size, 'pass-dark'));
  await setBackground(BG_LIGHT);
  const C2 = await rawPixels(await exportPng(size, 'pass-light'));
  const n = size * size;
  const out = Buffer.alloc(n * 4);
  const c1 = C1.data, c2 = C2.data, b1 = B1.data, b2 = B2.data;
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let num = 0, den = 0;
    for (let ch = 0; ch < 3; ch++) {
      const dB = b1[o + ch] - b2[o + ch];
      const w = Math.abs(dB);
      if (w > 4) { num += (c1[o + ch] - c2[o + ch]) * Math.sign(dB) * w; den += w * w; }
    }
    const oneMinusA = den > 0 ? Math.min(1, Math.max(0, num / den)) : 0;
    const a = 1 - oneMinusA;
    if (a > 0.02) {
      const x = i % size, y = (i / size) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let ch = 0; ch < 3; ch++) {
        const F = c1[o + ch] - oneMinusA * b1[o + ch];
        out[o + ch] = Math.min(255, Math.max(0, Math.round(F / Math.max(a, 1e-6))));
      }
      out[o + 3] = Math.round(a * 255);
    }
  }
  let img = sharp(out, { raw: { width: size, height: size, channels: 4 } });
  if (maxX > minX && maxY > minY) {
    const side = Math.max(maxX - minX, maxY - minY);
    const pad = Math.round(side * trimMargin);
    const cx = (minX + maxX) >> 1, cy = (minY + maxY) >> 1;
    const half = ((side + 2 * pad) / 2) | 0;
    const L = Math.max(0, cx - half), T = Math.max(0, cy - half);
    const W = Math.min(size - L, half * 2), H = Math.min(size - T, half * 2);
    img = img.extract({ left: L, top: T, width: W, height: H });
  }
  return img.png().toBuffer();
}

/** Composite a transparent master onto an exact-pixel product canvas. */
export async function composeProduct(masterPng, product, colorway) {
  const [W, H] = product.px;
  const bgHex = product.background === 'colorway' ? colorway.poster_bg : (product.background || '#00000000');
  const transparentBg = product.transparent === true;
  // Fit the art inside BOTH dimensions. Scaling only by width overflows short/wide print
  // boxes (e.g. a 2475x1155 mug wrap) and sharp rejects the negative composite offset.
  const contentFrac = product.contentWidthFraction ?? 0.72;
  const maxW = Math.round(W * contentFrac);
  const maxH = Math.round(H * (product.contentHeightFraction ?? contentFrac));
  const masterBuf = await sharp(masterPng)
    .resize({ width: maxW, height: maxH, fit: 'inside', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const meta = await sharp(masterBuf).metadata();
  const clamp = (v, hi) => Math.max(0, Math.min(v, hi));
  const left = clamp(Math.round((W - meta.width) / 2), W - meta.width);
  const top = clamp(Math.round(H * (product.contentTopFraction ?? 0.5) - meta.height / 2), H - meta.height);
  const base = transparentBg
    ? sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    : sharp({ create: { width: W, height: H, channels: 4, background: hexToRgba(bgHex) } });
  return base.composite([{ input: masterBuf, left, top }]).png().toBuffer();
}

function hexToRgba(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), alpha: 1 };
}

export async function shutdown() {
  try { if (browser) await browser.close(); } catch {}
  browser = null; page = null;
}
