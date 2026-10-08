# AGENTS.md — Operating Lupi via MCP

> This file is for autonomous agents (Claude, Cursor, Kimi, etc.) that need to request molecule assets or inspect/debug the Lupi molecular viewer without clicking the UI.

## Choose the path by outcome

Use the Cloudflare edge Worker for agent-native discovery, strict
`RenderRequestV1` validation, and legacy-v0 compatibility. Use the browser
bridge when you need actual V1 PNG/JPEG/WebP/GLB bytes or visual QA: the
current edge V1 profile validates opaque PNG atom requests but deliberately has
no executor. The Worker lives in `apps/mcp-worker` and serves the web app and
MCP JSON-RPC over HTTP:

```bash
pnpm cloudflare:build
pnpm cloudflare:test
pnpm cloudflare:dev
```

Core endpoints:

- `GET /` — built Lupi web app from Workers static assets
- `GET /view/:slug` — saved-view social/share HTML; a view of a gallery
  molecule unfurls with that molecule's ink card (`/og/m/<id>.png`, matched
  through `/m/manifest.json`)
- `GET /play?sim=<id>…` — the shareable form of a viewer link (Instant
  Replay, Remix): link-preview robots get the molecule's ink-card unfurl,
  people are redirected to `/?…` (`/` itself stays asset-first)
- `GET /m/:id`, `GET /m/` — zero-canvas molecule pages and their index, static
  HTML written by the web build (`scripts/generate-molecule-pages.mts`) with
  per-molecule Open Graph cards (`/og/m/<id>.png`), ink drawings
  (`/og/m/<id>-ink.svg`) and desk models (`/ar/<id>.usdz`, `/ar/<id>.glb`);
  `/m/manifest.json` also gives each drawing's opening `pose`, `inkRadius`
  and the viewer's `fit` radius (the landing's ink tiles hand over with them)
- `GET /daily/`, `GET /daily/:date`, `GET /daily/text` — Lupi Daily, the
  zero-canvas mystery-molecule game (static HTML written by the web build,
  `scripts/generate-daily-pages.mts`), with sealed puzzle files
  (`/daily/p/<token>.json`), the guess pool and per-day silhouette cards
  (`/og/daily/<date>.jpg`) that never name the answer (see `docs/daily.md`)
- `GET /scale` — the scale page: the salt ladder from one ion to a
  googolplex, copper's billion and the twelve diamondoids, drawn from
  LupiScale records by the TypeScript reference (`packages/ui/src/scale`,
  `docs/ar/scale-spec.md` §11.2) with exact counts; `?e=<entry>` opens an
  entry and `?ref=lsr1:…` a shared piece. A static SEO shell like `/scan`,
  no Worker route
- `POST /collectAnalytics` — first-party analytics edge collector
- `GET /__/auth/*` — Firebase Auth reserved-path proxy for popup sign-in
- `POST /mcp` — MCP JSON-RPC (`initialize`, `tools/list`, `tools/call`)
- `GET /health` — service and binding readiness
- `GET /mcp-manifest.json` — seven-tool Cloudflare edge control-plane manifest
- `GET /browser-mcp-manifest.json` — 31-tool browser viewer manifest
- `POST /v1/render` — REST shortcut for `lupi.render_molecule_asset`
- `POST /v1/switch/judge`, `POST /v1/viewer/command` — Jev (TypeSafe) judgments for the molecule switcher and the command palette; with `rank: true` the switch judgment also reads property questions ("floats in water", "heaviest metal") for code to rank by measured values; `{ configured: false }` without `TYPESAFE_API_KEY` (see `docs/jev-integration.md`, `docs/jev-property-ranking.md`)
- `POST /v1/scan/identify` — photo → molecules: a Hugging Face vision model (Inference Providers, `HF_TOKEN`) identifies the subject and its materials, Jev ranks the gallery pool; `{ configured: false }` without `HF_TOKEN` (see `docs/scan-pipeline.md`)
- `POST /v1/scan/gist`, `POST /v1/scan/sculpt`, `POST /v1/scan/recipe` — photo → a label and outline (or `{ text }` alone → the gist of the thing named, for the molecule search's stage, where the particles form "candy" while the results come in), one Jev sculpting judgment per call for the primitive fallback, and Jev's recipe (does this measured silhouette read as the subject; inflate, extrude, or revolve; how deep) for the photo's own inflated volume
- `POST /v1/scan/plan`, `POST /v1/scan/segment`, `POST /v1/scan/reconstruct` — the remote models through Hugging Face Spaces, with the token on the edge: Jev's plan (is the device's cut good enough, is a 3D rebuild worth the wait, given what is running), SAM 3's concept mask for the subject, and SAM 3D Objects' reconstruction sampled into `lupi.points.v1` (coloured points, ~700 kB) for the particles; `{ configured: false }` without `HF_TOKEN` (see `docs/scan-pipeline.md`)
- `GET /v1/datasets/omol25`, `GET /v1/datasets/omol25/:collection/rows`,
  `GET /v1/datasets/omol25/:collection/structures/:row.xyz` — OMol25 through
  the edge, paged from Hugging Face on demand: coverage and citation, compact
  rows (with `charge`, `spinMultiplicity`, `chargeSource`, `domain`,
  `homoLumoGapEv`), and one source row as XYZ whose comment carries charge,
  multiplicity and their provenance (headers `x-lupi-bond-topology:
  not-provided`, `x-lupi-charge-provenance`, `x-lupi-bond-inference:
  lupi-bonds.molecular.v1`; see `docs/external-science-data.md`)
- `GET /datasets/omol25/featured.v1.json` — the 24 hand-picked
  neutral-validation rows Lupi keeps (schema `lupi.omol25-featured.v1`, CC BY
  4.0, sha256 per file), each at `/datasets/omol25/featured/omol25_nv_<row>.xyz`
- `GET /og/omol25/omol25_nv_<row>-ink.svg`, `-ink.json` — the picks' ink
  drawings and models, written by the web build
  (`scripts/omol25-picks/build.mts`) from the same `lupi-bonds.molecular.v1`
  graph the viewer draws (coordination dashed, ionic contacts dotted, InkModel
  `bk`); the home shelf, finder, switcher and Library tiles show them, and
  `/omol25` opens `/library/omol25`
- `GET /v1/jobs/:jobId` — legacy-v0 render-job compatibility
- `GET /assets/:assetId.:ext` — legacy-v0 R2 asset compatibility

