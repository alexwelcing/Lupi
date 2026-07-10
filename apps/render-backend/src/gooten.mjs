/**
 * Gooten API client (api.print.io v5).
 *
 * Auth: every request carries `?recipeid=<GOOTEN_RECIPE_ID>`. The recipe id is a secret —
 * it is read from the environment and never logged. Verified 2026-07-10:
 *   no recipeid  -> 403 {"Message":"Missing recipeId/api key..."}
 *   bad recipeid -> 403 {"Message":"Invalid recipeId."}
 *
 * The important idea in this file is `printSpecFromTemplate`: Gooten's product template
 * declares the exact print box (Image layer coordinates) and DPI for a SKU. Print sizes are
 * therefore *derived from Gooten*, never assumed — the renderer is told what to make.
 */

const BASE = process.env.GOOTEN_API_BASE || 'https://api.print.io/api/v/5/source/api';

function recipeId() {
  const id = process.env.GOOTEN_RECIPE_ID;
  if (!id) throw new Error('GOOTEN_RECIPE_ID is not set (find it in Gooten Admin → Settings → API / Recipes)');
  return id;
}

/** Strip the secret out of anything we might print. No secret set -> nothing to strip. */
export const redact = (s) => {
  const id = process.env.GOOTEN_RECIPE_ID;
  return id ? String(s).split(id).join('<recipeid>') : String(s);
};

async function request(method, path, { query = {}, body } = {}) {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  url.searchParams.set('recipeid', recipeId());
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = (json && (json.Message || json.message)) || text.slice(0, 200);
    throw new Error(`Gooten ${method} /${path} -> ${res.status}: ${redact(msg)}`);
  }
  return json;
}

export const getProducts = () => request('GET', 'products');

/** SKUs for one catalog product. countryCode is required by the API. */
export const getProductVariants = (productId, { countryCode = 'US', currencyCode = 'USD', page = 1, pageSize = 200 } = {}) =>
  request('GET', 'productvariants', { query: { productId, countryCode, currencyCode, page, pageSize } });

export const getProductTemplates = (sku) => request('GET', 'producttemplates', { query: { sku } });

export const listPrps = (page = 1) => request('GET', 'preconfiguredproducts', { query: { page } });

export const createPrp = (payload) => request('POST', 'preconfiguredproducts/', { body: payload });

export const updatePrp = (payload) => request('PUT', 'preconfiguredproducts/', { body: payload });

/**
 * Derive the exact print requirement for a SKU from its Gooten template.
 *
 * A template Option has Spaces; each Space has Layers. The layer with `Type: "Image"` and
 * `IncludeInPrint: true` is where artwork goes — its coordinate box is the required pixel
 * size. Returns one entry per printable space, so multi-space products (front/back) work.
 *
 * @returns {{templateName: string, dpi: number, format: string, spaces: Array<{spaceId: string, description: string, width: number, height: number}>}}
 */
export function printSpecFromTemplate(templateResponse, { templateName } = {}) {
  const options = templateResponse?.Options || [];
  const usable = options.filter((o) => !o.IsArchived);
  const option = templateName
    ? usable.find((o) => o.Name === templateName)
    : (usable.find((o) => o.IsDefault) || usable[0]);
  if (!option) throw new Error(`no usable (non-archived) template${templateName ? ` named ${templateName}` : ''}`);

  const spaces = [];
  for (const space of option.Spaces || []) {
    const layer = (space.Layers || []).find((l) => l.Type === 'Image' && l.IncludeInPrint);
    if (!layer) continue;
    spaces.push({
      spaceId: space.Id,
      description: space.Description || '',
      width: Math.abs(layer.X2 - layer.X1),
      height: Math.abs(layer.Y2 - layer.Y1),
    });
  }
  if (!spaces.length) throw new Error(`template "${option.Name}" has no printable Image layer`);
  return { templateName: option.Name, dpi: option.DPI, format: (option.Format || 'png').toLowerCase(), spaces };
}

/**
 * Build the PRP body for one Shopify product family.
 * `items` = [{ productId, productVariantSku, templateName, preconfigurations: [{spaceId, url}] }]
 */
export function buildPrpPayload({ sku, name, description, items, images = [] }) {
  if (!sku) throw new Error('PRP requires a Sku');
  if (!items?.length) throw new Error('PRP requires at least one item');
  return {
    Sku: sku,
    Name: name,
    Description: description || name,
    Items: items.map((it) => ({
      ProductId: it.productId,
      ProductVariantSku: it.productVariantSku,
      TemplateName: it.templateName,
      Preconfigurations: it.preconfigurations.map((p) => ({ SpaceId: p.spaceId, Url: p.url })),
    })),
    Images: images.map((url, i) => ({ Url: url, Index: i })),
  };
}

/**
 * Resolve exactly one catalog variant from a set of match tokens.
 * Fails loudly with candidates rather than guessing — Gooten SKU strings are long and
 * near-identical (e.g. Apparel-DTG-Tshirt-Bella-3200-M-Black-Unisex-CFCB), and a silent
 * mismatch means printing the wrong garment.
 */
export function resolveVariant(variants, tokens) {
  const needles = tokens.map((t) => String(t).toLowerCase());
  const hits = variants.filter((v) => {
    const hay = String(v.Sku || v.sku || '').toLowerCase();
    return needles.every((n) => hay.includes(n));
  });
  if (hits.length === 1) return hits[0];
  const preview = hits.slice(0, 8).map((v) => v.Sku || v.sku);
  throw new Error(
    hits.length === 0
      ? `no Gooten variant matches [${tokens.join(', ')}]`
      : `ambiguous: ${hits.length} Gooten variants match [${tokens.join(', ')}] -> ${preview.join(' | ')}${hits.length > 8 ? ' …' : ''}`,
  );
}
