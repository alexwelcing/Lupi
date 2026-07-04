#!/usr/bin/env node
/**
 * gooten — CLI for the Gooten side of the fulfillment wire.
 *
 * Reuses the exact client the webhook uses (functions/src/gooten.ts, loaded via
 * Node TS type-stripping) so catalog reads, SKU discovery, and a test order all
 * behave identically to production.
 *
 * Env:
 *   GOOTEN_RECIPE_ID            (required) — Settings → API in the Gooten panel
 *   GOOTEN_PARTNER_BILLING_KEY  (test-order only)
 *
 * Usage:
 *   GOOTEN_RECIPE_ID=… node tools/gooten.mjs catalog
 *   GOOTEN_RECIPE_ID=… node tools/gooten.mjs variants --product "Coffee Mug"
 *   GOOTEN_RECIPE_ID=… GOOTEN_PARTNER_BILLING_KEY=… \
 *     node tools/gooten.mjs test-order --sku "<GootenSKU>" --image "https://…/print.png"
 *
 * `catalog` / `variants` need only the recipe id (read-only). `test-order`
 * submits a Gooten order in TEST mode (no charge) to prove the pipeline end to
 * end; add --live to submit a real order.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gooten = await import(new URL('../functions/src/gooten.ts', import.meta.url).href).catch(async () => {
  // Fallback if TS import isn't available: re-derive the base + minimal calls.
  return import(path.join(repoRoot, 'functions', 'src', 'gooten.ts'));
});
const { gootenGet, submitGootenOrder, buildGootenOrder } = gooten;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(t);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const recipeId = process.env.GOOTEN_RECIPE_ID;

if (!recipeId) {
  console.error('Set GOOTEN_RECIPE_ID (Gooten panel → Settings → API).');
  process.exit(1);
}

function preview(obj, depth = 0) {
  // Print a compact view of an unknown Gooten response so the SKU fields are visible.
  const json = JSON.stringify(obj, null, 2);
  console.log(json.length > 6000 ? json.slice(0, 6000) + '\n… (truncated)' : json);
}

try {
  if (cmd === 'catalog') {
    const data = await gootenGet(recipeId, 'products');
    const products = data.Products ?? data.products ?? data;
    if (Array.isArray(products)) {
      console.log(`Gooten catalog — ${products.length} products:`);
      for (const p of products) console.log('  •', p.Name ?? p.name ?? JSON.stringify(p).slice(0, 80));
    } else {
      preview(data);
    }
  } else if (cmd === 'variants') {
    const product = args.product;
    if (!product) { console.error('variants requires --product "<name>"'); process.exit(1); }
    const data = await gootenGet(recipeId, 'productvariants', { productName: String(product) });
    const variants = data.ProductVariants ?? data.productVariants ?? data;
    if (Array.isArray(variants)) {
      console.log(`${product} — ${variants.length} orderable SKUs:`);
      for (const v of variants) console.log('  ', v.Sku ?? v.sku ?? JSON.stringify(v).slice(0, 100));
    } else {
      preview(data);
    }
  } else if (cmd === 'test-order') {
    const sku = args.sku;
    const image = args.image;
    const billingKey = process.env.GOOTEN_PARTNER_BILLING_KEY;
    if (!sku || !image) { console.error('test-order requires --sku and --image'); process.exit(1); }
    if (!billingKey) { console.error('Set GOOTEN_PARTNER_BILLING_KEY for test-order.'); process.exit(1); }

    const order = buildGootenOrder(
      {
        id: `lupi-test-${args.tag ?? 'cli'}`,
        email: args.email ?? 'test@lupi.live',
        shipping_address: {
          first_name: 'Lupi', last_name: 'Test', address1: '79 Madison Ave', city: 'New York',
          province_code: 'NY', country_code: 'US', zip: '10016', phone: '0000000000',
        },
        line_items: [{ id: 'l1', sku: 'CLI-TEST', quantity: 1 }],
      },
      () => ({ gootenSku: String(sku), imageUrl: String(image) }),
      { billingKey, testMode: !args.live },
    );
    console.log(`Submitting ${args.live ? 'LIVE' : 'TEST'} order to Gooten…`);
    const result = await submitGootenOrder(recipeId, order);
    console.log('Gooten response:');
    preview(result);
  } else {
    console.log('Commands: catalog | variants --product "<name>" | test-order --sku <s> --image <url> [--live]');
    process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  console.error(`[gooten] ${err.message}`);
  process.exit(1);
}
