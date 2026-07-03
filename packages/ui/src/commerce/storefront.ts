/**
 * storefront — in-viewer commerce against the Shopify Storefront API.
 *
 * The Storefront API is designed to be called from the browser with a PUBLIC
 * storefront access token (read + cart only — it can't touch admin data), so
 * the viewer can list a molecule's products, build a cart, and hand off to
 * Shopify's secure checkout without a backend.
 *
 * Config (build-time, both optional — the Shop UI degrades to a "not
 * configured" state when the token is absent):
 *   VITE_SHOPIFY_STORE_DOMAIN      e.g. lupi-8182.myshopify.com
 *   VITE_SHOPIFY_STOREFRONT_TOKEN  public Storefront access token
 *
 * Products surface here only once they're ACTIVE and published to the sales
 * channel the token reads — that's the same publish step that makes them
 * buyable, so "visible in the Shop drawer" == "purchasable".
 */

const API_VERSION = '2025-01';

export const SHOP_DOMAIN: string =
  (import.meta.env.VITE_SHOPIFY_STORE_DOMAIN as string | undefined) || 'lupi-8182.myshopify.com';
export const STOREFRONT_TOKEN: string =
  (import.meta.env.VITE_SHOPIFY_STOREFRONT_TOKEN as string | undefined) || '';

export function commerceConfigured(): boolean {
  return Boolean(SHOP_DOMAIN && STOREFRONT_TOKEN);
}

export interface Money {
  amount: string;
  currencyCode: string;
}

export interface ShopVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  price: Money;
  selectedOptions: { name: string; value: string }[];
  imageUrl?: string;
}

export interface ShopProduct {
  id: string;
  title: string;
  handle: string;
  productType: string;
  featuredImageUrl?: string;
  tags: string[];
  minPrice: Money;
  options: { name: string; values: string[] }[];
  variants: ShopVariant[];
}

export interface Cart {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  subtotal: Money | null;
  lines: { id: string; title: string; variantTitle: string; quantity: number; imageUrl?: string; price: Money }[];
}

async function storefront<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!commerceConfigured()) {
    throw new Error('Storefront not configured (set VITE_SHOPIFY_STOREFRONT_TOKEN).');
  }
  const res = await fetch(`https://${SHOP_DOMAIN}/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`Storefront error: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

export function moleculeTag(fileName: string): string {
  return fileName
    .replace(/^MCP:\s*/i, '')
    .replace(/\s+molecule$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const PRODUCT_FIELDS = `
  id
  title
  handle
  productType
  tags
  featuredImage { url altText }
  priceRange { minVariantPrice { amount currencyCode } }
  options { name values }
  variants(first: 50) {
    nodes {
      id
      title
      availableForSale
      price { amount currencyCode }
      selectedOptions { name value }
      image { url }
    }
  }
`;

function mapProduct(node: any): ShopProduct {
  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    productType: node.productType,
    featuredImageUrl: node.featuredImage?.url,
    tags: node.tags ?? [],
    minPrice: node.priceRange.minVariantPrice,
    options: (node.options ?? []).map((o: any) => ({ name: o.name, values: o.values })),
    variants: (node.variants?.nodes ?? []).map((v: any) => ({
      id: v.id,
      title: v.title,
      availableForSale: v.availableForSale,
      price: v.price,
      selectedOptions: v.selectedOptions ?? [],
      imageUrl: v.image?.url,
    })),
  };
}

/** Products tagged for the given molecule (matches the `molecule` tag the
 *  merch pipeline applies), most relevant first. */
export async function fetchMoleculeProducts(tag: string): Promise<ShopProduct[]> {
  const data = await storefront<{ products: { nodes: any[] } }>(
    `query($q:String!){ products(first: 24, query: $q, sortKey: RELEVANCE){ nodes { ${PRODUCT_FIELDS} } } }`,
    { q: `tag:'${tag}'` },
  );
  return data.products.nodes.map(mapProduct);
}

/** Every molecule-merch product (the whole shop), for the browse-all view. */
export async function fetchAllMerch(): Promise<ShopProduct[]> {
  const data = await storefront<{ products: { nodes: any[] } }>(
    `query($q:String!){ products(first: 50, query: $q){ nodes { ${PRODUCT_FIELDS} } } }`,
    { q: `tag:'molecule art'` },
  );
  return data.products.nodes.map(mapProduct);
}

const CART_FIELDS = `
  id
  checkoutUrl
  totalQuantity
  cost { subtotalAmount { amount currencyCode } }
  lines(first: 50) {
    nodes {
      id
      quantity
      merchandise {
        ... on ProductVariant {
          title
          image { url }
          price { amount currencyCode }
          product { title }
        }
      }
    }
  }
`;

function mapCart(node: any): Cart {
  return {
    id: node.id,
    checkoutUrl: node.checkoutUrl,
    totalQuantity: node.totalQuantity,
    subtotal: node.cost?.subtotalAmount ?? null,
    lines: (node.lines?.nodes ?? []).map((l: any) => ({
      id: l.id,
      title: l.merchandise?.product?.title ?? '',
      variantTitle: l.merchandise?.title ?? '',
      quantity: l.quantity,
      imageUrl: l.merchandise?.image?.url,
      price: l.merchandise?.price,
    })),
  };
}

/** Single-variant cart → checkout URL. The "buy now" money path. */
export async function buyNow(variantId: string, quantity = 1): Promise<string> {
  const data = await storefront<{ cartCreate: { cart: any; userErrors: any[] } }>(
    `mutation($lines:[CartLineInput!]!){ cartCreate(input:{ lines:$lines }){ cart { checkoutUrl } userErrors { message } } }`,
    { lines: [{ merchandiseId: variantId, quantity }] },
  );
  const errs = data.cartCreate.userErrors;
  if (errs?.length) throw new Error(errs[0].message);
  return data.cartCreate.cart.checkoutUrl;
}

export async function createCart(variantId: string, quantity = 1): Promise<Cart> {
  const data = await storefront<{ cartCreate: { cart: any; userErrors: any[] } }>(
    `mutation($lines:[CartLineInput!]!){ cartCreate(input:{ lines:$lines }){ cart { ${CART_FIELDS} } userErrors { message } } }`,
    { lines: [{ merchandiseId: variantId, quantity }] },
  );
  const errs = data.cartCreate.userErrors;
  if (errs?.length) throw new Error(errs[0].message);
  return mapCart(data.cartCreate.cart);
}

export async function addToCart(cartId: string, variantId: string, quantity = 1): Promise<Cart> {
  const data = await storefront<{ cartLinesAdd: { cart: any; userErrors: any[] } }>(
    `mutation($cartId:ID!,$lines:[CartLineInput!]!){ cartLinesAdd(cartId:$cartId, lines:$lines){ cart { ${CART_FIELDS} } userErrors { message } } }`,
    { cartId, lines: [{ merchandiseId: variantId, quantity }] },
  );
  const errs = data.cartLinesAdd.userErrors;
  if (errs?.length) throw new Error(errs[0].message);
  return mapCart(data.cartLinesAdd.cart);
}

export async function fetchCart(cartId: string): Promise<Cart | null> {
  const data = await storefront<{ cart: any | null }>(
    `query($id:ID!){ cart(id:$id){ ${CART_FIELDS} } }`,
    { id: cartId },
  );
  return data.cart ? mapCart(data.cart) : null;
}

export function formatMoney(m: Money | null | undefined): string {
  if (!m) return '';
  const n = Number(m.amount);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: m.currencyCode }).format(n);
  } catch {
    return `${m.currencyCode} ${n.toFixed(2)}`;
  }
}
