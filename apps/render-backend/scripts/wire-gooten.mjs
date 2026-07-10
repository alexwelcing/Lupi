#!/usr/bin/env node
/**
 * Wire Shopify variants → Gooten Print Ready Products, with art rendered to Gooten's own spec.
 *
 * For each Shopify variant in gooten-map.json:
 *   1. resolve exactly one Gooten catalog variant SKU (from the live catalog dump)
 *   2. GET producttemplates -> the exact print box (px) + DPI for that SKU
 *   3. render the molecule × colorway at that exact size via the Cloudflare MCP worker
 *      (`POST /v1/render`, sync) so the PNG lands in R2 and gets a public URL
 *   4. POST preconfiguredproducts -> a PRP whose artwork is that URL
 *
 * Gooten fetches artwork by URL, so step 3 must produce a publicly reachable asset. The
 * worker already does this (R2 + `GET /assets/:assetId.:ext`); that is why we render through
 * the worker rather than calling the render-backend directly.
 *
 * Nothing here charges money or places an order. PRPs are orderable definitions, not orders.
 *
 *   GOOTEN_RECIPE_ID=... WORKER_URL=https://lupi.live \
 *     node scripts/wire-gooten.mjs --map gooten-map.json --catalog gooten-catalog.json --dry-run
 *
 * Drop --dry-run to actually create PRPs. --only <substr> limits to matching Shopify SKUs.
 */
import { readFileSync } from 'node:fs';
import { getProductTemplates, printSpecFromTemplate, buildPrpPayload, createPrp, resolveVariant } from '../src/gooten.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const map = JSON.parse(readFileSync(arg('--map', 'gooten-map.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(arg('--catalog', 'gooten-catalog.json'), 'utf8'));
const dryRun = has('--dry-run');
const only = arg('--only');
const WORKER_URL = process.env.WORKER_URL || 'https://lupi.live';
const RENDER_TOKEN = process.env.RENDERER_TOKEN || '';

/** Flatten catalog for matching, remembering which productId each SKU belongs to. */
const allVariants = catalog.flatMap((p) => p.variants.map((v) => ({ ...v, Sku: v.sku, productId: p.productId })));

/** Ask the worker to render + persist; return the public asset URL. */
async function renderPublicAsset({ molecule, colorway, width, height, transparent }) {
  const res = await fetch(`${WORKER_URL}/v1/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(RENDER_TOKEN ? { authorization: `Bearer ${RENDER_TOKEN}` } : {}) },
    body: JSON.stringify({
      molecule: { inputType: 'name', input: molecule },
      asset: { format: 'png', width, height, transparent: !!transparent, inline: false },
      viewer: { lupiColorway: colorway },
      sync: true,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`worker /v1/render ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  if (j.status === 'awaiting_renderer') throw new Error('worker has no RENDERER_ENDPOINT configured — deploy apps/render-backend and set it');
  const url = j.asset?.url;
  if (!url) throw new Error(`worker returned no asset.url (status=${j.status})`);
  return url;
}

const results = { ok: [], failed: [] };

for (const family of map.products) {
  if (only && !family.shopifySkuPrefix.toLowerCase().includes(only.toLowerCase())) continue;
  console.log(`\n=== ${family.name}  (${family.molecule} × ${family.colorway})`);

  const items = [];
  for (const variant of family.variants) {
    const label = `${family.shopifySkuPrefix}-${variant.suffix}`;
    try {
      // 1. exactly one Gooten variant
      const gv = resolveVariant(allVariants, variant.match);
      // 2. Gooten's own print spec
      const spec = printSpecFromTemplate(await getProductTemplates(gv.Sku), { templateName: variant.templateName });
      // 3. render each printable space at exactly that size
      const preconfigurations = [];
      for (const space of spec.spaces) {
        const url = dryRun
          ? `<dry-run: would render ${space.width}x${space.height} @${spec.dpi}dpi>`
          : await renderPublicAsset({
              molecule: family.molecule,
              colorway: family.colorway,
              width: space.width,
              height: space.height,
              transparent: family.transparent ?? variant.transparent ?? false,
            });
        preconfigurations.push({ spaceId: space.spaceId, url });
      }
      items.push({ productId: gv.productId, productVariantSku: gv.Sku, templateName: spec.templateName, preconfigurations });
      console.log(`  ok  ${label.padEnd(26)} -> ${gv.Sku}`);
      console.log(`      print ${spec.spaces.map((s) => `${s.width}x${s.height}`).join(', ')} @ ${spec.dpi} DPI, template "${spec.templateName}"`);
    } catch (e) {
      console.log(`  FAIL ${label.padEnd(25)} ${e.message}`);
      results.failed.push({ sku: label, error: e.message });
    }
  }

  if (!items.length) { console.log('  (no items resolved; skipping PRP)'); continue; }

  const payload = buildPrpPayload({
    sku: family.shopifySkuPrefix,
    name: family.name,
    description: family.description,
    items,
  });
  if (dryRun) {
    console.log(`  [dry-run] would POST preconfiguredproducts: Sku=${payload.Sku}, ${payload.Items.length} items`);
    results.ok.push(family.shopifySkuPrefix);
  } else {
    try {
      const created = await createPrp(payload);
      console.log(`  created PRP ${payload.Sku} (${payload.Items.length} items)`, created?.Sku ? `-> ${created.Sku}` : '');
      results.ok.push(family.shopifySkuPrefix);
    } catch (e) {
      console.log(`  PRP FAILED ${payload.Sku}: ${e.message}`);
      results.failed.push({ sku: payload.Sku, error: e.message });
    }
  }
}

console.log(`\n=== ${dryRun ? 'DRY RUN ' : ''}done: ${results.ok.length} families ok, ${results.failed.length} failures`);
for (const f of results.failed) console.log(`  ${f.sku}: ${f.error}`);
process.exitCode = results.failed.length ? 1 : 0;
