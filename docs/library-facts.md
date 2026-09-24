# Library facts: organizing the library so search can reason about it

Status: implemented 2026-09-24. Builds on the property ranking in
[jev-property-ranking.md](jev-property-ranking.md).

## The idea

Property ranking asked Jev from scratch on every keystroke. That doesn't
build up any knowledge, doesn't work offline, and can't describe what the
library contains. Library facts turn it into a layer that lasts:

```
                 once per entry, offline                      every search
┌────────────┐   ┌───────────────────────┐   ┌──────────────┐   ┌──────────────────────────────────┐
│ gallery    │──▶│ enrich-library.mts    │──▶│ library-     │──▶│ switcher · agents · reports      │
│ + sheet    │   │ Jev: 46 facet Nouls   │   │ facts.json   │   │ filter, sort, explain, count     │
│ + formula  │   │ + derivedFacts (code) │   │ (versioned)  │   │ Jev only reads the typed words   │
└────────────┘   └───────────────────────┘   └──────────────┘   └──────────────────────────────────┘
```

1. **A fixed vocabulary** (`packages/core/src/facets/taxonomy.ts`): 46 facets
   in five groups. What it is (metal, alkaloid, terpene, solvent…), where it
   comes from (human body, plants, food, mineral, made by people), what it is
   used for (medicine, batteries, aircraft, electronics, flavour…), how it
   behaves (gas, floats, flammable, toxic, conducts, sweet…), and what kind of
   library entry it is (simulation, demo). Ids are permanent.
2. **Enrichment, once per entry** (`tools/enrich-library.mts`): one Jev call per
   entry, one Noul per facet, with the title, formula, category, substance,
   and reference evidence as state. Where the reference sheet can decide a
   facet (phase, floats, dissolves, melts above 1000 °C), `derivedFacts`
   overrides Jev, and the entry records which facets were derived. The result
   is `packages/ui/src/library/library-facts.json`, stamped with the taxonomy
   fingerprint, prompt version, and model.
3. **Incremental.** Each entry stores a hash of what was judged. A run
   re-judges only entries that changed, or everything when the taxonomy or
   prompt changes. The full library of 103 entries takes 2.7 s and about
   275,000 input tokens (roughly $0.01).
4. **Search reads the facts as data.** A facet filter costs nothing, works
   without Jev, and gives the same answer in the switcher and to agents.

## Search as a multi-step process

`organize` in `packages/ui/src/switcher/searchPlan.ts`:

1. **Read.** In one call alongside the existing judgment, Jev reads which
   facets the typed words ask for (`ask:<facet>`, 45 request-level Nouls)
   and the rank mode and property. "flammable liquid that floats" becomes
   liquid + floats + flammable (+ fuel, an over-read). These show as dashed,
   removable chips, so the reading is visible and correctable.
2. **Filter** against the checked-in facts with a soft AND:
   Π (1 − ask × (1 − fact)). A facet you tapped is a hard requirement. So is a
   facet the reference sheet contradicts: ethanol mixes into water, so it
   cannot "float". A facet Jev merely over-read demotes an entry instead of
   deleting it, and the row says what it lacks ("partial", ✗ fuel). An entry
   must satisfy at least half of the asked weight.
3. **Order.** A sort you chose wins. Next comes Jev's measured plan ("lightest"
   means density, lowest first). Then Jev's live judgment for superlatives
   with no number ("hardest"). Then the facet match, scaled by the live
   per-candidate judgment where it exists: "smells like citrus" reads as
   smell + scent + plants, which vanillin satisfies too, and `has:` knows
   limonene is the citrus one. Full matches sort before partial ones.
4. **Explain.** Every row shows its sort value or Jev's probability, plus
   `✓ metal · aircraft ✗ fuel`. The status line names the filters and the sort,
   and says who chose each.

Named lookups stay lookups. "caffeine" implies alkaloid, food, and
psychoactive, but Jev calls it a lookup at 1.0, and facets apply only below
0.6 lookup confidence.

### The organize bar

Below the element chips in the switcher:

- **Filter by…** opens every facet, grouped, with how many entries have it.
- **Sort** picks molar mass, size, density, melting point, or boiling point,
  with a direction toggle. When Jev chose the sort, the toggle says so.
- The filters and sorts work with no query and no Jev: tap "Psychoactive",
  sort by molar mass, and LSD (323.4 g/mol) leads.
- Typing a facet word ("metal", "flammable") matches entries with that facet
  locally, before Jev answers.

### Agents

`lupi.search_molecules` takes `facets` (an enum of the facet ids, so the
vocabulary is discoverable from `/browser-mcp-manifest.json`), `sortBy`, and
`order`. Gallery hits carry `facts`: facet ids, molar mass, density, melting
and boiling points, and phase. Agents get the same answer the UI gives:

```js
window.__lupiViewerMcp.execute({ id: 'q', tool: 'lupi.search_molecules',
  arguments: { query: '', facets: ['metal', 'aerospace'], sortBy: 'density', order: 'asc' } });
// → Mg HCP Slip Playthrough (1.738), Al Polycrystal (2.70)
```

