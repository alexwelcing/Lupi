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
- `GET /mcp-manifest.json` — six-tool Cloudflare edge control-plane manifest
- `GET /browser-mcp-manifest.json` — 28-tool browser viewer manifest
- `POST /v1/render` — REST shortcut for `lupi.render_molecule_asset`
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

## Quick Start

1. Start the dev server:
   ```bash
   pnpm dev
   # or
   pnpm --filter @atlas/web dev
   ```
2. Open the viewer in a headless browser (Playwright, Puppeteer, etc.) at the root URL, e.g. `http://localhost:5173/` or `http://localhost:5173/#/mcp`.
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
  tool: string; // one of the 28 lupi.* browser tools
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
//   version: '0.3.0',
//   toolCount: 28,
//   moleculeLoaded: true,
//   atomCount: 250000,
//   frame: 0,
//   playing: false
// }
```

Poll until `ready === true` and `toolCount > 0` before sending commands.

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

## Tool Reference (28 tools)

| Tool                       | Description                                                                                                                      | Example arguments                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `lupi.generate_molecule`   | Load/generate a molecule by template, name, SMILES, XYZ, description, or procedural lattice.                                     | `{ inputType: 'template', input: 'Caffeine' }`            |
| `lupi.load_molecule_url`   | Load a molecule or trajectory URL.                                                                                               | `{ url: 'https://example.com/molecule.xyz' }`             |
| `lupi.open_saved_view`     | Open a saved Lupi view by slug.                                                                                                  | `{ slug: 'abc123' }`                                      |
| `lupi.search_molecules`    | Search molecule/catalog providers.                                                                                               | `{ query: 'aspirin', limit: 5 }`                          |
| `lupi.set_viewer`          | Apply common viewer display/style settings.                                                                                      | `{ showBonds: true, cameraPreset: 'iso' }`                |
| `lupi.export_xyz`          | Return active frame XYZ text.                                                                                                    | `{}`                                                      |
| `lupi.export_asset`        | Return the active deterministic profile as inline PNG/JPEG/WebP or GLB; unsupported active layers/combinations fail closed.       | `{ format: 'png', width: 1024, height: 1024 }`            |
| `lupi.viewer_state`        | Return current viewer state.                                                                                                     | `{}`                                                      |
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

## Render artifact V1 truth

Contract strings use dot-separated versions: `lupi.render-request.v1`,
`lupi.render-artifact-spec.v1`, and `lupi.render-delivery.v1`.

The browser V1 candidate advertises PNG/JPEG/WebP/GLB, subject to exact
format and active-state checks. JPEG is opaque only; GLB rejects raster
dimensions and transparency. Raster capture uses the raw Three.js scene,
pixel-ratio 1, sRGB output, no tone mapping, and no interactive postprocess.
Opaque raster capture applies the finalized gradient spec directly rather than
trusting asynchronous UI background state. Image, video, procedural, and
backdrop-mesh backgrounds fail closed. Deterministic raster bonds also fail
closed until the asynchronous bond result is snapshot-addressable; hide bonds
before raster export. Model export may use its synchronous CPU bond path, but
fails if inferred bonds hit the cap. USDZ remains available from the ordinary
interactive export UI, but is not advertised by `lupi.export_asset`: Three r184
embeds process-global object ids, so identical semantics do not yet produce
identical USDZ bytes behind one artifact key.

The four identities are deliberately different:

- `specId` hashes finalized semantic intent and decoded source content.
- `rendererFingerprint` hashes the build and execution class which can change bytes.
- `artifactKey` hashes `specId` plus `rendererFingerprint` and is the immutable
  cache/object identity for that execution class.
- `artifactDigest` hashes the actual decoded output bytes.

Delivery preferences do not affect any of them. The Cloudflare V1 path
currently validates only opaque PNG atom specs and returns
`awaiting_renderer`; it does not execute, persist, or retrieve a V1 artifact.

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
browser, render the advertised raster/model profiles, and inspect the bytes:

```bash
pnpm run verify:asset-quality
# or, against an existing dev server:
node tools/verify-asset-quality.mjs --url=http://127.0.0.1:5173/#/mcp
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

Artifacts (real rasters/models plus a viewer screenshot and JSON report) are written
under `.verify-artifacts/asset-quality/<run>/` so a human can inspect them.
Add `--skip-glb` to skip the model tier when iterating on raster formats.

Use `node tools/inspect-glb.mjs <file.glb>` to dump scene/mesh contents of
an exported GLB without a browser.

## Common Failures

| Symptom                                   | Likely cause                                                                                   | Fix                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `window.__lupiViewerMcp` is `undefined`   | Viewer not on a route that mounts the bridge.                                                  | Navigate to `/#/mcp` or wait for the route guard.                                                        |
| `ready` is `false`                        | Store not hydrated or route guard is `false`.                                                  | Check `window.__lupiViewerMcpVersion` exists; wait a tick.                                               |
| `No molecule is loaded`                   | Tool needs a file but none is loaded.                                                          | Run `lupi.generate_molecule` via `parseCommand` first, or load via URL.                                  |
| Deterministic raster export rejects bonds | The live asynchronous bond result is not snapshot-addressable in V1.                           | Hide bonds, or use a model export only when its synchronous CPU bond path is intended.                   |
| Background is rejected                    | Image/video/procedural/backdrop-mesh state is not directly applicable from the canonical spec. | Use the default dome/image projection with a static gradient preset, or request transparent output.      |
| `Unsupported Lupi viewer MCP tool`        | Tool name typo or old manifest.                                                                | Compare against `/browser-mcp-manifest.json`; `/mcp-manifest.json` is the smaller edge-runtime contract. |
| PubChem fetch fails                       | Network or CORS.                                                                               | Use a local template or SMILES that matches `TEMPLATE_MOLECULES`.                                        |

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
pnpm run verify:render-parity
pnpm run test:ui
```

These are local/CI checks only. They do not prove a deployment, live API, or
public-site revision; record those release-truth lanes separately.
