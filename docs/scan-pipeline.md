# Scan pipeline: photo → molecules

Status: implemented 2026-09-22. Route `POST /v1/scan/identify` on the
Cloudflare edge, page `/scan` in the web app.

Point a camera at something and Lupi says what it is made of, molecule by
molecule, then opens those molecules in 3D. The person sees one thing: a
swirl over their photo that materializes into cards. Underneath there are
three APIs and one gallery.

## The path

1. **Browser.** The photo is downscaled on the device to a JPEG no larger
   than 1024 px on its long edge (`packages/ui/src/scan/identify.ts`). That
   is all vision needs and it keeps the upload under about 200 KB. The
   request carries the base64 image, an optional typed hint, and the gallery
   pool: every directly openable gallery molecule as `{ key, title, formula,
   elements, atoms, source }`, the same candidate shape the molecule
   switcher sends to `/v1/switch/judge`.
2. **Vision (Claude).** The Worker sends the photo to Claude through the
   official SDK with a JSON schema on the output
   (`apps/mcp-worker/src/scan.ts`). The answer is a structured
   identification: the subject with a confidence and a short likelihood
   distribution over what it could be, up to four materials with rough
   shares, up to four molecules per material with a formula and a
   few-word role, the dominant elements, and one playful headline. Effort
   is `low` so the answer lands in a few seconds; the server-side refusal
   fallback is on so a policy decline never turns into a blank screen. A
   response that is not valid JSON in that shape is rejected.
3. **Matching.** The Worker matches Claude's molecules to the gallery pool by
   normalized title, then by formula, with a short alias table (salt,
   sugar, H2O, buckyball, ...). Every match can open instantly.
4. **Jev (TypeSafe System One).** The identification becomes the "query"
   of a switch judgment over the whole pool, through the same code the
   molecule switcher uses (`buildSwitchQuestions`, `buildSwitchState`,
   `mapSwitchAnswers` in `jev.ts`): one `best` Choice over every candidate
   plus `none`, an `intent` Choice, and one `fit` Noul per matched
   candidate (at most 24). Jev's `best` is shown as "open this first"
   with its confidence, labeled inferred. Jev never adds a molecule the
   pool does not have; it only ranks.
5. **Browser.** Each molecule card opens in 3D: a gallery match through
   `openMolecule({ kind: 'gallery' })`, anything else through PubChem by
   name (`openPubChemMolecule`), so a molecule Claude named that the gallery
   lacks still opens. That is how the scanner pulls in more molecules than
   the 104 in the gallery.

## The gist stage: a shape, fast, and Jev sculpting it

A second, smaller call runs alongside the identification so a shape and a
label land first. `POST /v1/scan/gist` asks Claude for the geometric
essence of the photo as a handful of blended signed-distance primitives
(`packages/core/src/gist/`): sphere, ellipsoid, box, cylinder, capsule,
cone, torus, each with a centre, a size, a rotation, a blend radius, and a
subtract flag, plus a label, a confidence, and two colours. At most twelve
primitives, the first one the body. The vocabulary is small on purpose: the
model writes one in a few hundred tokens, a compute shader evaluates it in a
few dozen instructions, and Jev can judge a described edit to it in one
call.

On screen (`packages/ui/src/scan/gist/`), twelve thousand particles whirl
over the photo from the moment it is picked. When the gist arrives they
flow onto its surface and stay there, shimmering, while the camera orbits
and the photo fades behind them. The label sits on top with the confidence,
marked inferred. `gist-step.wgsl` is the vgpu compute kernel (a spring onto
the surface, a weak pull toward each particle's own anchor direction so the
poles fill in, a little shimmer); `gist-points.wgsl` draws the particles as
soft discs; `gistEngine.ts` owns the buffers and the orbit and is
runtime-neutral, so the same code runs headless (below). The vertex stage
reads the particle storage buffer, which needs
`maxStorageBuffersInVertexStage: 1` from the adapter; one that cannot grant
it falls back to the fragment-only swirl, then to CSS.

