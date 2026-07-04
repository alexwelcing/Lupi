/**
 * gooten — the Shopify → Gooten fulfillment wire.
 *
 * When a customer checks out on Shopify, the order has to reach Gooten to be
 * printed and shipped. This module is the connective logic:
 *
 *   • verifyShopifyHmac  — authenticate the Shopify order webhook.
 *   • buildGootenOrder   — PURE transform: a Shopify order + a per-line
 *                          resolver (Shopify SKU → Gooten SKU + print-file URL)
 *                          → a Gooten Orders API body. No I/O, so it's unit
 *                          tested without credentials.
 *   • submitGootenOrder  — POST the order to Gooten (recipe id in the URL,
 *                          Partner Billing Key in the body — server-side only).
 *   • gootenGet          — read the Gooten catalog / variant SKUs (recipe id
 *                          only) for mapping.
 *
 * Gooten API: https://api.print.io/api/v/5/source/api/  (auth via ?recipeid=…;
 * orders additionally carry Payment.PartnerBillingKey).
 */

import crypto from 'node:crypto';

export const GOOTEN_BASE = 'https://api.print.io/api/v/5/source/api';

// ─── Shopify webhook authentication ─────────────────────────────────
/** Constant-time check of the `X-Shopify-Hmac-Sha256` header against the raw
 *  request body using the webhook signing secret. */
export function verifyShopifyHmac(rawBody: Buffer | string, hmacHeader: string | undefined, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ─── Types ──────────────────────────────────────────────────────────
export interface ShopifyAddress {
  first_name?: string;
  last_name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province_code?: string;
  province?: string;
  country_code?: string;
  zip?: string;
  phone?: string;
}

export interface ShopifyLineItem {
  id: number | string;
  sku: string | null;
  quantity: number;
  product_id?: number | string;
  title?: string;
  variant_title?: string;
}

export interface ShopifyOrder {
  id: number | string;
  email?: string;
  shipping_address?: ShopifyAddress;
  billing_address?: ShopifyAddress;
  line_items: ShopifyLineItem[];
}

export interface GootenAddress {
  FirstName: string;
  LastName: string;
  Line1: string;
  Line2?: string;
  City: string;
  State: string;
  CountryCode: string;
  PostalCode: string;
  Phone?: string;
  Email?: string;
  IsBusinessAddress: boolean;
}

export interface GootenItem {
  Quantity: number;
  SKU: string;
  ShipType: string;
  Images: { Url: string }[];
  SourceId: string;
}

export interface GootenOrder {
  ShipToAddress: GootenAddress;
  BillingAddress: GootenAddress;
  Items: GootenItem[];
  Payment: { PartnerBillingKey: string };
  SourceId: string;
  IsPartnerSourceIdUnique: boolean;
  IsInTestMode: boolean;
  Meta?: Record<string, unknown>;
}

/** Per-line resolution: the Shopify SKU maps to a Gooten SKU and the print file
 *  that Gooten prints. Returns null when the line isn't a mapped merch item
 *  (so non-merch lines are skipped, not guessed). */
export type LineResolver = (line: ShopifyLineItem) => { gootenSku: string; imageUrl: string } | null;

export interface BuildOrderOptions {
  billingKey: string;
  testMode: boolean;
  shipType?: 'standard' | 'expedited' | 'overnight';
}

function mapAddress(a: ShopifyAddress | undefined, email?: string): GootenAddress {
  return {
    FirstName: a?.first_name ?? '',
    LastName: a?.last_name ?? '',
    Line1: a?.address1 ?? '',
    Line2: a?.address2 || undefined,
    City: a?.city ?? '',
    State: a?.province_code ?? a?.province ?? '',
    CountryCode: a?.country_code ?? '',
    PostalCode: a?.zip ?? '',
    Phone: a?.phone || undefined,
    Email: email || undefined,
    IsBusinessAddress: false,
  };
}

export class UnmappedLineError extends Error {
  readonly skus: string[];
  constructor(skus: string[]) {
    super(`No Gooten mapping for line item SKU(s): ${skus.join(', ')}`);
    this.name = 'UnmappedLineError';
    this.skus = skus;
  }
}

/**
 * Transform a Shopify order into a Gooten order body. Every merch line must
 * resolve to a Gooten SKU + print file; an order with any unmapped merch line
 * throws (so we never ship a half-fulfilled order). Lines the resolver returns
 * null for are treated as non-merch and skipped.
 */
export function buildGootenOrder(
  order: ShopifyOrder,
  resolve: LineResolver,
  opts: BuildOrderOptions,
): GootenOrder {
  const ship = opts.shipType ?? 'standard';
  const items: GootenItem[] = [];
  const unmapped: string[] = [];

  for (const line of order.line_items ?? []) {
    const r = resolve(line);
    if (r === null) continue; // non-merch line, skip
    if (!r.gootenSku || !r.imageUrl) {
      unmapped.push(line.sku ?? String(line.id));
      continue;
    }
    items.push({
      Quantity: line.quantity,
      SKU: r.gootenSku,
      ShipType: ship,
      Images: [{ Url: r.imageUrl }],
      SourceId: String(line.id),
    });
  }

  if (unmapped.length > 0) throw new UnmappedLineError(unmapped);

  const shipTo = mapAddress(order.shipping_address, order.email);
  return {
    ShipToAddress: shipTo,
    BillingAddress: mapAddress(order.billing_address ?? order.shipping_address, order.email),
    Items: items,
    Payment: { PartnerBillingKey: opts.billingKey },
    SourceId: String(order.id),
    IsPartnerSourceIdUnique: true, // idempotent: re-delivery of the same order won't double-submit
    IsInTestMode: opts.testMode,
    Meta: { source: 'lupi-shopify' },
  };
}

/** Parse a `gooten.sku_map` metafield value ({ shopifySku: gootenSku }). */
export function parseSkuMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'string') return {};
  try {
    const obj = JSON.parse(value);
    if (obj && typeof obj === 'object') {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' && v) out[k] = v;
      return out;
    }
  } catch { /* malformed → empty */ }
  return {};
}

// ─── Gooten API I/O ─────────────────────────────────────────────────
export async function submitGootenOrder(recipeId: string, order: GootenOrder): Promise<{ Id?: string }> {
  const res = await fetch(`${GOOTEN_BASE}/orders?recipeid=${encodeURIComponent(recipeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gooten order failed (${res.status}): ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

export async function gootenGet<T = unknown>(recipeId: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ recipeid: recipeId, ...params });
  const res = await fetch(`${GOOTEN_BASE}/${path}?${qs.toString()}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Gooten ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}
