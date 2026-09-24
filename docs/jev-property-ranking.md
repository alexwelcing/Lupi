# Jev property ranking in the molecule switcher

Status: implemented 2026-09-24. Extends the switcher judgment described in
[jev-integration.md](jev-integration.md).

The switcher already answered "which molecule do you mean". It now also
answers property questions:

| You type | What happens |
|---|---|
| `floats in water` | filter: every known substance Jev judges would float, most likely first, each row labeled `Jev 83%` |
| `metal for planes` | filter: aluminium, then magnesium and the Cantor alloy |
| `heaviest metal`, `most dense` | ranked by reference density, highest first: tungsten 19.3 g/cm³ |
| `lightest metal` | ranked by density, lowest first, metals only: magnesium 1.74 g/cm³ |
| `heaviest liquid` | ranked by density among liquids: 1-bromobutane 1.28 g/cm³ |
| `lightest molecule` | ranked by molar mass computed from the formula: water 18.0 g/mol |
| `highest melting point` | ranked by reference melting point: tungsten 3422 °C |
| `hardest material` | no number exists, so Jev's own judgment orders it: the diamonds first |
| `used in batteries`, `smells like citrus`, `sweet` | filter by Jev |
| `caffeine` | not a ranking; the ordinary best-guess path runs unchanged |

## Who does what

Jev's published weaknesses include arithmetic, counting, and numeric
representations. Asked directly, it ranked diamond above tungsten for "most
dense". So the work is split:

1. **Jev reads the request.** Two Choice questions: `rank_mode` (lookup,
   filter, most, least, none) and `rank_property` (molar mass, size, density,
   melting point, boiling point, other). The property came back at 0.95 to
   1.0 confidence on every test query; the mode at 0.99 or above for
   superlatives and filters that name a property, and lower for loose
   phrasings ("metal for planes" 0.72, "sweet" 0.64).
2. **Jev scopes the group.** Per candidate, a `kind:` Noul: is this the kind
   of thing being compared, ignoring "heaviest" or "lightest". On the live
   pool this split bimodally around 0.5, which is how "lightest metal" skips
   oxygen gas.
3. **Code sorts by the number** when the property has one: molar mass from
   the formula and the element table (`molarMass` in core), atom count from
   the structure, and density and transition temperatures from the curated
   sheet.
4. **Jev's probability orders the rest.** A per-candidate `has:` Noul (does
   it do what the request says, read literally, at room temperature, using
   the listed evidence) drives filters and the properties without numbers.

Every row shows what placed it: a solid badge for a measured or computed
value, a dashed `Jev 77%` for a judgment, and `no data` for a group member
with no value, which trails a measured ranking. The status line says which
it was, e.g. "ranked by density, highest first · reference values; group
judged by Jev (inferred)".

## The reference sheet

`packages/ui/src/switcher/property-sheet.json`, keyed by gallery id: the
substance a simulation or material entry represents ("aluminium", "ZIF-8
metal-organic framework"), phase at 25 °C, density near 25 °C in that phase,
melting and boiling points, and behaviour in water. Typical handbook values
(CRC Handbook, PubChem). A missing field means not known, never zero. 85 of
the 103 openable gallery entries have one.

Only known substances are ranked: an entry with a formula or a sheet entry.
The atom QR codes, scale tests, and demos have atom counts but no substance,
and `kind:` could not tell them from molecules, so they are not asked about.

The evidence travels with each candidate to the edge and into Jev's state
(`substance`, `phase_at_25C`, `density_g_per_cm3`, `in_water`, and so on).
Adding it moved ice from fifth to first for "floats in water" and put the
ZIF-8 framework (0.95 g/cm³) in the list.

## Wire contract

`POST /v1/switch/judge` takes two new optional fields: `rank: true` on the
request (ignored without a query), and per candidate `category` (the gallery
shelf) and `evidence` (the sheet entry, re-sanitized at the edge). With
`rank: true` the response gains:

```json
"rank": {
  "mode": { "choice": "most", "confidence": 0.99, "ranking": 0.99 },
  "property": { "choice": "density", "confidence": 0.99 },
  "has": { "gallery:sand_w_cascade": 0.3 },
  "kind": { "gallery:sand_w_cascade": 0.7 }
}
```

`mode.ranking` is P(filter) + P(most) + P(least). The gate is on that sum
(0.6): a one-word request such as "sweet" splits Jev between lookup and
filter, and the sum still says it is a property question. The prompt version
is `switch-v4-everyday+rank-v1`, so judgments cached under the old prompt are
not served.

The questions all go in the same call as `intent`, `best`, and `fit`
(Jev's documented speculative fan-out). The ranking adds two Nouls per known
substance: about 14,000 input tokens, about $0.0006 per judgment, and a
median of 383 ms direct.

## Measured

`tools/eval-jev-rank.mts` runs the real edge handler over the gallery pool
and checks the plan and the leaders for 18 labeled queries.
[Receipt](jev-rank-eval-2026-09-24.json): 18 of 18, median 383 ms.

```bash
TYPESAFE_API_KEY=... pnpm exec tsx tools/eval-jev-rank.mts
TYPESAFE_API_KEY=... pnpm exec tsx tools/eval-jev-rank.mts --json > docs/jev-rank-eval-<date>.json
```

Known soft spots, from the runs:

- The floating liquids come back as a near tie (0.70 to 0.76), so their
  order among themselves changes between runs. The eval pins only the leaders.
- "lowest boiling solvent" counts the R32 and R125 refrigerants as solvents
  and leads with them. Jev's `kind:` for "solvent" is generous.
- "biggest molecule" puts the faceted diamond first by atom count; a diamond
  is one covalent network, so that is defensible, but it is not what most
  people mean.

## Tuning

Thresholds are in `packages/core/src/jev/propertyRank.ts`:
`RANK_MODE_THRESHOLD`, `RANK_PROPERTY_THRESHOLD`, `KIND_THRESHOLD`, and
`HAS_THRESHOLD`. The `lupi_jev` log line now carries `rankMode`,
`rankModeConfidence`, `rankProperty`, and `rankPropertyConfidence`. Change an
instruction or criterion only with a bump to
`PROPERTY_RANK_PROMPT_VERSION` and a fresh eval receipt.

## Next

- More substances with evidence. The OMol25 rows already get molar mass from
  their formula but are not in Jev's pool; adding a curated materials shelf
  (titanium, steel, lead, gold) would make "metal for planes" name titanium.
- Expose the same ranking to agents through `lupi.search_molecules`.