The Worker is intentionally browser-free. Its strict
`lupi.render-request.v1` path returns `awaiting_renderer`, even if legacy
renderer bindings exist, and withholds renderer fingerprint, `artifactKey`,
job/cache/asset identities, and bytes. The separate `legacy-v0` path preserves
the existing queue/HTTP/R2/D1 behavior for compatibility, but its `assetId` and
hash fields are not V1 identities. Plan 026 owns activating an authenticated V1
renderer and retrieval path.

See `docs/cloudflare-migration.md` for the whole-app cutover and
`docs/cloudflare-mcp.md` for MCP setup, bindings, example `curl`, and renderer
backend contract.

## Native Apple app (apps/apple)

`apps/apple` is the native SwiftUI + RealityKit AR app for iPhone Pro and
iPad Pro (bundle id `live.lupi.app`, iOS 26.0): a physics sandbox whose
building blocks are molecules, played against the room's LiDAR mesh. It
replaces the Expo app, and `apps/mobile` is frozen as a reference. It has no
MCP bridge. Its pure-Swift logic lives in four packages that build and test on
Linux (`swift build`, `swift test`); the app itself (`apps/apple/Lupi`)
compiles only on a macOS runner with Xcode, so never claim device behaviour
from a Linux session.

- **`LupiKit`**: elements, XYZ, both bond recipes, inertia, felt mass, the
  throw estimator, juice and synthesized sound (four families tuned per
  personality, `SoundTuning`), the drawn flop, personalities to
  `lupi.personality.rules.v1` with plaque reasons; building from atoms
  (`LupiChem/Build`: snap geometry, `Snapper`, `HydrogenFill`,
  `MolecularGraph`); `LupiData`: the bundled starters, `KnownMolecules` (what
  a built molecule is named after), `lupi.trophy.v1` and `lupi.shelf.v1`.
- **`LupiScale`**: the scale spine of `docs/ar/scale-spec.md` (records,
  paths, Magnitude, packs, `lupi.scale-ref.v1`, frames, the cut, proxies,
  breaks), byte for byte with the TypeScript reference in
  `packages/core/src/scale`.
- **`LupiGame`**: the play session, tested headless against `LupiGameSim`:
  spawn, grab, throw, pinch and breaks (M0); keeping, the Collection and
  shelves (M1); the atom tray, the snap magnet, Fill H and "Built it" (M2);
  the scale content from the bundled pack (the salt ladder to a googolplex,
  copper, diamond, the diamondoids), flight, Life size, Grow ×2, chunks,
  chips and terrain colliders (M3a); the flop, the cage ring, VoiceOver
  descriptions, the thermal policy and the first-run card (M4).
- **`LupiCloud`**: the Lupi account, Firebase Auth and Firestore over REST.

M0–M2, M3a and M4 (plan §8) are built; M3b (LupiEngine) is not started.
Nothing has been compiled against Apple's SDK or run on a device:
`docs/ar/status.md` is the owner's checklist (build on the Mac, the spikes
and exits on the device, the decisions waiting) and lists where the first
compile will most likely fail; `apps/apple/README.md` is the how-to.

The Linux gates: `swift test` in every package, and `swift test -c release`
in LupiScale (its 8 ms `buildCut` gate counts only in release) and LupiGame
(its directive tests time frames); `tools/apple/parse-app.sh` (syntax);
`tools/apple/typecheck-app.sh`, which type-checks the app against the
packages' real modules and stand-ins for Apple's frameworks spelled as Apple
documents them (`tools/apple/standin`; add a new Apple API there from its
documentation page); and `pnpm apple:check`, which fails when the Swift generated from the web's
TypeScript (`tools/apple/*.mts`: elements, bond fixtures, the bond validation
sample, edge samples, starters, the known-molecule index, scale fixtures) is
stale. The web counterpart of the scale play is `/scale`
(`packages/ui/src/scale`).

The owner's decisions are `docs/ar/decisions.md`, the plan of record is
`docs/ar/plan.md`, and the data contracts it shares with lupi.live are in
`docs/ar/contracts.md`; `docs/ar/README.md` indexes the folder.

## Browser execution and visual QA

Use the browser bridge for current artifact execution, visual QA, local viewer
debugging, or eventual comparison with a real edge/backend output. Do not claim
edge/browser artifact parity while edge V1 remains validation-only.

The viewer renders through three's `WebGPURenderer` (three r186, React Three
Fiber v10): on the WebGPU backend when the browser has an adapter, on its
WebGL2 backend otherwise, or when the URL carries `?renderer=webgl2`.
`status().rendererBackend` says which one is running. The canvas DPR follows
the device up to a cap that shrinks for big structures (`viewerDprRange`:
phones up to 3 and desktops up to 2 below 50k atoms; phones 1.5 up to 400k
atoms and 1.25 above, low-power devices 1.25 from 50k, desktops 1.5 above
400k; a phone on the WebGL2 backend stays at 2 at most). The budget uses the
file's atom count, held once a frame is resident, so playback never resizes
the canvas. The post pipeline
ends with FXAA on the display-referred image. That FXAA pass is the only
anti-aliasing the impostor silhouettes get in the live view, on both backends
and every preset. The Chromium flags for
both local lanes live in `tools/lib/browser-lanes.mjs` (`LANE_ARGS.webgpu`,
`LANE_ARGS.webgl2`); headless WebGPU on SwiftShader needs the whole
`webgpu` set, or the device is lost within a few frames.

### Viewer camera and play

- **The Lupi camera rig replaces drei's OrbitControls in the viewer**
  (`packages/ui/src/camera`). A drag turns 1:1, a flick coasts on the
  molecule's inertia and clicks into a symmetry face (C60: "Pentagon face-on ·
  5-fold axis"), a tap during a coast catches it, a tap picks an atom without
  moving the camera, and a double-tap glides to it. `?controls=orbit` brings
  the old OrbitControls back for this wave as an escape hatch.
- **The store camera is written at rest.** `cameraPosition`, `cameraTarget`
  and `cameraPreset` are written once, when the rig comes to rest, never per
  frame. Anything else that moves the camera (MCP, CameraManager snaps, saved
  views, flythrough, video) is adopted by the rig at once. Share URLs and
  saved views therefore hold the settled, level pose.
- **MCP camera tools stay instant.** `lupi.set_camera`,
  `lupi.set_camera_preset` and `lupi.fit_camera` land on the call, with no
  glide or coast. Only UI gestures, presets and Recenter animate.
