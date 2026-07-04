import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  verifyShopifyHmac,
  buildGootenOrder,
  parseSkuMap,
  UnmappedLineError,
  type ShopifyOrder,
  type LineResolver,
} from './gooten';

describe('verifyShopifyHmac', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 1, hello: 'world' });
  const good = crypto.createHmac('sha256', secret).update(body).digest('base64');

  it('accepts a correctly signed body', () => {
    expect(verifyShopifyHmac(body, good, secret)).toBe(true);
  });
  it('rejects a tampered body', () => {
    expect(verifyShopifyHmac(body + ' ', good, secret)).toBe(false);
  });
  it('rejects a wrong signature or missing inputs', () => {
    expect(verifyShopifyHmac(body, 'not-a-real-hmac', secret)).toBe(false);
    expect(verifyShopifyHmac(body, undefined, secret)).toBe(false);
    expect(verifyShopifyHmac(body, good, '')).toBe(false);
  });
});

describe('parseSkuMap', () => {
  it('parses a JSON metafield of shopify→gooten SKUs', () => {
    expect(parseSkuMap('{"LUPI-CAF-MUG-11oz":"CG-11oz-White"}')).toEqual({ 'LUPI-CAF-MUG-11oz': 'CG-11oz-White' });
  });
  it('drops empty values and tolerates malformed input', () => {
    expect(parseSkuMap('{"a":"","b":"x"}')).toEqual({ b: 'x' });
    expect(parseSkuMap('not json')).toEqual({});
    expect(parseSkuMap(undefined)).toEqual({});
  });
});

const ORDER: ShopifyOrder = {
  id: 5001,
  email: 'buyer@example.com',
  shipping_address: {
    first_name: 'Ada', last_name: 'Lovelace', address1: '1 Analytical Way', city: 'London',
    province_code: 'ENG', country_code: 'GB', zip: 'EC1A', phone: '+44 20 7946 0000',
  },
  line_items: [
    { id: 90001, sku: 'LUPI-CAF-MUG-11oz', quantity: 2, product_id: 7448976064597 },
    { id: 90002, sku: 'DONATION', quantity: 1 }, // non-merch line
  ],
};

// gooten.sku_map + lupi.design_url resolution, as the webhook would build it.
const skuMap: Record<string, string> = { 'LUPI-CAF-MUG-11oz': 'CoffeeMug-11oz-White' };
const designUrl = 'https://cdn.shopify.com/print/caffeine-mug.png';
const resolve: LineResolver = (line) => {
  if (!line.sku || !(line.sku in skuMap)) return null; // treat unknown as non-merch (donation)
  return { gootenSku: skuMap[line.sku], imageUrl: designUrl };
};

describe('buildGootenOrder', () => {
  it('maps a Shopify order to a Gooten order body', () => {
    const g = buildGootenOrder(ORDER, resolve, { billingKey: 'PBK', testMode: true });

    expect(g.SourceId).toBe('5001');
    expect(g.IsPartnerSourceIdUnique).toBe(true); // idempotent re-delivery
    expect(g.IsInTestMode).toBe(true);
    expect(g.Payment.PartnerBillingKey).toBe('PBK');

    // Address mapping.
    expect(g.ShipToAddress).toMatchObject({
      FirstName: 'Ada', LastName: 'Lovelace', Line1: '1 Analytical Way', City: 'London',
      State: 'ENG', CountryCode: 'GB', PostalCode: 'EC1A', Email: 'buyer@example.com',
    });

    // Only the mapped merch line becomes a Gooten item; the donation is skipped.
    expect(g.Items).toHaveLength(1);
    expect(g.Items[0]).toMatchObject({
      Quantity: 2, SKU: 'CoffeeMug-11oz-White', ShipType: 'standard',
      Images: [{ Url: designUrl }], SourceId: '90001',
    });
  });

  it('throws when a merch line has no Gooten mapping (never half-fulfills)', () => {
    const partial: ShopifyOrder = {
      ...ORDER,
      line_items: [{ id: 1, sku: 'LUPI-XXX-TEE-S-BLK', quantity: 1 }],
    };
    // Resolver returns a mapping object but with an empty gootenSku → unmapped.
    const badResolve: LineResolver = () => ({ gootenSku: '', imageUrl: '' });
    expect(() => buildGootenOrder(partial, badResolve, { billingKey: 'PBK', testMode: true }))
      .toThrow(UnmappedLineError);
  });

  it('honors the requested ship type', () => {
    const g = buildGootenOrder(ORDER, resolve, { billingKey: 'PBK', testMode: false, shipType: 'expedited' });
    expect(g.Items[0].ShipType).toBe('expedited');
    expect(g.IsInTestMode).toBe(false);
  });
});
