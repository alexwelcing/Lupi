#!/usr/bin/env node
/**
 * Dump the Gooten catalog (products + variant SKUs + base costs) to JSON.
 *
 * Mapping is generated from live data, never guessed: wire-gooten.mjs resolves each Shopify
 * SKU against this dump and refuses to proceed on an ambiguous or missing match.
 *
 *   GOOTEN_RECIPE_ID=... node scripts/gooten-catalog.mjs --out gooten-catalog.json
 *   GOOTEN_RECIPE_ID=... node scripts/gooten-catalog.mjs --grep poster     # peek at SKU strings
 */
import { writeFileSync } from 'node:fs';
import { getProducts, getProductVariants } from '../src/gooten.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const out = arg('--out');
const grep = (arg('--grep') || '').toLowerCase();
const country = arg('--country', 'US');

const products = (await getProducts())?.Products || [];
console.log(`[catalog] ${products.length} products`);

const catalog = [];
for (const p of products) {
  const id = p.Id ?? p.ProductId;
  let variants = [];
  try {
    const res = await getProductVariants(id, { countryCode: country });
    variants = res?.ProductVariants || res?.Variants || [];
  } catch (e) {
    console.log(`[warn] ${p.Name} (${id}): ${e.message}`);
  }
  catalog.push({
    productId: id,
    name: p.Name,
    variants: variants.map((v) => ({
      sku: v.Sku,
      price: v.Price?.Amount ?? v.Price ?? null,
      currency: v.Price?.Currency ?? null,
      options: v.Options ?? v.ProductVariantOptions ?? null,
    })),
  });
  process.stdout.write(`\r[catalog] ${catalog.length}/${products.length} products, ${catalog.reduce((s, c) => s + c.variants.length, 0)} variants`);
}
process.stdout.write('\n');

if (grep) {
  for (const p of catalog) {
    for (const v of p.variants) {
      if (`${p.name} ${v.sku}`.toLowerCase().includes(grep)) {
        console.log(`${String(p.productId).padStart(5)}  ${v.sku}  ${v.price ?? ''}`);
      }
    }
  }
}
if (out) {
  writeFileSync(out, JSON.stringify(catalog, null, 2));
  console.log(`[catalog] wrote ${out}`);
}
