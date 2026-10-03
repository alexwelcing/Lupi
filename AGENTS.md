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
- `GET /view/:slug` — saved-view social/share HTML
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
- **`window.__lupiPlay`** is the Play layer's handle for smoke plugins and
  agents (installed in production, like `__lupiViewerMcp`): `state()` returns
  `{ verb, trayOpen, displaced, flash, comfort, rig, motion, firstFrame,
  frames, frameDemand }`,
  `emit(intent)` emits a Lupi intent as the UI would, `reset()` puts display
  motion at rest, and `poke`, `flick`, `catch`, `scatter` and `stepDetent`
  appear once the viewer has registered them. It never writes molecule data.
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
//   bondCount: 420000,
//   bondSource: 'gpu',
//   bondTopology: 'inferred',
//   showBondsEffective: true
// }
```

Poll until `ready === true` and `toolCount > 0` before sending commands, and
until `rendererBackend` is non-null before an export. The `lupi.status` tool
returns the same three renderer fields.

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
| `lupi.browse_collection`   | Page through a remote OMol25 collection via the dataset edge; returns source-coordinate load specs, no rows stored by Lupi.       | `{ collection: 'neutral-train', offset: 0, limit: 24 }`   |
| `lupi.set_viewer`          | Apply common viewer display/style settings.                                                                                      | `{ showBonds: true, cameraPreset: 'iso' }`                |
| `lupi.export_xyz`          | Return active frame XYZ text.                                                                                                    | `{}`                                                      |
| `lupi.export_asset`        | Return the active deterministic profile as inline PNG/JPEG/WebP or GLB; unsupported active layers/combinations fail closed.       | `{ format: 'png', width: 1024, height: 1024 }`            |
| `lupi.viewer_state`        | Return current viewer state.                                                                                                     | `{}`                                                      |
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

## Render artifact V2 truth

Contract strings are unchanged and use dot-separated versions:
`lupi.render-request.v1`, `lupi.render-artifact-spec.v1`, and
`lupi.render-delivery.v1`. What changed with the WebGPURenderer port is the
renderer that executes them: the browser renderer profile is V2
(`packages/ui/src/export/exportProfileV2.ts`).

The browser candidate advertises PNG/JPEG/WebP/GLB, subject to exact format
and active-state checks. JPEG is opaque only; GLB rejects raster dimensions and
transparency.

Raster capture never reads the canvas. It renders the raw Three.js scene with
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
  clamped as the screen would show it, so a highlight cannot bleed. Only the
  output-sized target is read back. Thumbnails use the same path. Peak
  capture memory is one tile target plus the output target and its readback.
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

- The interactive post pipeline (AO, bloom, depth of field, output tone
  mapping, vignette) is bypassed. Exports show the raw scene with the viewer's
  configured background. `postprocessPipeline: 'raw-scene-bypassed'` in the
  fingerprint and `view.postprocess` in the spec both record this.
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
- Display motion (the arrival, the poke ripple, Scatter) is illustrative and
  never reaches an artifact: its master weight is zeroed inside every capture
  render and suspended for the whole of a video recording, and the camera rig
  settles and re-levels (y-up) before any capture reads the camera. An export
  mid-ripple has the same `artifactDigest` as one taken at rest.
- Deterministic raster bonds fail closed until the asynchronous bond result is
  snapshot-addressable; hide bonds before raster export. Model export may use
  its synchronous CPU bond path, but fails if inferred bonds hit the cap.
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

```bash
pnpm install
pnpm run generate:mcp-manifest
pnpm --filter @atlas/core test
pnpm --filter @atlas/core build
pnpm --filter @atlas/scene test
pnpm --filter @atlas/ui build
pnpm --filter @atlas/ui test
pnpm cloudflare:build
pnpm cloudflare:test
pnpm run lint
pnpm run verify:mcp-bridge
pnpm run verify:asset-quality
pnpm run verify:exports
pnpm run verify:render-parity -- --backend=webgpu
pnpm run verify:render-parity -- --backend=webgl2
pnpm run test:ui
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
