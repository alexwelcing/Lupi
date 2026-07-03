/**
 * merchCatalog — the single source of truth that connects a Lupi molecule
 * asset to a print-on-demand product in the Shopify store (fulfilled by
 * Gooten).
 *
 * It encodes two contracts at once, so the in-app Merch Studio, the headless
 * render/publish CLIs, and the Shopify connector all agree:
 *
 *   1. Shopify shape — product type, option axes, variant SKUs, price tiers,
 *      and tags. These MIRROR the conventions already seeded in the store:
 *        SKU     LUPI-<MOL>-<PROD>-<VARIANT>   e.g. LUPI-CAF-MUG-11oz
 *        vendor  Lupi
 *        tags    <category…>, "molecule art", <theme?>, tier-<n>
 *
 *   2. Gooten shape — the print-file dimensions (px at 300 DPI), where the
 *      molecule medallion sits, and whether the print file is transparent
 *      (so the garment/mug base color shows through). Gooten produces the
 *      physical item and the mockups from that print file, matched to the
 *      Shopify variant by SKU.
 *
 * Framework-free (no three / react / DOM) so Node CLIs import it directly.
 *
 * NOTE ON DIMENSIONS: the print-file sizes below are sensible 300-DPI
 * defaults for each product class. Gooten's per-SKU templates are the final
 * authority — override `print`/`printByOption` here once you read the exact
 * template size from Gooten's product API/Hub, and every downstream tool
 * follows automatically.
 */

export type MerchProductId = 'mug' | 'tee' | 'hat' | 'poster';

export interface GootenPrintSpec {
  /** Full print canvas Gooten expects (px). */
  widthPx: number;
  heightPx: number;
  dpi: number;
  /** Print files are normally transparent so the product base color shows;
   *  a hex string forces an opaque fill (e.g. posters). */
  background: 'transparent' | string;
  /** Fraction of the SHORTER canvas edge the molecule medallion spans. */
  medallionScale: number;
  /** Normalized medallion center on the canvas (0..1, default centered). */
  center: [number, number];
  /** Fraction of the canvas kept clear of the trim/wrap edge. */
  safeMargin: number;
}

export interface MockupSpec {
  /** Square mockup tile used as the Shopify product image (px). */
  size: number;
  /** Backdrop behind the molecule medallion for the storefront tile. */
  background: string;
  /** Fraction of the tile the molecule spans. */
  medallionScale: number;
}

export interface MerchOption {
  name: string;
  values: string[];
}

export interface MerchVariant {
  /** Option values in catalog order, e.g. ['M', 'Black']. */
  options: string[];
  /** Human title Shopify shows, e.g. 'M / Black'. */
  title: string;
  /** Variant code slotted into the SKU, e.g. 'M-BLK'. */
  variantCode: string;
  priceUsd: number;
  /** Which Gooten print template this variant maps to (option key). */
  printKey: string;
}

export interface MerchProduct {
  id: MerchProductId;
  label: string;
  /** Shopify productType (matches the seeded drafts). */
  shopifyProductType: string;
  /** Product code slotted into the SKU (MUG / TEE / HAT / POST). */
  code: string;
  /** Category tags applied to every variant of this product. */
  categoryTags: string[];
  options: MerchOption[];
  /** Base Gooten print spec; per-option overrides in printByOption. */
  print: GootenPrintSpec;
  /** Per-option-value print overrides (e.g. 11oz vs 15oz mug wrap). */
  printByOption?: Record<string, Partial<GootenPrintSpec>>;
  mockup: MockupSpec;
  /** Gooten product family name — the Hub template these variants bind to. */
  gootenProductName: string;
  /** Enumerate the concrete variants (option combos, price, SKU code). */
  buildVariants: () => MerchVariant[];
}

// ─── Molecule short codes ───────────────────────────────────────────
// Match the codes already used in the store's SKUs, with a stable fallback
// for anything new.
const MOL_CODE_OVERRIDES: Record<string, string> = {
  caffeine: 'CAF',
  creatine: 'CRE',
  serotonin: 'SER',
  dopamine: 'DOP',
  glucose: 'GLU',
  benzene: 'BZN',
  water: 'H2O',
  aspirin: 'ASP',
  cholesterol: 'CHL',
  testosterone: 'TES',
  adrenaline: 'ADR',
  capsaicin: 'CAP',
  theobromine: 'THB',
  ethanol: 'ETH',
};