Then the fast loop. `POST /v1/scan/sculpt` takes the subject and the current
gist, describes the shape in words (`describeGist`), lists the sculpting
moves that apply to it (`applicableMoves`: flatten, stretch, widen, slim,
soften or sharpen the joins, add a stem, a handle, a base, a dimple, hollow
it, remove the last part), and asks Jev two questions in one System One
call: a Choice over those moves plus `keep`, and a Noul for how much the
shape reads as the subject. The browser (`sculptLoop.ts`) fires one every
120 ms with two in flight, applies a chosen move at 0.45 confidence or above
(`applyMove`, the same shared code), and asks again about the new shape. A
judgment made against a shape that has since changed is dropped. The loop
stops after two `keep`s at 0.6 or above, 24 calls, or 6 seconds, whichever
comes first. Each applied move rewrites the primitive buffer, so the
particles re-flow: the shape visibly morphs as Jev decides. The label shows
the latest likeness and the judgment count; "Under the hood" lists every
judgment with its move, confidence, likeness, and latency.

The sculpt route has no cache (every call is a new shape) and a 1.2 second
deadline with no retry: the next call is already on its way. Cost is one
Jev judgment per call, about $0.0004; a full loop is a cent or two. Without
`TYPESAFE_API_KEY` the route answers `{ configured: false }` and the loop
stops after its first call.

`/scan?demo=apple` (also `screw`, `mug`) runs the stage on a hand-built gist
with no photo and no keys, which is the quickest way to see the particles
find a shape. With the Jev key set, the demo gist gets sculpted too.

### Seeing the stage without a browser

`packages/ui/tools/gist-headless.mts` runs the engine on vgpu's portable software
renderer, settles a demo gist, applies one move, and writes frames and
particle statistics:

```bash
pnpm --filter @atlas/ui exec vgpu install-software-renderer   # once
pnpm scan:gist:headless -- apple
# .verify-artifacts/gist-apple-{swirl,settled,moved}.png
```

Mean glow near 0.8 means most particles sit on the surface; the settled
apple, screw, and mug frames were checked this way on 2026-09-22. The same
renderer lets `vgpu check` validate the WGSL against a real device
(`VGPU_VALIDATE=require`).

## The swirl

`packages/ui/src/scan/scan-swirl.wgsl` is a vgpu fullscreen effect
(`swirl.ts`): a spiral of specks over the darkened photo while the edge is
looking, tightening and fading as the answer materializes. It uses the same
`init` / `effect` / `surface` / `frame` calls as the action light, validates
one submitted frame before the page trusts it, and stops its own loop once
nothing is left to draw. Without WebGPU, or with reduced motion, a CSS
conic-gradient ring stands in and the page is the same.

## Keys

Both keys live only on the Worker. The browser never holds either.

```bash
cd apps/mcp-worker
npx -y wrangler@4.110.0 secret put ANTHROPIC_API_KEY   # vision
npx -y wrangler@4.110.0 secret put TYPESAFE_API_KEY    # Jev (docs/jev-integration.md)
```

Locally both go in `apps/mcp-worker/.dev.vars`; the Vite dev server proxies
`/v1/scan` (identify, gist, and sculpt) to `wrangler dev` like `/v1/switch`. Optional: `ANTHROPIC_API_BASE`
(a gateway) and `ANTHROPIC_VISION_MODEL` (default `claude-opus-5`).

`/health` reports the state without revealing anything:

```bash
curl -s https://lupi.live/health | jq .scan
# { "configured": true, "routes": ["/v1/scan/identify", "/v1/scan/gist", "/v1/scan/sculpt"], "vision": "claude-opus-5", "jev": true }
```

Without `ANTHROPIC_API_KEY` the route answers `{ "configured": false }` and
the page says the scanner is not switched on. Without `TYPESAFE_API_KEY` the
vision answer still comes back and `jev` is `null`.

## Request and response

```json
{
  "image": { "mediaType": "image/jpeg", "data": "<base64>" },
  "hint": "it's a candle",
  "candidates": [{ "key": "gallery:water", "title": "Water", "formula": "H2O", "elements": ["H","O"], "atoms": 3, "source": "gallery" }]
}
```

