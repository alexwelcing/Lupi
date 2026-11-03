# Draft Shopify molecule companion

This optional Online Store 2.0 product-page section links an exact, editor-selected Shopify product to its molecule page in Lupi. It is **not installed**. The current live Horizon theme and the existing unpublished LOOT themes are unchanged.

The section has no default product mappings. A block selects one actual product through Shopify's product picker and one reviewed molecule: `caffeine`, `water` or `c60_buckyball`. The destinations are fixed to `https://lupi.live/launch/caffeine/`, `/launch/water/` and `/launch/c60/`. There is no editable URL, product-name inference, metafield dependency, App Store link, purchase unlock, query parameter, JavaScript or tracking pixel. The free Lupi experience remains optional.

The companion renders only on a product page with exactly one block matching that product's ID and a recognized molecule. Missing or deleted products, `none`, unknown molecule values, unmatched products and duplicate mappings for the current product all hide it. One section instance is allowed per product template. A matching block carries Shopify's editor attributes.

## Installation gates

Keep this file as a draft until the owner approves the selected storefront theme, the three campaign landing pages are deployed and verified, and each intended product-to-molecule association has been reviewed against the exact product, variant and current print identity. A shared molecule name or an old saved supplier product is insufficient. C60 is currently a development lane with no verified merchandise association; leave it unmapped.

After those gates pass:

1. Copy `sections/lupi-molecule-companion.liquid` into the approved theme's `sections/` directory in a development copy. Do not replace the live Horizon theme or publish another theme as part of this integration.
2. In the theme editor, add **Lupi molecule companion** below the main product information on the intended product JSON template. Add one **Product mapping** block per reviewed product, selecting the exact product and its reviewed molecule. Start with no blocks and verify the section is hidden.
3. Preview an approved match, an unmatched product, no molecule selection, an unknown value in draft template data and duplicate mappings. Only a single valid match should display the companion. Check keyboard focus and mobile spacing, then follow the theme owner's normal review and publication process.

This section offers optional molecule discovery. It does not establish supplier stock, print approval, physical sample acceptance, US delivery, checkout readiness or marketing-conversion measurement. The commerce offer feed stays closed until its separate readiness gates pass.

## Validation

The exact section passed Shopify's official Liquid helper in theme mode. Fifteen offline Liquid render cases checked the fixed destinations and hidden states, including missing context, unknown values and duplicate mappings. Those local checks do not establish appearance or behavior in the hosted Horizon theme; the development-theme preview above remains required.

## References

- [Shopify product-picker settings](https://shopify.dev/docs/storefronts/themes/architecture/settings/input-settings#product)
- [Section schema and template restrictions](https://shopify.dev/docs/storefronts/themes/architecture/sections/section-schema)
- [Theme performance practices](https://shopify.dev/docs/storefronts/themes/best-practices/performance)