## Measured

`tools/eval-jev-rank.mts` runs the real edge handler, then the switcher's
`organize`, over 27 labeled queries. Those are the 18 from the ranking round
plus 9 compound ones ("psychoactive alkaloid", "toxic solvent", "bitter
medicine", "lightest metal used in aircraft", "highest boiling liquid that
floats"…). [Receipt](jev-rank-eval-2026-09-24.json): 27 of 27, stable across
three consecutive runs, median about 400 ms.

What the live runs changed, in order:

| Finding | Change |
|---|---|
| Jev said aluminium (2.70 g/cm³, listed) floats at 0.59 | `derivedFacts`: the sheet decides phase, floats, solubility, and high melting |
| Ice was marked "mixes in" | solids lighter than water float even if they later dissolve |
| "asks only for things that…" read "floats in water" at 0.57 | four query phrasings compared; "names or clearly implies the requirement" puts positives at 0.80 to 0.98 |
| "small molecule" read at 0.6 to 0.9 from nearly any text | excluded from query reading |
| The long floats predicate read at 0.69 to 0.77 | plain "floats on water" reads at 0.93; precision lives in `derivedFacts` |
| One over-read facet emptied the list | soft AND; partial matches are kept and labeled |
| A one-facet partial listed tungsten under "floats" | partials must satisfy half the asked weight |
| Vanillin above limonene for "citrus" | blend with the live `has:` judgment |
| Nicotine (mixes in) led "highest boiling liquid that floats" | full matches sort before partials; a sheet contradiction is a hard miss |
| "heaviest thing made in the human body" flapped to judged | the property gate uses 1 − P(other), as the mode gate uses the summed ranking probability |

## What the library has, and lacks

`pnpm run report:library-facts` prints coverage per facet with no API call.
Today, with 103 entries:

- Thinnest: framework or polymer 1, fuel 1, aircraft 2, sugar 2, lipid or
  steroid 2, DNA or RNA part 2, amino acid 3, batteries 3, gems 3, magnetic 3,
  sweet 3.
- Deepest: small molecule 67, solid 68, made by people 47, from plants 39,
  simulation 32.
- 13 entries have neither a formula nor reference evidence (the QR codes,
  scale tests, and research paths). They are never ranked by a property.

Coverage is the acquisition list. Titanium, steel, gold, PET, methane,
propane, octane, magnetite, and a fatty acid would each fill a facet that
has 0 to 2 entries today.

## Running it

```bash
TYPESAFE_API_KEY=... pnpm run enrich:library      # judge what changed
pnpm run check:library-facts                      # exit 1 if the facts are stale (no API)
pnpm run report:library-facts                     # coverage (no API)
TYPESAFE_API_KEY=... pnpm run eval:jev-rank        # 27 labeled live cases
```

Adding a gallery entry: add it to `gallery-data.json`, add a
`property-sheet.json` entry if it is a real substance, then run
`enrich:library`. Adding a facet: add it to `FACETS` with a short, plain
predicate, then run `enrich:library` (the fingerprint changes, so every entry
is re-judged) and `eval:jev-rank`.

## Where to take it next

These are ordered by how much each reuses what now exists.

1. **The Library page.** `GalleryCollection` and `LibraryBrowser` still use
   text search. `FacetBar` and `organize` are self-contained, so the same bar
   drops in there, and the URL can carry `?facets=metal,aerospace&sort=density`
   through `useLibraryQuery`.
2. **"More like this".** Each entry now has a facet vector. Cosine similarity
   over facets plus shared elements gives a deterministic "similar molecules"
   row under the loaded structure. No call is needed.
3. **An "About this" card for the loaded structure.** Show its facts with
   provenance: reference value, computed, or Jev with the model version. That
   reads the library back to the user, which is the "analyze what we have"
   half.
4. **Compare.** Pick two or three rows and get a table of measured values
   and facets side by side. The data is already in `HitFacts`.
5. **OMol25 at scale.** Its 27,697 validation rows already get molar mass.
   Formula-derived facets (contains a metal or a halogen, charge, spin) are
   free. Jev enrichment of all rows would cost about 75M tokens (about $3).
   The result belongs in an edge-served index (R2/D1 through the dataset
   edge), not the bundle.
6. **An edge search tool.** A `lupi.search_library` on the Cloudflare MCP
   manifest that reads the same facts file, so agents without a browser can
   filter and sort.
7. **The scanner.** `/v1/scan/identify` already names the materials in a
   photo. Mapping them to facets ("aluminium can" → metal) instead of free
   text makes photo results use the same filters.
8. **Saved views and uploads.** Enrich on save through an edge route, so a
   user's own structures become filterable with the same vocabulary.
9. **Learn from removals.** A removed Jev chip is a labeled over-read, and a
   kept one is a confirmation. Log the facet id (not the query) with the
   `lupi_jev` line and tune `QUERY_FACET_THRESHOLD` per facet from real use.
10. **Sourced reference values.** Fill `property-sheet.json` from PubChem's
    experimental properties with a citation per value, instead of by hand, so
    the sheet can grow with the library.
