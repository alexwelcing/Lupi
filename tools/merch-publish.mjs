#!/usr/bin/env node
/**
 * merch-publish — connect Lupi merch assets to the Shopify store (Gooten-fulfilled).
 *
 * Consumes a `listing.json` (+ asset PNGs) produced by tools/merch-render.mjs
 * and, for each product listing:
 *
 *   Shopify  — create-or-update the product via the Admin GraphQL API, exactly
 *              matching the store conventions (title/handle/productType/vendor,
 *              option axes, variant SKUs + prices, tags, DRAFT status), upload
 *              the storefront mockup + Gooten print file, and set the
 *              lupi.* / gooten.* metafields that bind the design to the product.
 *
 *   Gooten   — emit a fulfillment manifest (JSON + CSV) keyed by SKU: which
 *              Gooten product each variant maps to, the print-file URL/path, the
 *              print dimensions, and the price. Import it into Gooten Hub (or
 *              feed a Gooten API integration) so each Shopify SKU produces the
 *              right physical item.
 *
 * This is the codified, repeatable version of the manual wiring done on the
 * Caffeine Mug/Cap — the "system" half of the interface/system.
 *
 * Usage:
 *   # Dry run — writes the Gooten manifest + a Shopify plan, no store writes:
 *   node tools/merch-publish.mjs --dir merch/caffeine
 *
 *   # Live — create/update the products in Shopify (keeps them DRAFT):
 *   SHOPIFY_STORE=lupi-8182.myshopify.com \
 *   SHOPIFY_ADMIN_TOKEN=shpat_xxx \
 *   node tools/merch-publish.mjs --dir merch/caffeine --execute
 *
 *   # ...and publish (ACTIVE) instead of draft: add --publish
 *
 * The Admin token needs write_products, write_files, and write_inventory.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_VERSION = '2025-01';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const key = t.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));

const dir = path.resolve(args.dir ?? '.');
const execute = Boolean(args.execute);
const status = args.publish ? 'ACTIVE' : 'DRAFT';
const store = args.store ?? process.env.SHOPIFY_STORE;
const token = process.env.SHOPIFY_ADMIN_TOKEN;

// ─── Shopify Admin GraphQL client ───────────────────────────────────
async function admin(query, variables) {
  const res = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`Admin API error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

/** Stage → PUT bytes → return the resource URL Shopify ingests. */
async function uploadStaged(filePath, filename) {
  const bytes = await readFile(filePath);
  const staged = await admin(
    `mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }`,
    { input: [{ filename, mimeType: 'image/png', resource: 'IMAGE', fileSize: String(bytes.length) }] },
  );
  const errs = staged.stagedUploadsCreate.userErrors;
  if (errs?.length) throw new Error(`stagedUploadsCreate: ${JSON.stringify(errs)}`);
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  const put = await fetch(target.url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes });
  if (!put.ok) throw new Error(`staged PUT failed (${put.status}) for ${filename}`);
  return target.resourceUrl;
}

async function findProductIdByHandle(handle) {
  const data = await admin(
    `query($handle:String!){ productByIdentifier(identifier:{handle:$handle}){ id } }`,
    { handle },
  );
  return data.productByIdentifier?.id ?? null;
}