At most 6 MB, 160 candidates, 200 hint characters. Media types: JPEG, PNG,
WebP, GIF.

```json
{
  "configured": true,
  "model": { "vision": "claude-opus-5", "jev": "jev-1.13.0" },
  "identification": {
    "subject": "A carton of eggs",
    "confidence": 0.94,
    "guesses": [{ "label": "chicken eggs", "probability": 0.9 }, { "label": "duck eggs", "probability": 0.07 }],
    "headline": "Mostly water wearing a calcium carbonate helmet.",
    "materials": [
      { "name": "Egg white", "share": 0.58, "summary": "...", "molecules": [{ "name": "Water", "formula": "H2O", "role": "about 90% of the white", "share": 0.9 }] }
    ],
    "elements": ["O", "H", "C", "N", "Ca"],
    "nothingToScan": false
  },
  "matches": [{ "molecule": { "name": "Water", "formula": "H2O", "material": "Egg white" }, "key": "gallery:water", "title": "Water", "source": "gallery", "matchedBy": "title" }],
  "jev": { "best": { "key": "gallery:water", "confidence": 0.91 }, "fit": { "gallery:water": 0.98 }, "intent": { "choice": "class_or_property", "confidence": 0.7 } },
  "timing": { "visionMs": 3100, "jevMs": 290, "totalMs": 3400 },
  "cached": false
}
```

`POST /v1/scan/gist` takes the same `image` and `hint` and answers
`{ configured, model, gist, timing: { ms } }`. `POST /v1/scan/sculpt` takes
`{ subject, gist }` (at most 16 KB) and answers
`{ configured, model, move: { id, confidence, probabilities }, likeness, moves, timing }`.

Errors return the status with an `error` and a `reason`
(`timeout`, `rate-limited`, `declined`, `invalid-response`, `network`,
`http-<status>`). The page shows the message and offers a retry.

## What is logged

One aggregate `lupi_scan` line per call: models, whether the fallback
served, candidate and match counts, confidence, token usage, the two
latencies. Never the image, the hint, the subject, or any molecule name.
Jev failures log under `lupi_jev` with `route: "scan"`.

The edge cache is keyed on a SHA-256 of the image bytes, the lowercased
hint, the candidate keys, the model, and `SCAN_PROMPT_VERSION`; it holds an
answer for an hour. Bump `SCAN_PROMPT_VERSION` when the instructions or the
schema change.

## The page (`/scan`)

- The stage first: particles whirl over the photo, take the gist's shape
  when it lands (usually before the molecules), and keep morphing while
  Jev sculpts. The label on the stage is the gist's, with its confidence,
  Jev's likeness, and the judgment count.

- Take a photo (`capture="environment"` on phones), choose an image, drop
  one, or paste one. An optional hint travels with it.
- While scanning: the photo dims, the swirl runs, a status line cycles with
  an elapsed-time counter.
- Done: the subject with its confidence chip, the headline, the other
  guesses as bars, the dominant elements, Jev's pick as a card, the
  materials with share bars and one button per molecule ("Open in 3D" for
  gallery matches, "PubChem" for the rest, with Jev's fit where it was
  asked). "Not X? Tell it what it is" rescans the same photo with a hint.
- "Under the hood" is the dev interface: models, per-hop latency, cache
  status, gallery matches, photo size, and the raw response.

Every number that came from a model is labeled inferred, per the ownership
contract. Nothing about the page depends on WebGPU.

## Tuning

- Speed: `effort: 'low'` and `VISION_MAX_TOKENS` in `scan.ts` are the two
  levers on the vision hop. The schema is tight on purpose; loosening it
  costs seconds.
- Jev thresholds: the page shows `best` at 0.3 and above; the switcher's
  0.6 promotion rule (`judgeSwitch.ts`) is a reasonable next step once
  `lupi_scan` lines show how often a person opens the pick.
- Aliases: `NAME_ALIASES` in `scan.ts` maps the names people and models use
  to gallery titles. Add to it from the `matched` count in the logs.
