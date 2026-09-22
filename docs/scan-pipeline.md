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

On screen (`packages/ui/src/scan/gist/`), sixty thousand particles whirl
over the photo from the moment it is picked (`pickParticleCount`: 120k on
a desktop with twelve or more cores, 30k on phones and low-power devices,
`?particles=N` to override up to 400k). When the gist arrives they
flow onto its surface and stay there, shimmering, while the camera orbits
and the photo fades behind them. The label sits on top with the confidence,
marked inferred. `gist-step.wgsl` is the vgpu compute kernel (a spring onto
the surface, a weak pull toward each particle's own anchor direction so the
poles fill in, a little shimmer; it keeps the surface normal it found);
`gist-points.wgsl` draws the particles as small perspective-correct discs,
airy and faint while whirling, then a shaded skin once settled: a key light
that rides with the camera, a rim in the accent colour, a per-particle hue
nudge, and a firmer disc edge so neighbours tile like a splat at rest; `gistEngine.ts` owns the buffers and the orbit and is
runtime-neutral, so the same code runs headless (below). The vertex stage
reads the particle storage buffer, which needs
`maxStorageBuffersInVertexStage: 1` from the adapter; one that cannot grant
it falls back to the fragment-only swirl, then to CSS.

The photo reaches Jev as numbers, not vibes. The gist call also traces the
object's outline in the picture (8 to 20 points, image fractions).
`outlineProfile` turns that polygon into a width-per-height profile: twelve
bands from the top of the object to the bottom, each the silhouette's width
as a fraction of its height. `gistProfile` computes the same profile from
the primitives on the CPU, with the same distance functions the shader
uses. Two things follow. First, the free move: `fitProportions` scales the
body sideways so the gist's aspect matches the photo's before Jev is asked
anything (in the smoke run it took an apple body from 0.90 to 0.67 wide and
the mismatch from 0.45 to 0.09). Second, every sculpt judgment carries
`photo_profile`, `shape_profile`, and their mismatch in Jev's state, so
"flatten" versus "stretch" is a measured call and Jev's judgment goes to
the semantic moves: whether the subject wants a stem, a handle, a hollow.
"Under the hood" shows both profiles and the mismatch per judgment.

Then the fast loop. `POST /v1/scan/sculpt` takes the subject, the current
gist, and the photo profile, describes the shape in words (`describeGist`), lists the sculpting
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

### Three more ways in (2026-09-22, later)

The vocabulary was the ceiling, so three different attacks on it:

- **The profile is the body.** For anything roughly the same all the way
  around its axis (the gist call now says `revolved`), the photo's outline
  is turned directly into a `lathe` primitive: twelve radii, top to
  bottom, the exact silhouette the camera saw. `outlineBodyProfile` takes
  the shorter half-width at each band around the object's axis, so a
  handle or a spout on one side is left out of the body and comes back as
  a part. On the mug outline that put likeness at 0.62 before a single
  judgment and 0.83 after Jev added the handle, with no proportion moves
  needed. The handle itself is now sized from where the photo bulges past
  the body (`protrusion` in `moves.ts`), which is what stopped the mismatch
  jumping when a part lands.
- **The photo dissolves into the shape.** Particles are born as the photo:
  a flat sheet of its pixels facing the camera, each particle carrying its
  pixel's colour, then the swirl takes the sheet apart and the pieces flow
  onto the shape still wearing those colours. An on-device object mask
  (`photoMask`: the border's median colour is the background, far-from-it
  pixels are the object) keeps the table and the wall from muddying the
  skin: background particles fade toward the palette. No model involved.
- **A bend.** The `arc` primitive (a tube bent along a circle) and the
  `bend` move turn a cylinder, capsule, ellipsoid, or cone into a banana,
  a horn, a hook; the vision call can write arcs directly.

One more experiment did not make the cut. A `nouls` sculpt mode asks one
Noul per move ("this edit would make it read more like the subject") in a
single call instead of a Choice. It is decisive (0.7 to 0.8 every time) but
not calibrated: it said yes to widening a cylinder-apple seven times in a
row until the body was 1.6 wide. The Choice mode's answers track likeness;
the mode stays available on the route (`mode: "nouls"`) and the bench
(`--mode=nouls`) for further tuning, and `choice` is the default.

