# Jev integration: key placement and the molecule switcher

Status: implemented 2026-09-19 on the Cloudflare edge and in the viewer.
Background and the wider opportunity map are in the
[TypeSafe research brief](typesafe-jev-research-2026-09-18.md).

## Where the key goes

Jev is only ever called from the Cloudflare Worker in `apps/mcp-worker`.
The browser never holds the key.

**Production.** Set the secret once on the `lupi-edge` Worker; ordinary
`versions upload` deploys leave secrets in place:

```bash
cd apps/mcp-worker
npx -y wrangler@4.110.0 secret put TYPESAFE_API_KEY
```

Then confirm from the public health route, which reports configuration
without revealing anything:

```bash
curl -s https://lupi.live/health | jq .jev
# { "configured": true, "routes": ["/v1/switch/judge"] }
```

**Local development.** Put the key in `apps/mcp-worker/.dev.vars`
(git-ignored) and run the Worker with `pnpm cloudflare:dev`; the Vite dev
server proxies `/v1/switch` to it like it proxies `/v1/datasets`:

```ini
TYPESAFE_API_KEY=sk-...
```

Optional overrides: `TYPESAFE_API_BASE` (a gateway) and `TYPESAFE_MODEL`
(pin `jev-1.13.0` when tuning thresholds). Never put the key in
`wrangler.toml` `[vars]` or in any `VITE_` variable.

**Without the key** every Jev route answers `{ "configured": false }`. The
browser notices once per session and keeps its deterministic behavior. Nothing
user-visible depends on Jev being present.

## The seam: `apps/mcp-worker/src/jev.ts`

One module talks to the model. Instructions and criteria are constants in
code; user text only ever appears as a value inside `state`. Each call has a
1.5 second timeout, one retry on 429 or 529, and a one hour edge cache keyed
on the request. Every call logs one aggregate line, component `lupi_jev`,
with model version, confidences, candidate count, and latency. The query text
is never logged.

## Route: `POST /v1/switch/judge`

Used by the viewer's molecule switcher. Body, all bounded and sanitized:

```json
{
  "query": "something aromatic with nitrogen",
  "elements": ["C", "N"],
  "loaded": { "title": "water.xyz" },
  "candidates": [
    { "key": "gallery:caffeine", "title": "Caffeine", "formula": "C8H10N4O2", "elements": ["C","H","N","O"], "atoms": 24, "source": "gallery" }
  ]
}
```

At most 40 candidates, 200 query characters, 32 KB. Three question kinds in
one parallel call: Choice `intent` over six fixed request kinds, Choice `best`
over the candidate keys plus `none`, and one Noul `fit:<key>` per candidate.
Response:

```json
{
  "configured": true,
  "model": "jev-1.13.0",
  "intent": { "choice": "class_or_property", "confidence": 0.81 },
  "best": { "key": "gallery:caffeine", "confidence": 0.93 },
  "fit": { "gallery:caffeine": 0.97 }
}
```

A `none` choice returns `best: null`. Errors return the status with an
`error` field; the browser treats any non-2xx as "no judgment".

## What the live key showed (2026-09-19)

With a real key in a local Worker, the switcher was driven end to end and
the judgment was measured on a labeled set
([receipt](jev-switch-eval-2026-09-19.json), `tools/eval-jev-switch.mjs`).

| Measure | Value |
|---|---|
| Labeled cases | 27 |
| Exact expected pick | 25 (the two others were correct answers the labels omitted: cortisol is a steroid, and the gallery has no iron entry) |
| Accuracy at confidence 0.6 or above | 0.91 |
| Median latency, direct | 214 ms |
| Median latency, through the local Worker | about 300 ms |
| Input tokens per judgment | about 10,000 |
| Cost per judgment | about $0.0004 |

Three design decisions came out of playing with it rather than planning it:

1. **Judge the whole gallery, not just the typed matches.** The Choice
   pool is the local matches plus every gallery entry (up to 160), so
   "something sweet", "painkiller", "the molecule in coffee", and "energy
   currency of the cell" resolve to glucose, aspirin, caffeine, and ATP even
   though the typed text matches nothing. Fit probabilities are only asked
   for the rows already on screen.
2. **Start the judgment when typing pauses, not when the list settles.**
   The first build waited for the PubChem name lookup before asking Jev; a
   slow lookup delayed the best guess by seconds. The judgment now starts
   from the synchronous gallery matches, and PubChem has its own 1.5 s cap.
3. **Be conservative with the answer.** A best pick at 0.6 or above leads
   the list; between 0.3 and 0.6 it is a dashed "Maybe" hint; below that it
   is not shown. The rest of the list keeps its deterministic order, and
   only rows Jev rates under 0.35 fit move to the end. An intent of
   `not_a_molecule` at 0.8 or above turns the empty state into a plain
   sentence saying so. The instruction prefers a food, drug, or household
   compound over a laboratory reagent, which is what turned elements-only
   picks from acetonitrile into caffeine.

## The switcher (`packages/ui/src/switcher/`)

The Elements panel is replaced by a switcher: one search box, the periodic
table, and a result list. The list is deterministic and immediate, from the
104 gallery entries in memory, the same-origin 27,697-row OMol25 validation
index, and PubChem name autocomplete after two characters. Enter or a click
swaps the structure in place and the panel stays open.

Elements are chips, ordered by how many switchable structures contain each
one, with the long tail behind a single "more" toggle. The periodic-table
grid that shipped first was removed on 2026-09-20: an 18-column grid of
touch targets never fit a side panel or a phone, and the same decision
removed it from the Library's OMol25 facets. A typed name overrides the
element filter, so "water" with carbon and nitrogen selected still means
water. The last few switches sit at the top as chips for one-click A/B
comparison.

Jev re-orders the list a moment later as described above. The judgment is
labeled inference on screen, per the ownership contract, and never replaces
a result the index did not find.

What leaves the browser: the typed query, the selected elements, the current
file name, and the candidate titles and formulas. No account identifiers.

## Tuning

Thresholds live in `packages/ui/src/switcher/judgeSwitch.ts`. Change them
from the `lupi_jev` log lines: plot best-pick confidence against whether the
user then opened that pick (the `molecule_loaded` event that follows). Start
conservative; a wrong promotion costs one extra keystroke, a wrong demotion
costs nothing.