// ─── Build the productSet input for a listing ───────────────────────
function buildProductSetInput(listing, { mockupSource, printSource }) {
  // Reconstruct the option axes from the variants' option values.
  const optionNames = listing.variants[0].options.length === 2 ? ['Size', 'Color']
    : listing.product === 'hat' ? ['Color'] : ['Size'];
  const optionValues = optionNames.map((_name, axis) => {
    const seen = new Set();
    for (const v of listing.variants) seen.add(v.options[axis]);
    return { name: optionNames[axis], values: Array.from(seen).map((name) => ({ name })) };
  });

  const files = [];
  if (mockupSource) files.push({ originalSource: mockupSource, contentType: 'IMAGE', alt: `${listing.title} — Lupi design` });
  // One media per print spec; the alt carries the printKey so we can resolve
  // each file's CDN URL afterward and build gooten.print_map.
  for (const ps of printSources ?? []) {
    files.push({ originalSource: ps.source, contentType: 'IMAGE', alt: `Gooten print file [${ps.printKey}]` });
  }

  const variants = listing.variants.map((v) => ({
    sku: v.sku,
    price: v.priceUsd.toFixed(2),
    optionValues: v.options.map((value, axis) => ({ optionName: optionNames[axis], name: value })),
  }));

  return {
    title: listing.title,
    handle: listing.handle,
    productType: listing.productType,
    vendor: listing.vendor,
    status,
    tags: listing.tags,
    productOptions: optionValues,
    variants,
    files,
    metafields: [
      { namespace: 'lupi', key: 'molecule', type: 'json', value: JSON.stringify(listing.molecule) },
      { namespace: 'lupi', key: 'view', type: 'single_line_text_field', value: 'iso' },
      { namespace: 'gooten', key: 'product', type: 'single_line_text_field', value: listing.gootenProductName },
      { namespace: 'gooten', key: 'sku_map', type: 'json', value: JSON.stringify(Object.fromEntries(listing.variants.map((v) => [v.sku, '']))) },
      { namespace: 'gooten', key: 'status', type: 'single_line_text_field', value: 'pending-map' },
    ],
  };
}

// ─── Gooten fulfillment manifest ────────────────────────────────────
function gootenRows(listing) {
  const prints = listing.assets.filter((a) => a.kind === 'print');
  const byKey = new Map(prints.map((a) => [a.printKey ?? 'default', a]));
  return listing.variants.map((v) => {
    const p = byKey.get(v.printKey) ?? prints[0];
    return {
      sku: v.sku,
      product: listing.product,
      gooten_product: listing.gootenProductName,
      title: `${listing.title} — ${v.title}`,
      options: v.options.join(' / '),
      price_usd: v.priceUsd.toFixed(2),
      print_key: v.printKey,
      print_file: p ? p.file : '',
      print_w: v.printWidth,
      print_h: v.printHeight,
    };
  });
}