/** Stable 3-letter uppercase molecule code for SKUs. */
export function molCode(name: string): string {
  const key = name.trim().toLowerCase().replace(/^mcp:\s*/, '').replace(/\s+molecule$/, '');
  if (MOL_CODE_OVERRIDES[key]) return MOL_CODE_OVERRIDES[key];
  const letters = key.replace(/[^a-z0-9]/g, '').toUpperCase();
  return (letters.slice(0, 3) || 'MOL').padEnd(3, 'X');
}

/** Slugify for handles / tags. */
export function merchSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'lupi';
}

// ─── Product definitions ────────────────────────────────────────────

const MUG: MerchProduct = {
  id: 'mug',
  label: 'Ceramic Mug',
  shopifyProductType: 'Mug',
  code: 'MUG',
  categoryTags: ['drinkware', 'mug', 'molecule art'],
  options: [{ name: 'Size', values: ['11oz', '15oz'] }],
  // 11oz wrap ≈ 9.0" × 3.85" @ 300 DPI. Molecule as a centered medallion so it
  // reads as a single motif rather than a full wrap.
  print: {
    widthPx: 2700, heightPx: 1155, dpi: 300,
    background: 'transparent', medallionScale: 0.86, center: [0.5, 0.5], safeMargin: 0.06,
  },
  printByOption: {
    '15oz': { widthPx: 2963, heightPx: 1263 }, // 15oz wrap ≈ 9.87" × 4.21"
  },
  mockup: { size: 1200, background: '#f4efe7', medallionScale: 0.8 },
  gootenProductName: 'Coffee Mug',
  buildVariants() {
    return [
      { options: ['11oz'], title: '11oz', variantCode: '11oz', priceUsd: 16.99, printKey: '11oz' },
      { options: ['15oz'], title: '15oz', variantCode: '15oz', priceUsd: 18.99, printKey: '15oz' },
    ];
  },
};

const TEE: MerchProduct = {
  id: 'tee',
  label: 'Unisex T-Shirt',
  shopifyProductType: 'T-Shirt',
  code: 'TEE',
  categoryTags: ['apparel', 't-shirt', 'molecule art'],
  options: [
    { name: 'Size', values: ['S', 'M', 'L', 'XL', '2XL'] },
    { name: 'Color', values: ['Black', 'White'] },
  ],
  // Standard DTG front print ≈ 15" × 18" @ 300 DPI.
  print: {
    widthPx: 4500, heightPx: 5400, dpi: 300,
    background: 'transparent', medallionScale: 0.82, center: [0.5, 0.42], safeMargin: 0.05,
  },
  mockup: { size: 1200, background: '#1b1d22', medallionScale: 0.74 },
  gootenProductName: 'Unisex T-Shirt',
  buildVariants() {
    const colorCode: Record<string, string> = { Black: 'BLK', White: 'WHT' };
    const variants: MerchVariant[] = [];
    for (const size of ['S', 'M', 'L', 'XL', '2XL']) {
      for (const color of ['Black', 'White']) {
        variants.push({
          options: [size, color],
          title: `${size} / ${color}`,
          variantCode: `${size}-${colorCode[color]}`,
          priceUsd: size === '2XL' ? 32.99 : 29.99,
          printKey: 'default',
        });
      }
    }
    return variants;
  },
};

const HAT: MerchProduct = {
  id: 'hat',
  label: 'Embroidered / Printed Cap',
  shopifyProductType: 'Hat',
  code: 'HAT',
  categoryTags: ['apparel', 'hat', 'headwear', 'molecule art'],
  options: [{ name: 'Color', values: ['Black', 'Navy', 'Khaki'] }],
  // Cap front panel ≈ 6" × 4" @ 300 DPI. Small area → the medallion fills most
  // of it. For EMBROIDERED caps Gooten needs a simplified, high-contrast mark
  // (few colors, no fine gradients); the printComposer's `flatten` path serves
  // that. Printed/patch caps can use the full render.
  print: {
    widthPx: 1800, heightPx: 1200, dpi: 300,
    background: 'transparent', medallionScale: 0.9, center: [0.5, 0.5], safeMargin: 0.08,
  },
  mockup: { size: 1200, background: '#20242b', medallionScale: 0.66 },
  gootenProductName: 'Embroidered Hat',
  buildVariants() {
    const colorCode: Record<string, string> = { Black: 'BLK', Navy: 'NVY', Khaki: 'KHA' };
    return ['Black', 'Navy', 'Khaki'].map((color) => ({
      options: [color],
      title: color,
      variantCode: `OS-${colorCode[color]}`,
      priceUsd: 24.99,
      printKey: 'default',
    }));
  },
};