- **The phone atom card makes room.** On a phone the atom card opens as a
  compact sheet under the header (identity and one line of facts; Details
  opens the full card for the session), and the live view eases down (a
  projection view offset, `packages/ui/src/camera/ViewInsetDriver.tsx`) so
  the molecule centres in the band between the card and the Play pill.
  Motion: Still cuts it, and closing the card eases it back. It is display
  only: the store pose, saved views, share URLs, the axes gizmo, picking (it
  raycasts what is drawn) and every capture (exports, thumbnails, MCP, video)
  never see it. `__lupiPlay.viewInset()` reports `{ current, target, occluder }`.
- **`window.__lupiPlay`** is the Play layer's handle for smoke plugins and
  agents (installed in production, like `__lupiViewerMcp`): `state()` returns
  `{ verb, trayOpen, displaced, flash, comfort, rig, motion, firstFrame,
  frames, frameDemand }`,
  `emit(intent)` emits a Lupi intent as the UI would, `reset()` puts display
  motion at rest, and `poke`, `flick`, `catch`, `scatter`, `stepDetent`,
  `burst(atomIndex)`, `tug(atomIndex, [dx, dy, dz], holdMs)`,
  `heat(level)`, `replay()` and `remix()` appear once the viewer has
  registered them; `ink()` reports the Illustrate look's live weights and
  Ink-to-Light state. It never writes molecule data.
- **The Illustrate look (Ink and Light).** Looks → Illustrate (flat colour on
  the sage plate) or Sketch (hatched, on the paper plate), the Play tray's
  Look row (Lit · Ink · Remix ⟳), the palette or the `I` key draw the molecule like the
  Lupi ink drawings: toon fills from the key light, crevices shaded by the
  baked contact occlusion, an ink outline at every atom and bond silhouette
  and, for Sketch, pen hatching (`packages/scene/src/tsl/inkLook.ts`, mixed
  into both impostors by one weight). It is a Look, not toy motion: the
  store's `inkStyle` (`off`, `flat`, `hatch`) and `inkWeight` ride share URLs
  (`ink`, `iw` in the `s=` state), saved views and `lupi.set_viewer`, and
  replay and Remix links add a top-level `ink=f|h`; a Foil finish steps
  aside under ink (a drawing carries no foil); while ink is on the post
  recipe steps aside (no AO, glow, defocus, vignette or tone mapping; FXAA
  stays); exports draw it and their spec records `view.ink`. Changes fade
  (480 ms); every capture renders the configured look, never a fade.
  Ink-to-Light: a molecule opened from an ink drawing (the hero, a molecule
  page, an ink tile on the wall or in the finder) first draws in ink at the
  drawing's pose, then the light comes on; any touch completes it and Still
  skips it. See `docs/ink-and-light.md`.
- **One-finger verbs** (Play tray, palette): Orbit, Poke, Tug, Burst, Heat.
  Tug drags an atom's neighbourhood on springs and twangs it home; Burst pops
  the atoms out from a tap and springs them back; Heat jiggles the atoms
  while held (the pill reads an illustrative temperature) and cools on
  release. With a verb latched, Enter plays it on the selected atom. They
  are display-only offsets in `packages/scene/src/tsl/displayMotion.ts`
  (bonds follow and thin as they stretch), labelled "Illustrative · Reset",
  halved by Gentle, off in Still, and never in an export. On desktop the
  atom under the cursor glows lime and selected atoms glow stronger
  (`tsl/atomGlow.ts`); captures and videos never carry the glow.
- **Overlays ride display motion.** Selection, hover and neighbour rings,
  annotations, atom-bound knowledge labels, measurements (line, letters,
  value label), the desktop atom card's anchor and trail heads follow their
  atoms through the arrival, pokes, Scatter, Tug, Burst and Heat, using the
  CPU twin of the GPU offset (`tsl/displayMotionTwin.ts`, every term) for
  just the atoms that carry an overlay (`packages/ui/src/play/displayFollow.tsx`,
  one job in the `lupi-overlays` phase). Text and cards take a fifth of
  Heat's jiggle so they stay readable; vector glyphs follow on the GPU. They
  snap back exactly at rest, and every capture renders them at rest (a
  capture guard), so exports, MCP artifacts, thumbnails and video keep rest
  truth; a measurement's value is always the rest value.
  `__lupiPlay.follow()` reports `{ moving, followers, displaced, points,
  maxOffset }`.
- **Quiet Idle.** The viewer canvas renders on demand: a still view draws
  no frames. Anything that changes the picture asks for frames (store writes,
  gestures, the rig, display motion, playback, flythrough, async bonds and
  environment loads, MCP commands), and animators keep the loop awake until
  they settle (`packages/scene/src/frameDemand.ts`). A drifting procedural
  background or a halo annotation draws at 24 fps; a selection ring pulses
  for 2.4 s and rests. `__lupiPlay.state().frames` counts drawn frames (read
  it twice on a still view: it should not move) and `.frameDemand.awakeBy`
  names what keeps the loop awake; `?frames=1` shows the same as a small
  meter at the top of the viewer (for a phone). `?frameloop=always` renders
  continuously again. Exports and video force their own frames.
- **Phone sheets make room for the molecule.** On a phone every panel
  (Learn, Style, Data, Camera, Export, Switch, Settings), the atom card, the
  Play tray and the Save/Account sheets declare the screen area they cover
  (`packages/ui/src/camera/viewInset.ts`), and the live view eases the
  molecule into the free area left (shifted, and shrunk to fit, never grown).
  It is a display-only projection view offset: the store camera, saved views,
  share URLs, exports, MCP artifacts, picking and the axes gizmo never see it.
  Held upright, panels are bottom sheets with Peek, Half and Full detents;
  held sideways, a column on the right. The canvas never resizes for them.
  `__lupiPlay.viewInset()` returns `{ current, target, occluders }`.
