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

## Design system — LUPI · Molecular Editions

The collection is art-directed, not templated. Brand voice: **The Row ×
Magic School Bus** — quiet-luxury grounds (bone studio, ink garments, white
ceramic), the vivid 3D molecule as the only loud thing in frame, and type at
a whisper (Fraunces display + IBM Plex Mono data, real subscript formulas).

**Scale is the design language.** Every product has a small wardrobe of
*looks* at opposite extremes, and each molecule×product pair is assigned one
(`LOOKS` / `assignLook` in `artDirection.ts`):

| Product | Looks | The extreme |
| --- | --- | --- |
| Tee | `grand` / `pocket` | specimen blown past the print edge on ink ↔ jewel-small left-chest mark on bone |
| Cap | `micro` | tiny exact emblem, dead-centre crown |
| Mug | `wrap` / `mark` | editorial name+molecule wrap ↔ one tiny mark on all that ceramic |
| Poster | `specimen` / `colossal` | small specimen adrift in dark ↔ abstract crop larger than the sheet |

Each molecule also carries a descriptor computed from its real geometry
(`buildDescriptor`): Hill-order formula with subscripts, atom count, curated
IUPAC/tagline copy, and an accent colour keyed to its dominant heteroatom
(N → blue, O → red …) that drives the aura and keylines. Storefront images
are flat-lay lookbook tiles (`garments.ts`) showing the piece with the
molecule at its true placement/scale.

Brand fonts live in `apps/web/public/fonts/` (same-origin so the headless
renderer and production load identically).

## Components

| File | Role |
| --- | --- |
| `packages/ui/src/export/moleculePngRenderer.ts` | Renders the molecule-only transparent PNG (offscreen WebGL, straight alpha, print resolution). |
| `packages/ui/src/export/exportStyle.ts` | Shared coloring/radii/material/bond resolvers — one look across PNG, GLB, USDZ, merch. |
| `packages/ui/src/merch/merchCatalog.ts` | Product catalog: Gooten print specs + Shopify option/variant/SKU/tag/price templates. **Single source of truth.** |
| `packages/ui/src/merch/artDirection.ts` | The brand layer: palette, fonts, molecule descriptor (formula/accent/copy), and the look wardrobe + per-molecule assignment. |
| `packages/ui/src/merch/canvasKit.ts` | Shared 2D primitives: grounds, aura/orbit/grain, molecule placement, tracked type + subscript formula. |
| `packages/ui/src/merch/printComposer.ts` | Production art: composes each look's Gooten print file per product. |
| `packages/ui/src/merch/garments.ts` | Flat-lay lookbook mockups: garment silhouettes with the molecule at true placement/scale. |
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
  Gooten print file attached, `lupi.*` + `gooten.*` metafields set, and
  **SKUs mapped** (`gooten.status: mapped` → `Mug-11oz` / `Mug-15oz`).
- **Caffeine Molecule Cap** — Black + Navy variants, design attached, **SKUs
  mapped** to Gooten's Richardson 113 Foamie Trucker (DTF print):
  `TruckerCap-DTF-Richardson-113-{Black,Navy}`. Khaki was dropped (no Gooten
  SKU) and the copy reworded from "embroidered" to DTF print to match what
  Gooten actually produces.
- **Creatine Molecule T-Shirt** — creatine design attached (one 4500×5400 DTG
  print file), `lupi.*` + `gooten.*` metafields incl. `print_map` for all 10
  size/color SKUs.
- **Serotonin Molecule Poster** — serotonin design attached with **per-size
  print files** (five files, one per size), each SKU pointing at its correctly-
  dimensioned file via `gooten.print_map`.
- **Molecule Merch** collection — groups the mug, tee, poster, and cap.

All four caffeine/creatine/serotonin products now carry designs. SKU
resolution to Gooten is done for the mug + cap; the tee + poster are
`gooten.status: pending-map` until their Gooten SKUs are filled (same
`tools/gooten.mjs variants` step).

> **Shopify image cap** — Shopify processes product images up to ~20 MP, so
> the poster's large sizes are dimensioned to fit (150–300 DPI, `printByOption`
> in `merchCatalog.ts`) rather than a raw 300-DPI 24×36 (78 MP). For higher-res
> large-format print files, host them off Shopify and point `gooten.print_map`
> there.

## Buy from the viewer (in-app commerce)

The viewer sells directly. When a Storefront token is configured, a **Shop**
button appears on the loaded molecule; it opens a drawer with that molecule's
products (via the Shopify **Storefront API**), and **Buy now** goes straight to
Shopify checkout — two clicks from viewer to buying, all in-app until the final
payment page.

```
viewer ─(click 1: Shop)─► drawer: molecule's products, variant pick, price
                          └(click 2: Buy now)─► Shopify secure checkout (new tab)
```

- `packages/ui/src/commerce/storefront.ts` — Storefront API client (browser-safe
  public token), molecule→products (by tag), and cart (`buyNow`, `addToCart`).
- `packages/ui/src/commerce/ShopDrawer.tsx` — the in-viewer buy surface; also a
  mini-cart with a Checkout button. Falls back to a clear "not connected" or
  "no merch yet" state.

