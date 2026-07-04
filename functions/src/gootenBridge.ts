/**
 * gootenOrderWebhook — the deployed Shopify → Gooten fulfillment wire.
 *
 * Register this function's URL as a Shopify `orders/create` (or `orders/paid`)
 * webhook. On each order it:
 *   1. authenticates the webhook (HMAC over the raw body),
 *   2. looks up, for each line's product, the `gooten.sku_map`
 *      (Shopify SKU → Gooten SKU) and `lupi.design_url` (print file) metafields,
 *   3. builds a Gooten order and submits it (idempotent via the Shopify order id),
 *   so the item is printed and shipped by Gooten.
 *
 * Secrets (set with `firebase functions:secrets:set …`, never in source):
 *   GOOTEN_RECIPE_ID            — Gooten recipe id (Settings → API)
 *   GOOTEN_PARTNER_BILLING_KEY  — Gooten partner billing key (charges fulfillment)
 *   SHOPIFY_ADMIN_TOKEN         — Admin API token (read_products for metafields)
 *   SHOPIFY_WEBHOOK_SECRET      — the webhook's signing secret
 * Params:
 *   SHOPIFY_STORE_DOMAIN        — e.g. lupi-8182.myshopify.com
 *   GOOTEN_TEST_MODE            — 'true' to submit test orders (no charge)
 */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import {
  buildGootenOrder,
  parseSkuMap,
  submitGootenOrder,
  verifyShopifyHmac,
  UnmappedLineError,
  type LineResolver,
  type ShopifyOrder,
} from './gooten';

const GOOTEN_RECIPE_ID = defineSecret('GOOTEN_RECIPE_ID');
const GOOTEN_PARTNER_BILLING_KEY = defineSecret('GOOTEN_PARTNER_BILLING_KEY');
const SHOPIFY_ADMIN_TOKEN = defineSecret('SHOPIFY_ADMIN_TOKEN');
const SHOPIFY_WEBHOOK_SECRET = defineSecret('SHOPIFY_WEBHOOK_SECRET');
const SHOPIFY_STORE_DOMAIN = defineString('SHOPIFY_STORE_DOMAIN', { default: 'lupi-8182.myshopify.com' });
const GOOTEN_TEST_MODE = defineString('GOOTEN_TEST_MODE', { default: 'true' });

const ADMIN_API_VERSION = '2025-01';

interface ProductMapping { skuMapRaw: string | null; designUrl: string | null; }

/** Fetch gooten.sku_map + lupi.design_url for each product in the order. */
async function fetchProductMappings(domain: string, token: string, productIds: string[]): Promise<Map<string, ProductMapping>> {
  const out = new Map<string, ProductMapping>();
  if (productIds.length === 0) return out;
  const gids = productIds.map((id) => `gid://shopify/Product/${id}`);
  const query = `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id
    skuMap: metafield(namespace:"gooten", key:"sku_map"){ value }
    design: metafield(namespace:"lupi", key:"design_url"){ value }
  } } }`;
  const res = await fetch(`https://${domain}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables: { ids: gids } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`Admin metafield lookup failed: ${JSON.stringify(json.errors)}`);
  for (const node of json.data?.nodes ?? []) {
    if (!node?.id) continue;
    const numericId = String(node.id).split('/').pop() as string;
    out.set(numericId, { skuMapRaw: node.skuMap?.value ?? null, designUrl: node.design?.value ?? null });
  }
  return out;
}

export const gootenOrderWebhook = onRequest(
  {
    secrets: [GOOTEN_RECIPE_ID, GOOTEN_PARTNER_BILLING_KEY, SHOPIFY_ADMIN_TOKEN, SHOPIFY_WEBHOOK_SECRET],
    maxInstances: 5,
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

    // 1 — authenticate the webhook against the raw body.
    const raw = (req.rawBody as Buffer | undefined) ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyShopifyHmac(raw, req.get('x-shopify-hmac-sha256'), SHOPIFY_WEBHOOK_SECRET.value())) {
      res.status(401).json({ error: 'invalid_hmac' });
      return;
    }

    let order: ShopifyOrder;
    try { order = JSON.parse(raw.toString('utf8')); }
    catch { res.status(400).json({ error: 'bad_json' }); return; }

    try {
      // 2 — resolve each line's Gooten SKU + print file from product metafields.
      const productIds = Array.from(new Set((order.line_items ?? [])
        .map((l) => (l.product_id != null ? String(l.product_id) : null))
        .filter((v): v is string => Boolean(v))));
      const mappings = await fetchProductMappings(SHOPIFY_STORE_DOMAIN.value(), SHOPIFY_ADMIN_TOKEN.value(), productIds);

      const resolve: LineResolver = (line) => {
        const m = line.product_id != null ? mappings.get(String(line.product_id)) : undefined;
        if (!m || !m.skuMapRaw) return null; // not a Lupi merch product → skip
        const gootenSku = line.sku ? parseSkuMap(m.skuMapRaw)[line.sku] : undefined;
        return { gootenSku: gootenSku ?? '', imageUrl: m.designUrl ?? '' };
      };

      const gootenOrder = buildGootenOrder(order, resolve, {
        billingKey: GOOTEN_PARTNER_BILLING_KEY.value(),
        testMode: GOOTEN_TEST_MODE.value() !== 'false',
      });

      if (gootenOrder.Items.length === 0) {
        logger.info('gooten_no_merch_lines', { orderId: order.id });
        res.status(200).json({ status: 'no_merch_lines' });
        return;
      }

      const result = await submitGootenOrder(GOOTEN_RECIPE_ID.value(), gootenOrder);
      logger.info('gooten_order_submitted', { orderId: order.id, gootenId: result.Id, items: gootenOrder.Items.length, testMode: gootenOrder.IsInTestMode });
      res.status(200).json({ status: 'submitted', gootenId: result.Id ?? null });
    } catch (err) {
      if (err instanceof UnmappedLineError) {
        // A merch line has no Gooten SKU yet — retrying won't help; ack and alert
        // so it's mapped in Gooten Hub rather than storming webhook retries.
        logger.error('gooten_order_unmapped', { orderId: order.id, skus: err.skus });
        res.status(200).json({ status: 'unmapped', skus: err.skus });
        return;
      }
      // Transient (Admin/Gooten) — 500 so Shopify retries; Gooten dedupes by SourceId.
      logger.error('gooten_order_failed', { orderId: order.id, error: String(err) });
      res.status(500).json({ error: 'fulfillment_failed' });
    }
  },
);