`/scan?demo=vase` shows a lathe body, `?demo=banana` an arc.

### What the live model showed (2026-09-22)

The loop was run against the live Jev from Node (`pnpm scan:sculpt:bench`)
starting from deliberately wrong shapes, with and without a measured
profile. Median latency was about 150 ms per judgment, 300 ms for the
first. The findings shaped the decision rule in
`packages/core/src/gist/policy.ts`:

| Start | Subject | Profile | Calls | Path | Likeness |
|---|---|---|---:|---|---:|
| sphere | coffee mug | none | 3 | add-handle, keep, keep | 0.11 → 0.86 |
| cylinder | apple | none | 13 | flatten ×2, add-stem, dimple, soften | 0.15 → 0.83 |
| cylinder | coffee mug | measured | 9 | taper, add-handle, slim ×2, then settled | 0.33 → 0.81 |
| box | wine bottle | measured | 5 | add-neck (double step), slim, then settled | 0.14 → 0.51 |
| cylinder | wood screw | measured | 14 | taper, slim ×3, add-cap, then settled | 0.25 → 0.77 |
| sphere | banana | none | 3 | add-stem, stretch, keep | 0.10 → 0.85 |
| sphere | mushroom | none | 3 | add-cap (0.91), keep, keep | 0.23 → 0.83 |

1. **Jev picks the right move from the first call, at low confidence.** A
   twelve-way Choice spreads probability, so the winner sits at 0.25 to
   0.40 even when it wins every call; a 0.45 confidence gate wasted ten
   calls on the cylinder-apple. A move now applies when it is confident
   or when it collects two votes for the current shape, consecutive or
   not ("cap, slim, cap" lands the cap).
2. **Likeness is well calibrated** and is the number to show: 0.11 before
   a handle, 0.84 after; 0.92 for the hand-built apple. `keep` twice in a
   row, or once at a likeness of 0.85, ends the loop.
3. **Measured profiles do what they should.** With a profile, the loop
   widens or slims until the mismatch is small, then switches to parts;
   a mismatch above 0.3 doubles a proportion step so a box becomes a
   bottle in one move. Below 0.12 a proportion vote is damped (the step
   is coarser than the error left) and three damped votes in a row end
   the loop.
4. **The vocabulary decides the ceiling.** The bottle stalled at 0.51
   because a box body is not a bottle, and the banana wanted a bend. The
   `round`, `taper`, `add-neck`, and `add-cap` moves came out of these runs;
   a sphere body now becomes an ellipsoid before a proportion move so it
   stops shrinking under "stretch".
5. **A near tie is an answer.** About one call in fourteen named a choice
   a hundredth below the leading probability; the shared client now allows
   a 0.05 margin instead of rejecting the reply.

The sculpt route has no cache (every call is a new shape) and a 1.2 second
deadline with no retry: the next call is already on its way. Cost is one
Jev judgment per call, about $0.0004; a full loop is a cent or two. Without
`TYPESAFE_API_KEY` the route answers `{ configured: false }` and the loop
stops after its first call.

`/scan?demo=apple` (also `screw`, `mug`, `vase`, `banana`) runs the stage on a hand-built gist
with no photo and no keys, which is the quickest way to see the particles
find a shape. With the Jev key set, the demo gist gets sculpted too.

### Sculpting against the real Jev from Node

`pnpm scan:sculpt:bench -- apple --calls=12` runs the loop through the
same edge handler the browser uses, with `TYPESAFE_API_KEY` from the
environment or `apps/mcp-worker/.dev.vars`, applying moves the way the
browser does and printing each judgment's move, confidence, likeness,
mismatch, and latency. Pass `--profile=0.3,0.3,...` to supply a photo
profile by hand. The key is never printed.

### Seeing the stage without a browser

`packages/ui/tools/gist-headless.mts` runs the engine on vgpu's portable software
renderer, settles a demo gist, applies one move, and writes frames and
particle statistics:

```bash
pnpm --filter @atlas/ui exec vgpu install-software-renderer   # once
pnpm scan:gist:headless -- apple --particles=60000
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
