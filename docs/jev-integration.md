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

## The switcher (`packages/ui/src/switcher/`)

The Elements panel is replaced by a switcher: one search box, the periodic
table, and a result list. The list is deterministic and immediate, from the
104 gallery entries in memory, the same-origin 27,697-row OMol25 validation
index, and PubChem name autocomplete after two characters. Enter or a click
swaps the structure in place and the panel stays open.

Jev re-orders that list a moment later. A best pick at confidence 0.6 or
higher moves to the top with a "Best guess" badge and the status line says
"best guess by Jev (inferred)"; below that it is a hint only. Per-candidate
fit sorts the remainder. The judgment is labeled inference on screen, per the
ownership contract, and never replaces a result the index did not find.

What leaves the browser: the typed query, the selected elements, the current
file name, and the candidate titles and formulas. No account identifiers.

## Tuning

Thresholds live in `packages/ui/src/switcher/judgeSwitch.ts`. Change them
from the `lupi_jev` log lines: plot best-pick confidence against whether the
user then opened that pick (the `molecule_loaded` event that follows). Start
conservative; a wrong promotion costs one extra keystroke, a wrong demotion
costs nothing.