const POSTER: MerchProduct = {
  id: 'poster',
  label: 'Giclée Poster',
  shopifyProductType: 'Poster',
  code: 'POST',
  categoryTags: ['wall art', 'poster', 'molecule art'],
  options: [{ name: 'Size', values: ['11x14', '12x18', '16x20', '18x24', '24x36'] }],
  // Posters print opaque (the paper is the background). Base spec is 18x24 @
  // 300; per-size overrides carry the exact pixel dimensions.
  print: {
    widthPx: 5400, heightPx: 7200, dpi: 300,
    background: '#0b0e14', medallionScale: 0.78, center: [0.5, 0.46], safeMargin: 0.08,
  },
  printByOption: {
    '11x14': { widthPx: 3300, heightPx: 4200 },
    '12x18': { widthPx: 3600, heightPx: 5400 },
    '16x20': { widthPx: 4800, heightPx: 6000 },
    '18x24': { widthPx: 5400, heightPx: 7200 },
    '24x36': { widthPx: 7200, heightPx: 10800 },
  },
  mockup: { size: 1200, background: '#0b0e14', medallionScale: 0.8 },
  gootenProductName: 'Giclée Art Print',
  buildVariants() {
    const price: Record<string, number> = {
      '11x14': 15.99, '12x18': 18.99, '16x20': 23.99, '18x24': 27.99, '24x36': 39.99,
    };
    return ['11x14', '12x18', '16x20', '18x24', '24x36'].map((size) => ({
      options: [size], title: size, variantCode: size, priceUsd: price[size], printKey: size,
    }));
  },
};

export const MERCH_PRODUCTS: Record<MerchProductId, MerchProduct> = {
  mug: MUG, tee: TEE, hat: HAT, poster: POSTER,
};

export const MERCH_PRODUCT_LIST: MerchProduct[] = [MUG, TEE, HAT, POSTER];

// ─── SKU / tag / handle helpers ─────────────────────────────────────

/** LUPI-<MOL>-<PROD>-<VARIANT>, e.g. LUPI-CAF-MUG-11oz. */
export function skuFor(moleculeName: string, product: MerchProduct, variant: MerchVariant): string {
  return `LUPI-${molCode(moleculeName)}-${product.code}-${variant.variantCode}`;
}

/** Storefront handle, e.g. caffeine-molecule-mug. */
export function handleFor(moleculeName: string, product: MerchProduct): string {
  return merchSlug(`${moleculeName}-molecule-${product.id}`);
}

/** Product title, e.g. "Caffeine Molecule Mug". */
export function titleFor(moleculeName: string, product: MerchProduct): string {
  const clean = moleculeName.replace(/^MCP:\s*/i, '').replace(/\s+molecule$/i, '').trim();
  const nice = clean.charAt(0).toUpperCase() + clean.slice(1);
  return `${nice} Molecule ${product.label.split(' ').slice(-1)[0]}`;
}

/**
 * Price tier tag (tier-1…tier-4) from the variant's price, matching the
 * store's tier-N tagging so merchandising rules keep working.
 */
export function priceTier(priceUsd: number): string {
  if (priceUsd < 18) return 'tier-1';
  if (priceUsd < 25) return 'tier-2';
  if (priceUsd < 33) return 'tier-3';
  return 'tier-4';
}

/** Full tag set for a product listing. */
export function tagsFor(moleculeName: string, product: MerchProduct, opts?: { theme?: string; topPriceUsd?: number }): string[] {
  const molecule = merchSlug(moleculeName.replace(/^MCP:\s*/i, '').replace(/\s+molecule$/i, ''));
  const tags = [...product.categoryTags, molecule];
  if (opts?.theme) tags.push(merchSlug(opts.theme));
  tags.push(priceTier(opts?.topPriceUsd ?? Math.min(...product.buildVariants().map((v) => v.priceUsd))));
  return Array.from(new Set(tags));
}

/** Resolve the effective Gooten print spec for a specific variant. */
export function printSpecFor(product: MerchProduct, variant: MerchVariant): GootenPrintSpec {
  const override = product.printByOption?.[variant.printKey];
  return override ? { ...product.print, ...override } : product.print;
}