- **Instant Replay** (`packages/ui/src/replay`). The viewer keeps the last
  20 s in memory: the camera pose of every drawn frame that moved, the toy
  inputs and the pill's flashes. After a good flick, a chain of three named
  faces, Spin's flip or a toy moment, the pill offers "Replay ↗" for 7 s (R,
  the Play tray or the palette any time; with no moment it shares this view). The sheet
  has the live link at once and records a 9:16 clip through the video
  export, with "Illustrative" burned into each frame. The link adds
  `replay=<base64url tape>` (versioned binary: camera keys at a 0.5 s pose
  snapshot plus where the motion bends, toy inputs, flashes; about 0.5–1.5
  KB, nothing stored) to `sim`, `load`, `molecule` or a saved view's route.
  Opening it plays the moment in the visitor's own view (Standard on its
  own, Gentle on "▶ Watch"; any touch takes over) and ends on "Your turn".
  Still sends and opens a still pose. The viewer drops `replay=` from the
  address bar as it reads it. `__lupiPlay.replay()` returns the offered or
  last moment as `{ moment, keys, events, bytes, link }`; `replay('watch')`
  starts a waiting shared replay. Replays and clips are never artifacts:
  MCP cannot request them.
- **Remix codes and Foil** (`packages/ui/src/remix`). Every Remix is a short
  versioned code, `r1-K7QDM`: five Crockford base32 characters (keep-colours
  and worlds flags, a 23-bit seed) that the frozen r1 catalog in
  `remix/code.ts` resolves to the whole look with an integer-exact
  mulberry32 stream, so a code gives the same look on any device, molecule
  and atom count (changing the catalog means r2; r1 resolves forever). r1
  has no transmission and no adjusted gradients, so a remixed view stays
  exportable while worlds are off (the default); with worlds on, half the
  codes pick an `R1_WORLDS` backdrop (a procedural field or an image world),
  and an opaque artifact export of one fails closed like any such background
  (transparent output still works). Roll from the Play tray's Look row (it stays open), the pill's
  "⟳ Again", M (Shift+M steps back), the scene deck, the palette, or a
  shake (phones; off until turned on in the Remix sheet, iOS asks
  permission in that tap). The Remix sheet (the tray's code chip) copies,
  shares (`?remix=` on the molecule's address) and takes typed or pasted
  codes; a pasted `r1-` code or `remix=` link also applies anywhere outside
  text fields, and replay links carry the sender's code. Keep atom colours
  is on by default (CPK). Looks morph in about 600 ms (`remix/lookMorph.ts`:
  store keys tweened per frame, colours in linear light, discrete choices at
  the midpoint under a dip, gradient backdrops cross-faded on a dome); Still
  cuts. About one code in 24 is Foil, a pure function of the code text
  (`fmix32(fnv1a(code)) mod 24`): Holo, Gold leaf or Pearl, a cosmetic rim,
  highlight and sheen term in the atom and bond impostors
  (`scene/src/tsl/atomFoil.ts`), revealed by a 900 ms sweep from the
  key-light side, at published odds (Foil 1 in 24, each finish 1 in 72)
  printed in the tray and the sheet. A finish rolled once stays selectable
  on that device ("Show all finishes" unlocks all; "Off" hides one). Finishes
  are never in an export, thumbnail, MCP artifact or ordinary video (the
  capture guard zeroes them); Instant Replay's illustrative clip keeps them.
  `__lupiPlay.remix()` returns `{ code, foil, finish, status, morphing }`;
  `remix('roll')`, `remix('undo')` and `remix('r1-K7QDM')` drive it.
- **Motion comfort** (Settings or the Play tray): Standard, Gentle (no coast,
  half-strength display motion) or Still (nothing moves on its own; glides
  cut). With nothing chosen it follows `prefers-reduced-motion`. Sound and
  haptics are off by default.

## Quick Start

1. Start the dev server, or serve a production build:
   ```bash
   pnpm dev
   # or
   pnpm --filter @atlas/web dev
   # or
   pnpm --filter @atlas/web build && PORT=4173 node tools/serve-web.mjs
   ```
2. Open the viewer in a headless browser (Playwright, Puppeteer, etc.) at the root URL, e.g. `http://localhost:5173/` or `http://localhost:5173/#/mcp`. Launch Chromium with `LANE_ARGS.webgpu` or `LANE_ARGS.webgl2` from `tools/lib/browser-lanes.mjs`; WebGPU also needs a secure context (`localhost` or `127.0.0.1` count).
3. Wait until the bridge is ready:
   ```js
   await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true);
   ```
4. Execute a tool:
   ```js
   const result = await page.evaluate(() =>
     window.__lupiViewerMcp.execute({
       id: "demo-1",
       tool: "lupi.set_camera_preset",
       arguments: { preset: "iso" },
     }),
   );
   ```

## Bridge API

When the viewer loads, the page exposes a global object:

```ts
window.__lupiViewerMcp: {
  ready: true;
  version: string;
  execute(request: LupiMcpRequest): Promise<LupiMcpResponse>;
  executeBatch(requests: LupiMcpRequest[]): Promise<LupiMcpResponse[]>;
  parseCommand(command: string): LupiMcpRequest[];
  state(): LupiMcpViewerState;
  status(): LupiMcpStatus;
  tools(): Array<{ name: string; description: string; parameters?: unknown }>;
}
```

### Request shape

```ts
interface LupiMcpRequest {
  id: string; // any unique string
  tool: string; // one of the 31 lupi.* browser tools
  arguments: Record<string, unknown>;
}
```

### Response shape

```ts
interface LupiMcpResponse {
  id: string;
  tool: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  transcript: string[];
}
```

## Status / Health

Call `status()` to check readiness without executing a command:

```js
const status = await page.evaluate(() => window.__lupiViewerMcp.status());
console.log(status);
// {
//   ready: true,
//   version: '2026-09-28.asset-export',
//   rendererBackend: 'webgpu',          // or 'webgl2'; null before the canvas exists
//   webGPUSupported: true,
//   rendererExecutionClass: 'browser-webgpu-main-thread',
//   toolCount: 31,
//   moleculeLoaded: true,
//   atomCount: 250000,
//   frame: 0,
//   playing: false,
//   bondCount: 420000,                  // covalent + coordination drawn
//   bondSource: 'gpu',
//   bondTopology: 'inferred',
//   showBondsEffective: true,
//   bondRecipe: 'lupi-bonds.distance.v1', // 'lupi-bonds.molecular.v1', 'source' or null
//   bondToleranceAdjusted: false,        // bondTolerance ≠ 0.45 Å
//   bondKinds: { covalent: 420000, coordination: 0, ionicContact: 0 },
//   bondEvidence: null,                  // { long, removed, nearMiss, clashes } up to 2,000 atoms
//   chemistry: null                      // { totalCharge, spinMultiplicity, source, domain } when declared
// }
```

Poll until `ready === true` and `toolCount > 0` before sending commands, and
until `rendererBackend` is non-null before an export. The `lupi.status` tool
returns the same three renderer fields and the same bond fields.

### Bonds: which rule, and what is inferred

Lupi draws bonds by one of three rules, and every surface says which:

- **Source** pairs from the file always win (`bondRecipe: 'source'`).
- **`lupi-bonds.molecular.v1`** (`docs/omol25-bonds-and-discovery.md` §2) for
  a non-periodic XYZ frame of at most 2,000 atoms that declares chemistry
  (`charge=`, `multiplicity=` or `charge_source=` in its comment) and is a
  single frame or an OMol25 record. Covalent bonds are solid sticks,
  transition-metal coordination is dashed and thinner, and s-block ionic
  contacts (Li, Na, K, Mg, Ca, …) are dotted and thinnest, never sticks.
  OMol25 supplies no bonds; these are Lupi's inference, labelled as such in
  the legend, Learn ("How these bonds were drawn"), the atom card and here.
- **`lupi-bonds.distance.v1`** (r_i + r_j + τ) for everything else: gallery
  molecules, materials, trajectories and every non-XYZ format, unchanged.

`lupi.set_viewer { bondProfile: 'auto' | 'distance' | 'molecular' }` picks
the rule (URL `brp=d|m`; molecular still needs a non-periodic XYZ frame of
≤ 2,000 atoms) and `{ showBondContacts: false }` hides the dotted contacts
(URL `bco=0`). `bondCount` and `bondKinds` count what is drawn after hidden
atom types and the contacts toggle; ionic contacts never count as bonds.
`lupi.viewer_state { includeBonds: true }` adds `bonds: [[i, j, kind,
lengthÅ, excessÅ], …]` (kind `covalent`, `coordination` or `ionicContact`;
excess over the covalent-radius sum; at most 5,000, then `bondsTruncated:
true`) and `bondsFilter: { hiddenTypes, contacts }`, from the same graph the
view, the atom card, Object Facts and model exports read
(`packages/ui/src/bonds/perceivedBonds.ts`). Inferred graphs are listed for
frames of at most 2,000 atoms; larger frames return `bondsUnavailable`.

## Tool Manifest

A static browser-viewer JSON manifest is available at:

```
/browser-mcp-manifest.json
```

Fetch it to discover tool names, descriptions, and JSON Schemas without loading the page. It is generated from the same source files as the runtime tool registry, so it cannot drift.

```js
const manifest = await page.evaluate(() =>
  fetch("/browser-mcp-manifest.json").then((r) => r.json()),
);
```

## Tool Reference (31 tools)

| Tool                       | Description                                                                                                                      | Example arguments                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `lupi.generate_molecule`   | Load/generate a molecule by template, name, SMILES, XYZ, description, or procedural lattice.                                     | `{ inputType: 'template', input: 'Caffeine' }`            |
| `lupi.load_molecule_url`   | Load a molecule or trajectory URL.                                                                                               | `{ url: 'https://example.com/molecule.xyz' }`             |
| `lupi.open_gallery_example` | Open a canonical gallery example with caller-pinned identity and atom-count limits.                                             | `{ id: 'c60_buckyball', expectedAtomCount: 60, maxAtomCount: 50000 }` |
| `lupi.open_saved_view`     | Open a saved Lupi view by slug.                                                                                                  | `{ slug: 'abc123' }`                                      |
| `lupi.search_molecules`    | Search molecule/catalog providers; filter by library facets and sort by measured properties (see `docs/library-facts.md`).       | `{ query: '', facets: ['metal'], sortBy: 'density' }`     |
| `lupi.browse_collection`   | Page through a remote OMol25 collection via the dataset edge; returns source-coordinate load specs, no rows stored by Lupi. Each molecule carries `charge`, `spinMultiplicity`, `chargeSource`, `domain` and `homoLumoGapEv`; `sourceTruth` is `{ coordinates: 'source', bondTopology: 'not-provided', viewerBonds: { recipe: 'lupi-bonds.molecular.v1', provenance: 'inferred' } }`. | `{ collection: 'neutral-train', offset: 0, limit: 24 }`   |
| `lupi.set_viewer`          | Apply common viewer display/style settings, including the bond rule (`bondProfile`) and the ionic-contacts toggle.               | `{ showBonds: true, bondProfile: 'molecular', showBondContacts: true }` |
| `lupi.export_xyz`          | Return active frame XYZ text.                                                                                                    | `{}`                                                      |
| `lupi.export_asset`        | Return the active deterministic profile as inline PNG/JPEG/WebP or GLB; unsupported active layers/combinations fail closed.       | `{ format: 'png', width: 1024, height: 1024 }`            |
| `lupi.viewer_state`        | Return current viewer state; `includeBonds` adds the drawn bond list.                                                            | `{ includeBonds: true }`                                  |
| `lupi.assess_asset`        | Run a bounded fast assessment of materialized source data and declared context without rendering.                                | `{ source: 'active', mode: 'fast' }`                      |
| `lupi.knowledge_graph`     | Query active knowledge-graph labels.                                                                                             | `{ query: 'force', limit: 20 }`                           |
| `lupi.status`              | Report bridge readiness and viewer health.                                                                                       | `{}`                                                      |
| `lupi.set_frame`           | Jump to a trajectory frame.                                                                                                      | `{ frame: 0 }`                                            |
| `lupi.play`                | Start playback.                                                                                                                  | `{}`                                                      |
| `lupi.pause`               | Pause playback.                                                                                                                  | `{}`                                                      |
| `lupi.set_playback_speed`  | Set speed multiplier (0.0625–16).                                                                                                | `{ speed: 1.5 }`                                          |
| `lupi.set_camera_preset`   | Apply top, side, front, iso, or free.                                                                                            | `{ preset: 'iso' }`                                       |
| `lupi.set_camera`          | Set camera position/target/FOV.                                                                                                  | `{ position: [10,10,10], target: [0,0,0], fov: 45 }`      |
| `lupi.fit_camera`          | Fit camera to molecule bounds.                                                                                                   | `{}`                                                      |
| `lupi.set_background`      | Set background preset, style, motion, etc.                                                                                       | `{ preset: 'blueprint', postprocessPreset: 'diagram' }`   |
| `lupi.set_postprocess`     | Set postprocess preset/intensity.                                                                                                | `{ preset: 'studio', intensity: 0.8 }`                    |
| `lupi.set_material`        | Set material preset/scene/intensity/texture.                                                                                     | `{ preset: 'metallic', scene: 'studio', intensity: 1.0 }` |
| `lupi.set_lighting`        | Adjust ambient/dir/rim lights and angles.                                                                                        | `{ ambient: 0.6, dir: 0.8, rim: 0.4 }`                    |
| `lupi.set_filter_shell`    | Set filter shell shape/preset/opacity/radius.                                                                                    | `{ shape: 'sphere', preset: 'haze', opacity: 0.3 }`       |
| `lupi.set_vector_field`    | Set vector field layer/scale/density.                                                                                            | `{ fieldId: 'velocity', scale: 1.0, density: 0.5 }`       |
| `lupi.set_atom_visibility` | Hide atom types or scale per-type radii.                                                                                         | `{ hiddenAtomTypes: [1], atomTypeScales: { '29': 1.2 } }` |
| `lupi.add_annotation`      | Add an etched label to an atom.                                                                                                  | `{ atomIndex: 10, text: 'active site' }`                  |
| `lupi.remove_annotation`   | Remove an annotation by id.                                                                                                      | `{ id: 'abc-123' }`                                       |
| `lupi.encode_view_url`     | Serialize current state to a shareable URL.                                                                                      | `{}`                                                      |
| `lupi.reset_viewer`        | Reset viewer to defaults.                                                                                                        | `{}`                                                      |

## Natural-Language / URL API

For a fuller model-facing handoff, including UI critique and recommended integration loop, see:

```
docs/mcp-model-integration-brief.md
```

You can trigger a run without writing JSON:

- Console: `window.__lupiViewerMcp.parseCommand('generate 100k copper fcc atoms, hide bonds, show cell, iso camera')`
- URL: `http://localhost:5173/?mcpCommand=generate+100k+copper+fcc+atoms`
- URL: `http://localhost:5173/#/mcp?mcpCommand=generate+100k+copper+fcc+atoms`

Common recognized keywords:

- `generate 100k copper fcc atoms` — procedural lattice
- `hide bonds`, `show bonds`, `show cell`, `show axes`
- `studio`, `paper`, `editorial`, `cinematic`, `diagram` — postprocess presets
- `iso`, `top`, `side`, `front`, `free` — camera presets
- `ink` / `illustrate`, `hatched` / `sketch`, `lit` — the Illustrate look (flat, hatched, off)

## Render artifact V2 truth

Contract strings are unchanged and use dot-separated versions:
`lupi.render-request.v1`, `lupi.render-artifact-spec.v1`, and
`lupi.render-delivery.v1`. What changed with the WebGPURenderer port is the
renderer that executes them: the browser renderer profile is V2
(`packages/ui/src/export/exportProfileV2.ts`).

The browser candidate advertises PNG/JPEG/WebP/GLB, subject to exact format
and active-state checks. JPEG is opaque only; GLB rejects raster dimensions and
transparency.

Raster capture never reads the canvas. It renders the Three.js scene with
a copy of the artifact camera into its own HalfFloat render targets,
supersampled (no MSAA, pixel ratio 1, no renderer tone mapping), and reads the
result back asynchronously. On the CPU it de-strides WebGPU rows, flips WebGL2
rows, un-premultiplies in linear light, applies the sRGB OETF and rounds. Flat
regions therefore match the on-screen canvas, and transparent output is
straight alpha. The canvas keeps its size, and the live view does not flicker.

- Supersampling is what anti-aliases exported edges. Atoms and bonds are
  ray-cast impostors that discard outside their silhouette, and MSAA cannot
  smooth that. The scene renders at `factor` times the requested size on each
  side: 3 up to 1365 px on the longest side, 2 above, for every size up to
  4096 (the UI's 2160 px PNG included). It renders in equal tiles of at most
  4096 texels a side (one tile up to 2048 px), each with a view offset of the
  capture camera, into one reused tile target, so no target is larger than a
  4096 px side. After each tile a GPU pass box-averages every factor x factor
  block of premultiplied linear texels into the tile's rectangle of an
  output-sized target, in a fixed order with f32 sums. Each texel is first
  clamped as the screen would show it, so a highlight cannot bleed (with a
  look, to alpha × 64, because the look tone-maps afterwards). Only the
  output-sized target is read back. Thumbnails use the same path, look
  included. Peak capture memory is one tile target plus the output target
  and its readback (with a look, also an output-sized depth texture, the
  styled target and the look's own stage targets, released after the pass).
  A 4096 x 4096 export needs about 1.3x what it needed without
  supersampling; every export up to 2048 px needs less than that
  un-supersampled 4096 x 4096 capture did.
- A scene with a screen-space transmission material (the true-transmission
  atoms) is not tiled, because its refraction samples a buffer of the whole
  view: it renders one target at `min(3, floor(4096 / longest side))`, so
  exports above 2048 px with transmission are not supersampled. `supersample`
  in the fingerprint's determinism facts records the rule.
- The simulation cell is drawn as 1-texel lines. The capture marks its tile
  target with the factor, and the cell scales its opacity by it, so an
  exported cell keeps the weight of a 1 px line (in the live view the cell
  scales by the canvas DPR over 1.25 instead).
- Exports carry the viewer's look (owner decision: exports use the view as
  configured). The capture applies the configured post recipe (preset ×
  intensity × overrides, never the phone budget, so the spec does not depend
  on the device) itself, not through the live `useRenderPipeline`:
  - with a look, each tile texel is clamped to alpha × 64 instead of alpha,
    and the tiles assemble output-sized HDR colour, the nearest depth of each
    factor×factor block and, when tone mapping or the vignette would restyle
    the background, the averaged `lupiContent` coverage (the live MRT);
  - the look then runs once over the whole assembled image at the output
    resolution (`export/captureLookPass.ts`): GTAO (16 samples, denoised with
    a seeded noise texture) → bloom → depth of field → tone mapping →
    vignette, with the background given back where the look touched it. One
    pass over the whole image is the tile-seam rule: no stage sees a tile
    edge, and bloom, AO and defocus keep their extent relative to the image;
  - transparent output applies AO and tone mapping (on un-premultiplied
    colour) only, never bloom, depth of field or a vignette;
  - an empty look (the Diagram preset) is the raw path, byte for byte.
  `view.postprocess` records it: `pipeline: 'viewer-look'` with `toneMapping`
  (`neutral`, `aces`, `reinhard` or `none`) and `ao`, `bloom`, `dof`,
  `vignette` (each null when off), or the old `raw-scene` literal when the
  look is empty. `postprocessPipeline` in the fingerprint's determinism facts
  names the pass (`viewer-look-output-resolution.v1;…`). FXAA is the live
  view's only anti-aliasing and never runs on an export; supersampling is.
- The Illustrate look shades the impostors themselves, so its capture takes
  the raw path (`view.postprocess` is `raw-scene`), and the spec carries
  `view.ink`: `{ pipeline: 'impostor-ink.v1', shading: 'flat' | 'hatch',
  weight, ink, paper, shade, plate, depthCue }` (the far side fades toward
  `plate`), present only while the look is on, so every
  lit spec keeps its identity. Ink line weight follows the capture's texel
  scale and the picture's short side, so an export keeps the screen's weight.
- The Specimen floor shadow (`contactShadows` layer) is part of the view: it
  sits under every molecule up to 50,000 atoms (off for Diagram and under the
  filter shell), and the spec's `view.contactShadows` states its blur,
  opacity, resolution and colour (`specimenShadow.ts`). Contact occlusion is
  baked from the frame's positions; while a worker bake is still computing
  (12,001–250,000 atoms) the atom layer withholds its artifact receipt, so an
  export waits for it.
- An opaque artifact applies the spec's finalized gradient directly as the
  scene background, rather than trusting asynchronous UI background state. The
  gradient covers every pixel. Image, video, procedural, and backdrop-mesh
  backgrounds fail closed, and so does an adjusted gradient (opacity,
  brightness, saturation, contrast, yaw, pitch), which the viewer draws through
  the live backdrop mesh. Transparent output hides every background layer.
  Interactive UI exports have no artifact identity, so they capture whatever
  background the viewer shows, over the colour behind the canvas.
- Transparent pixels pass through a 2D canvas on the way to the browser
  encoder. The canvas stores them premultiplied in 8 bits, so very low alpha
  loses colour precision. This is deterministic and recorded as
  `rasterAlphaStorage`.
- Display motion (the arrival, the poke ripple, Scatter, Tug, Burst, Heat)
  and the hover and selection glow are illustrative and never reach an
  artifact: their master weights are zeroed inside every capture render and
  suspended for the whole of a video recording, and the camera rig
  settles and re-levels (y-up) before any capture reads the camera. An export
  mid-ripple has the same `artifactDigest` as one taken at rest. The one
  recording that keeps display motion is Instant Replay's clip
  (`beginRecording({ illustrative: true })`): it is labelled "Illustrative"
  in every frame and has no artifact identity. A Remix code's Foil finish
  (Holo, Gold leaf, Pearl) follows the same rule: zero in every capture
  render and ordinary recording, kept only in that illustrative clip. A
  Remix look itself (lights, materials, backdrop) is ordinary viewer state
  and exports as configured.
- Deterministic raster bonds fail closed until the asynchronous bond result is
  snapshot-addressable; hide bonds before raster export. Model export may use
  its synchronous CPU bond path, but fails if inferred bonds hit the cap.
  The spec's `view.bonds` names the graph: `topology` (`source-frame-v1`,
  `covalent-inference-v1` or `molecular-inference-v1`), `recipe` and, for the
  molecular recipe, `contacts`; all three are optional to the validator, and
  `sourceBondCount` is no longer accepted. A molecular GLB exports the view's
  graph as three meshes, `lupi-bonds-covalent`, `lupi-bonds-coordination` and
  `lupi-contacts-ionic`, with dashes and dots as cylinder segments of the live
  period and duty, and glTF extras `{ lupiBondRecipe, lupiBondKind,
  lupiProvenance: 'inferred' }`; other frames keep one `bonds` mesh.
- USDZ remains available from the ordinary interactive export UI (AR Quick
  Look) but is not advertised by `lupi.export_asset`. three's USDZExporter
  (r186) embeds process-global object ids, so identical semantics do not yet
  produce identical USDZ bytes behind one artifact key.

The WebGPU backend and the WebGL2 fallback are two execution classes:
`browser-webgpu-main-thread` and `browser-webgpu-webgl2-main-thread`. The same
spec keeps its `specId` on both, but gets a different `rendererFingerprint` and
`artifactKey`, because the bytes may differ. Never compare bytes across
backends. An export before the viewer canvas has created its renderer fails,
because the backend is part of the identity.

The four identities are deliberately different:

- `specId` hashes finalized semantic intent and decoded source content.
- `rendererFingerprint` hashes the build and the execution class which can
  change bytes. The V2 fingerprint includes:
  - renderer `lupi-browser-webgpu.v2`
  - `rendererVersion` `three-r186;fiber-<pin>;bridge-<version>`
  - the backend's execution class
  - the `DETERMINISM_V2` capture facts
  - runtime facts: the WebGPU adapter, or the WebGL2 context strings;
    compatibility mode; canvas samples; browser and platform; transmission
    quality
  - the advertised capability
- `artifactKey` hashes `specId` plus `rendererFingerprint` and is the immutable
  cache/object identity for that execution class.
- `artifactDigest` hashes the actual decoded output bytes.

Delivery preferences do not affect any of them. The Cloudflare path
currently validates only opaque PNG atom specs and returns
`awaiting_renderer`; it does not execute, persist, or retrieve an artifact.
The containerized render backend (`apps/render-backend`) launches Chromium
with `--disable-webgpu`, so its artifacts are in the WebGL2 execution class.

The V1 (WebGL renderer) goldens stay archived read-only in
`tests/fixtures/render-artifact-v1/`. V2 parity candidates live per backend in
`tests/fixtures/render-artifact-v2/<backend>/`, and
`pnpm verify:render-parity -- --backend=<webgpu|webgl2> --derive-candidate`
derives them automatically. There is no owner approval gate. Derive them again
whenever the tool reports a renderer-validity digest change.

## Verification Harness

Run the Playwright-based smoke test against the built-in dev server:

```bash
pnpm run verify:mcp-bridge
```

Or point it at an already-running dev server:

```bash
node tools/verify-mcp-bridge.mjs --url=http://127.0.0.1:5173/#/mcp --json
```

The `--json` flag emits a machine-readable report to stdout. Non-zero exit code indicates failure.

## Asset Quality Verification

For visual and structural verification of `lupi.export_asset`, drive a real
browser in each backend lane, render the advertised raster/model profiles, and
inspect the bytes:

```bash
pnpm --filter @atlas/web build
pnpm run verify:asset-quality                      # both lanes, built app
node tools/verify-asset-quality.mjs --backend=webgpu
node tools/verify-asset-quality.mjs --server=dev   # Vite dev server instead
# or, against an existing server:
node tools/verify-asset-quality.mjs --url=http://127.0.0.1:5173/
```

The verifier exercises fixed molecule and lattice cases with unsupported raster
  bonds disabled. It covers opaque/transparent PNG and WebP, opaque JPEG plus
  transparent-JPEG rejection, GLB, required USDZ fail-closed behavior, exact dimensions, and appearance
mutations. It asserts, as applicable:

- declared `byteLength` matches the file written to disk
- decoded raster alpha and dimensions match the request
- the binary/container structure is well-formed (PNG IHDR, JPEG SOF, WebP
  VP8/VP8L/VP8X, and GLB magic/chunks)
- `dataUrl` MIME prefix matches the response `mimeType`
- the on-disk file matches the round-tripped base64
- color/material/lighting changes produce material image differences
- each lane reports its backend, and the same spec keeps its `specId` across
  the two lanes while its `rendererFingerprint` and `artifactKey` differ

Artifacts (real rasters/models plus a viewer screenshot and JSON report) are written
under `.verify-artifacts/asset-quality/<run>/<backend>/` so a human can inspect them.
Add `--skip-glb` to skip the model tier when iterating on raster formats.

Use `node tools/inspect-glb.mjs <file.glb>` to dump scene/mesh contents of
an exported GLB without a browser.

## Common Failures

| Symptom                                   | Likely cause                                                                                     | Fix                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `window.__lupiViewerMcp` is `undefined`   | Viewer not on a route that mounts the bridge.                                                    | Navigate to `/#/mcp` or wait for the route guard.                                                        |
| `ready` is `false`                        | Store not hydrated or route guard is `false`.                                                    | Check `window.__lupiViewerMcpVersion` exists; wait a tick.                                               |
| `No molecule is loaded`                   | Tool needs a file but none is loaded.                                                            | Run `lupi.generate_molecule` via `parseCommand` first, or load via URL.                                  |
| Deterministic raster export rejects bonds | The live asynchronous bond result is not snapshot-addressable yet.                               | Hide bonds, or use a model export only when its synchronous CPU bond path is intended.                   |
| Background is rejected                    | Image/video/procedural/backdrop-mesh or adjusted-gradient state is not applicable from the spec. | Use the default dome/image projection with an unadjusted gradient preset, or request transparent output. |
| `The viewer renderer has not started`     | Export issued before the canvas created its WebGPURenderer.                                      | Poll `status().rendererBackend` until it is non-null.                                                    |
| `rendererBackend` is not the one expected | The lane lacks the WebGPU flags, or the URL has `?renderer=webgl2`.                              | Launch with `LANE_ARGS` from `tools/lib/browser-lanes.mjs`.                                              |
| `Unsupported Lupi viewer MCP tool`        | Tool name typo or old manifest.                                                                  | Compare against `/browser-mcp-manifest.json`; `/mcp-manifest.json` is the smaller edge-runtime contract. |
| PubChem fetch fails                       | Network or CORS.                                                                                 | Use a local template or SMILES that matches `TEMPLATE_MOLECULES`.                                        |

## Security Notes

- The bridge accepts commands only from the same origin and `localhost` origins.
- It does not execute arbitrary JavaScript passed as arguments; arguments are parsed as typed tool inputs.
- The `lupi.generate_molecule` tool may call external APIs (PubChem) from the browser.

## Regenerating the Manifest

After changing tool definitions or schemas, regenerate the manifest before testing:

```bash
pnpm run generate:mcp-manifest
```

## Full CI Checklist

### What CI runs

LUPI CI (`.github/workflows/ci.yml`) runs on pull requests and on pushes to
`main` that touch the apps, packages, docs, tools or build config. Its
`build-test` job runs, in order:

```bash
node tools/verify-pnpm-lock-bins.mjs
pnpm install --frozen-lockfile
pnpm verify:workflows        # actionlint; CI fetches a checksum-pinned 1.7.12
node --test tools/run-actionlint.test.mjs
node --test tools/verify-product-contract.test.mjs
pnpm verify:product-contract
pnpm lint
NODE_OPTIONS=--max-old-space-size=8192 pnpm audit --prod --audit-level high
node --test tools/verify-cloudflare-live.test.mjs
pnpm build                   # every workspace; the web build regenerates the MCP manifest
# wrangler versions upload --dry-run with the pinned Wrangler in .github/wrangler-runtime
pnpm test                    # every workspace's unit tests
cd functions && npm ci && npm audit --omit=dev --audit-level=high && npm run build && npm test && cd ..
pnpm cloudflare:test
npm run nist:build           # fails if apps/web/public/nist changes
pnpm exec playwright install --with-deps chromium
pnpm test:ui
```

Its `mobile-testflight-source` job runs `pnpm --filter @lupi/mobile
verify:testflight` on the frozen Expo app. Apple packages
(`.github/workflows/apple.yml`) runs the Linux gates of "Native Apple app"
above when `apps/apple`, `tools/apple`, `packages/core`, `packages/parsers`,
the Worker's sources, the gallery or the datasets change.
`pnpm cloudflare:build` is covered by `pnpm build`.

### Local only

No workflow runs these. Run them by hand when a change touches the bridge,
exports or the renderer:

```bash
pnpm run verify:mcp-bridge
pnpm run verify:asset-quality
pnpm run verify:exports
pnpm run verify:render-parity -- --backend=webgpu
pnpm run verify:render-parity -- --backend=webgl2
pnpm verify:dual-backend
```

`pnpm test:ui` runs the Playwright specs in the WebGL2 lane. The dual-backend
browser check is local only (not in CI): build the web app, then run
`pnpm verify:dual-backend` (`tools/verify-viewer-smoke.mjs --backend=both
--profile=both --strict-backend`; `--scenarios=` and `--cases=` narrow it).
Scenario plugins in `tools/smoke/scenarios/*.mjs` (camera, chrome,
first-minute, flick, hero, relay, settings, tap, toys) run with the built-in
scenarios; `--profile=phone390` (or `all`) adds a 390 px touch phone, and
`--reduced-motion` checks the Still comfort level.

These are local/CI checks only. They do not prove a deployment, live API, or
public-site revision; record those release-truth lanes separately.