function toCsv(rows) {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const esc = (val) => {
    const s = String(val ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  const listings = JSON.parse(await readFile(path.join(dir, 'listing.json'), 'utf8'));

  // Always produce the Gooten fulfillment manifest.
  const allRows = listings.flatMap(gootenRows);
  const manifest = {
    store: store ?? 'lupi-8182.myshopify.com',
    molecule: listings[0]?.molecule ?? null,
    products: listings.map((l) => ({ product: l.product, title: l.title, handle: l.handle, gootenProduct: l.gootenProductName })),
    rows: allRows,
  };
  await writeFile(path.join(dir, 'gooten-manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(dir, 'gooten-manifest.csv'), toCsv(allRows));
  console.log(`[publish] Gooten manifest: ${allRows.length} SKU rows → ${path.join(dir, 'gooten-manifest.{json,csv}')}`);

  if (!execute) {
    // Dry run — write the exact Shopify plan without touching the store.
    const plan = listings.map((l) => ({
      op: 'productSet (create-or-update by handle)',
      title: l.title,
      handle: l.handle,
      productType: l.productType,
      status,
      variants: l.variants.map((v) => `${v.sku}  $${v.priceUsd}  [${v.options.join('/')}]  print:${v.printKey}`),
      files: l.assets.map((a) => `${a.kind}${a.printKey ? `[${a.printKey}]` : ''}: ${a.file}`),
      metafields: ['lupi.molecule', 'lupi.view', 'lupi.design_url', 'gooten.product', 'gooten.sku_map', 'gooten.print_map', 'gooten.status'],
    }));
    await writeFile(path.join(dir, 'shopify-plan.json'), JSON.stringify(plan, null, 2));
    console.log(`[publish] DRY RUN — Shopify plan → ${path.join(dir, 'shopify-plan.json')}`);
    for (const p of plan) console.log(`  • ${p.title}  (${p.variants.length} variants, ${p.files.length} files) [${status}]`);
    console.log('[publish] Re-run with --execute (and SHOPIFY_STORE + SHOPIFY_ADMIN_TOKEN) to write to Shopify.');
    return;
  }

  if (!store || !token) {
    throw new Error('--execute requires SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN env vars.');
  }

  for (const listing of listings) {
    console.log(`\n[publish] ${listing.title} …`);
    const mockup = listing.assets.find((a) => a.kind === 'mockup');
    const prints = listing.assets.filter((a) => a.kind === 'print');
    const mockupSource = mockup ? await uploadStaged(path.join(dir, mockup.file), path.basename(mockup.file)) : null;
    const printSources = [];
    for (const p of prints) {
      printSources.push({ printKey: p.printKey ?? 'default', source: await uploadStaged(path.join(dir, p.file), path.basename(p.file)) });
    }
    console.log(`  uploaded ${prints.length} print file(s) + mockup to staged storage`);

    const existingId = await findProductIdByHandle(listing.handle);
    const input = buildProductSetInput(listing, { mockupSource, printSources });

    // productSet identifies the product to UPDATE via the `identifier`
    // argument; omit it (null) to CREATE a new product.
    const result = await admin(
      `mutation($input:ProductSetInput!, $identifier:ProductSetIdentifiers){ productSet(input:$input, identifier:$identifier, synchronous:true){ product{ id handle status } userErrors{ field message } } }`,
      { input, identifier: existingId ? { id: existingId } : null },
    );
    const errs = result.productSet.userErrors;
    if (errs?.length) throw new Error(`productSet(${listing.handle}): ${JSON.stringify(errs)}`);
    const product = result.productSet.product;
    console.log(`  ${existingId ? 'updated' : 'created'} ${product.handle} (${product.status})  ${product.id}`);

    // Resolve each print file's ingested CDN URL (by printKey) and set the
    // design-file metafields: gooten.print_map (per-variant SKU → print URL)
    // for the fulfillment bridge, plus lupi.design_url as the primary/fallback.
    const urlByKey = await resolvePrintUrls(product.id);
    const printMap = {};
    for (const v of listing.variants) {
      const url = urlByKey[v.printKey] ?? Object.values(urlByKey)[0];
      if (url) printMap[v.sku] = url;
    }
    const metas = [];
    const primary = Object.values(urlByKey)[0];
    if (primary) metas.push({ ownerId: product.id, namespace: 'lupi', key: 'design_url', type: 'url', value: primary });
    if (Object.keys(printMap).length) metas.push({ ownerId: product.id, namespace: 'gooten', key: 'print_map', type: 'json', value: JSON.stringify(printMap) });
    if (metas.length) {
      await admin(`mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ field message } } }`, { m: metas });
      console.log(`  set lupi.design_url + gooten.print_map (${Object.keys(printMap).length} SKUs, ${Object.keys(urlByKey).length} file(s))`);
    }
  }
  console.log('\n[publish] Done. Products are DRAFT unless --publish was passed. Map the SKUs in Gooten using gooten-manifest.csv.');
}

/** Resolve print-file CDN URLs keyed by printKey (parsed from the media alt
 *  "Gooten print file [<key>]"), polling until processing finishes. */
async function resolvePrintUrls(productId) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const data = await admin(
      `query($id:ID!){ product(id:$id){ media(first:20){ edges{ node{ ... on MediaImage { alt status image{ url } } } } } } }`,
      { id: productId },
    );
    const nodes = (data.product?.media?.edges ?? []).map((e) => e.node);
    const out = {};
    let pending = false;
    for (const n of nodes) {
      const m = /Gooten print file \[([^\]]+)\]/.exec(n?.alt ?? '');
      if (!m) continue;
      if (n.image?.url) out[m[1]] = n.image.url;
      else pending = true;
    }
    if (Object.keys(out).length > 0 && !pending) return out;
    await new Promise((r) => setTimeout(r, 1500));
  }
  // Best-effort: return whatever resolved.
  const data = await admin(
    `query($id:ID!){ product(id:$id){ media(first:20){ edges{ node{ ... on MediaImage { alt image{ url } } } } } } }`,
    { id: productId },
  );
  const out = {};
  for (const e of data.product?.media?.edges ?? []) {
    const m = /Gooten print file \[([^\]]+)\]/.exec(e.node?.alt ?? '');
    if (m && e.node.image?.url) out[m[1]] = e.node.image.url;
  }
  return out;
}

main().catch((err) => { console.error(`[publish] FAILED: ${err.message}`); process.exit(1); });
