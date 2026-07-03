# Merch system — molecule → Shopify (Gooten-fulfilled)

Turn any molecule in the Lupi viewer into print-on-demand products (mugs, tees,
caps, posters) on the Shopify store, fulfilled by Gooten. This is the
"interface + system" that connects the rendered molecule assets to real
merchandise.

## The pipeline at a glance

```
 molecule (viewer / MCP / CLI)
     │
     ▼  render a clean, transparent, molecule-only PNG
 moleculePngRenderer.ts  ──►  square hero asset (no bg, no UI, straight alpha)
     │
     ▼  place on each product's Gooten print area + compose a storefront tile
 printComposer.ts + merchCatalog.ts
     │            print file (2700×1155 mug wrap, 4500×5400 tee, …)  +  mockup tile
     ▼
 listing shape (title / handle / tags / variant SKUs / prices / print dims)
     │
     ├──►  Shopify product (create/update)  ──►  design image + lupi.*/gooten.* metafields
     │        tools/merch-publish.mjs  (Admin GraphQL: productSet, staged upload)
     │
     └──►  Gooten manifest (SKU → Gooten product + print file + dims + price)
              gooten-manifest.{json,csv}  →  import in Gooten Hub / Gooten API
```

Every stage shares one source of truth (`merchCatalog.ts`), so the in-app
Studio, the headless CLIs, and the connector always agree on SKUs, prices,
tags, and print dimensions.

## Components

| File | Role |
| --- | --- |
| `packages/ui/src/export/moleculePngRenderer.ts` | Renders the molecule-only transparent PNG (offscreen WebGL, straight alpha, print resolution). |
| `packages/ui/src/export/exportStyle.ts` | Shared coloring/radii/material/bond resolvers — one look across PNG, GLB, USDZ, merch. |
| `packages/ui/src/merch/merchCatalog.ts` | Product catalog: Gooten print specs + Shopify option/variant/SKU/tag/price templates. **Single source of truth.** |
| `packages/ui/src/merch/printComposer.ts` | Trims the molecule to content, composes the Gooten print file + storefront mockup. |
| `packages/ui/src/merch/MerchStudio.tsx` | In-app interface: preview the molecule on every product, export the pack, show the publish command. |
| `packages/ui/src/mcpViewerBridge.tsx` | `lupi.export_merch` MCP tool + `?merch=<product>` URL bootstrap → `window.__lupiMerchResult`. |
| `tools/merch-render.mjs` | Headless CLI: molecule → print files + mockups + `listing.json`. |
| `tools/merch-publish.mjs` | Connector: Shopify create/update + Gooten manifest. |

## Store conventions (mirrored from the seeded drafts)

- **Vendor**: `Lupi`
- **SKU**: `LUPI-<MOL>-<PROD>-<VARIANT>` — e.g. `LUPI-CAF-MUG-11oz`, `LUPI-CAF-TEE-S-BLK`, `LUPI-CAF-HAT-OS-BLK`
- **Tags**: `<category…>`, `molecule art`, `<molecule>`, `tier-<n>` (price tier)
- **Status**: products stay **DRAFT** until you pass `--publish`
- **Metafields**:
  - `lupi.molecule` (json) — `{name, code, formula}`
  - `lupi.view` (text) — camera angle used
  - `lupi.design_url` (url) — the Gooten print file on Shopify's CDN
  - `gooten.product` (text) — Gooten product family (e.g. "Coffee Mug")
  - `gooten.sku_map` (json) — `{ <shopifySku>: <gootenSku> }` (fill from Gooten Hub)
  - `gooten.status` (text) — `pending-map` → `mapped`

## Product catalog (defaults)

| Product | Gooten print (px @ 300dpi) | Variants | Price |
| --- | --- | --- | --- |
| Mug | 2700×1155 (11oz), 2963×1263 (15oz) | Size | $16.99 / $18.99 |
| T-Shirt | 4500×5400 | Size × Color | $29.99 (2XL $32.99) |
| Cap | 1800×1200 | Color | $24.99 |
| Poster | 3300×4200 … 7200×10800 | Size | $15.99 – $39.99 |

> Print sizes are sensible 300-DPI defaults. Gooten's per-SKU templates are the
> final authority — override `print` / `printByOption` in `merchCatalog.ts` once
> you read the exact template size from Gooten, and every tool follows.

## Usage

### In the app
Viewer → **Export** panel → **Sell as merch** → **Generate**. Preview all four
products, **Download print files + listing.json**, then run the connector.

### Headless
```bash
# 1. Build the app once (the CLIs drive the shipped viewer):
pnpm --filter web build

# 2. Render the merch assets for a molecule:
node tools/merch-render.mjs --name caffeine --product all --out-dir merch/caffeine
#   → merch/caffeine/*.png + listing.json
#   (also: --smiles "c1ccccc1", or --atoms 20000 --element Cu --lattice fcc)

# 3a. Dry run — writes the Gooten manifest + a Shopify plan, no store writes:
node tools/merch-publish.mjs --dir merch/caffeine

# 3b. Publish to Shopify (DRAFT) + write the Gooten manifest:
SHOPIFY_STORE=lupi-8182.myshopify.com \
SHOPIFY_ADMIN_TOKEN=shpat_xxx \
node tools/merch-publish.mjs --dir merch/caffeine --execute      # add --publish to go ACTIVE

# 4. In Gooten Hub, import merch/caffeine/gooten-manifest.csv and bind each
#    Shopify SKU to a Gooten product/variant, then set gooten.sku_map / status.
```

The Admin token needs `write_products` and `write_files`. **Keep it
server-side** — the browser Studio never sees it; it exports the pack and hands
off to this CLI.

### Programmatic / agent (MCP)
```
# One URL: generate a molecule and its merch pack.
/?mcp=1&name=caffeine&merch=all&download=0#/mcp
# → window.__lupiMerchResult.listings  (print files + mockups + listing shape)
```
Or call the tool directly: `{"tool":"lupi.export_merch","arguments":{"product":"all"}}`.

## What's already live in the store

- **Caffeine Molecule Mug** — molecule design as the featured image, 2700×1155
  Gooten print file attached, `lupi.*` + `gooten.*` metafields set.
- **Caffeine Molecule Cap** — created (3 color variants, correct SKUs), design
  attached, metafields set.
- **Molecule Merch** collection — groups the mug, tee, poster, and cap.

The Creatine Tee and Serotonin Poster drafts still need their designs — run
`merch-render --name creatine --product tee` / `--name serotonin --product
poster` then `merch-publish`.

## Extending

- **Per-size print files** — `export_merch` currently emits one print file per
  product (the primary variant). For products whose sizes need distinct print
  canvases (poster sizes, 11oz vs 15oz mug), loop the distinct `printKey`s in
  `merchCatalog` and compose one file each.
- **Embroidered caps** — Gooten embroidery needs a simplified, high-contrast,
  few-color mark. Add a `flatten` pass in `printComposer` for the hat print.
- **Gooten API push** — the manifest is import-ready today. To automate the
  bind, add a Gooten adapter behind `GOOTEN_API_KEY` in `merch-publish.mjs` that
  creates the Gooten product and writes the real SKUs back into
  `gooten.sku_map`.
- **New molecules** — nothing hard-coded; any molecule (name / SMILES /
  procedural) flows through with an auto-derived `<MOL>` code.