### Turning it on

1. **Create a public Storefront access token** in Shopify admin → *Apps →
   Develop apps → (create app) → Storefront API access token* (or install a
   Headless/Hydrogen channel). Read scopes for products + cart. *(This can't be
   done via the API tools — token management is admin-only.)*
2. **Set the build env** (never commit the token):
   ```
   VITE_SHOPIFY_STORE_DOMAIN=lupi-8182.myshopify.com
   VITE_SHOPIFY_STOREFRONT_TOKEN=<public storefront token>
   ```
3. **Publish the products** — the Storefront API only returns products that are
   **ACTIVE** and published to the sales channel the token reads (Online Store /
   Headless). Publishing is also what makes them buyable, so "shows in the
   drawer" == "purchasable".
4. **Map the Gooten SKUs first** (see above) so a real order can actually be
   fulfilled — fill `gooten.sku_map` before going live.

Checkout itself is Shopify's hosted page (required below Shopify Plus); the
drawer opens it in a new tab so the viewer stays open. The token is public and
read/cart-only — safe in the browser.

## Fulfillment: Shopify → Gooten (the order wire)

When a customer checks out, the Shopify order has to reach Gooten to be printed
and shipped. That's a webhook bridge:

```
Shopify checkout ─► orders/create webhook ─► gootenOrderWebhook (Firebase)
                                              │ verify HMAC
                                              │ per line: gooten.sku_map[sku] + lupi.design_url
                                              ▼
                                        Gooten Orders API  ─►  printed + shipped
```

- `functions/src/gooten.ts` — Gooten client + a **pure** Shopify-order →
  Gooten-order transform (`buildGootenOrder`) + HMAC verify. Unit-tested
  (`gooten.test.ts`, 8 tests) with no credentials.
- `functions/src/gootenBridge.ts` — `gootenOrderWebhook`: authenticates the
  Shopify webhook, resolves each line's Gooten SKU + print file from the
  product's metafields, and submits the order (idempotent via the Shopify order
  id, so webhook re-delivery never double-charges).
- `tools/gooten.mjs` — CLI to read the Gooten catalog and resolve SKUs:
  `catalog`, `variants --product "Coffee Mug"`, and a `test-order` (test mode,
  no charge) that proves the pipeline end to end.

### Turning fulfillment on

1. **Get your Gooten keys** — Gooten panel → *Settings → API*: the **Recipe ID**
   (goes in request URLs) and the **Partner Billing Key** (server-side only,
   charges fulfillment).
2. **Map the SKUs** — for each product family, list Gooten's orderable SKUs and
   write them into each product's `gooten.sku_map` (`{ shopifySku: gootenSku }`):
   ```
   GOOTEN_RECIPE_ID=… node tools/gooten.mjs variants --product "Coffee Mug"
   # pick the SKU per size/color, then set gooten.sku_map on the Shopify product
   ```
   (The `merch-publish` connector seeds `gooten.sku_map` with empty values +
   `gooten.status: pending-map`; fill them here.)
3. **Set the function secrets** (never in source) and deploy:
   ```
   firebase functions:secrets:set GOOTEN_RECIPE_ID
   firebase functions:secrets:set GOOTEN_PARTNER_BILLING_KEY
   firebase functions:secrets:set SHOPIFY_ADMIN_TOKEN
   firebase functions:secrets:set SHOPIFY_WEBHOOK_SECRET
   # SHOPIFY_STORE_DOMAIN + GOOTEN_TEST_MODE are non-secret params
   firebase deploy --only functions:gootenOrderWebhook
   ```
4. **Register the Shopify webhook** — Settings → Notifications → Webhooks (or
   Admin API `webhookSubscriptionCreate`): topic `orders/create` →
   the deployed function URL. Use the webhook's signing secret as
   `SHOPIFY_WEBHOOK_SECRET`.
5. **Test** — keep `GOOTEN_TEST_MODE=true`, place a test order (or
   `node tools/gooten.mjs test-order --sku … --image …`), confirm it appears in
   Gooten, then set `GOOTEN_TEST_MODE=false` to go live.

Only after the SKUs are mapped and a test order flows should the products be
published (ACTIVE) — otherwise a real purchase can't be fulfilled.

## Extending

- **Per-size print files** — `export_merch` currently emits one print file per
  product (the primary variant). For products whose sizes need distinct print
  canvases (poster sizes, 11oz vs 15oz mug), loop the distinct `printKey`s in
  `merchCatalog` and compose one file each.
- **Embroidered caps** — the store's caps are DTF-printed (Richardson 113),
  which takes the full-color render directly. If a true embroidery product is
  ever added, Gooten embroidery needs a simplified, high-contrast, few-color
  mark — add a `flatten` pass in `printComposer` for that variant.
- **Gooten API push** — the manifest is import-ready today. To automate the
  bind, add a Gooten adapter behind `GOOTEN_API_KEY` in `merch-publish.mjs` that
  creates the Gooten product and writes the real SKUs back into
  `gooten.sku_map`.
- **New molecules** — nothing hard-coded; any molecule (name / SMILES /
  procedural) flows through with an auto-derived `<MOL>` code.
