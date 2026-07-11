# AGENTS.md — Operating Lupi via MCP

> This file is for autonomous agents (Claude, Cursor, Kimi, etc.) that need to request molecule assets or inspect/debug the Lupi molecular viewer without clicking the UI.

## Preferred Path: Cloudflare Edge

For app and agent-native workflows, use the Cloudflare edge Worker instead of
launching a browser. The Worker lives in `apps/mcp-worker` and serves both the
web app and MCP JSON-RPC over HTTP:

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
- `GET /mcp-manifest.json` — Cloudflare MCP tool manifest
- `GET /browser-mcp-manifest.json` — browser bridge manifest compatibility path
- `POST /v1/render` — REST shortcut for `lupi.render_molecule_asset`
- `GET /v1/jobs/:jobId` — render job status
- `GET /assets/:assetId.:ext` — R2 asset delivery once rendering is configured

The Worker is intentionally browser-free. It validates render requests,
computes deterministic cache/job IDs, reads/writes R2/D1 when configured, and
hands work to a queue or renderer backend. Without a renderer binding, render
requests return `awaiting_renderer` instead of pretending to produce pixels.

See `docs/cloudflare-migration.md` for the whole-app cutover and
`docs/cloudflare-mcp.md` for MCP setup, bindings, example `curl`, and renderer
backend contract.

## Browser Bridge Fallback

Use the browser bridge when you need visual QA, local viewer debugging, or to
compare Cloudflare outputs against the live WebGL/WebGPU viewer.

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
       id: 'demo-1',
       tool: 'lupi.set_camera_preset',
       arguments: { preset: 'iso' }
     })
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
  id: string;      // any unique string
  tool: string;    // one of the 28 lupi.* browser bridge tools
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

A static JSON manifest is available at:

```
/mcp-manifest.json
```

Fetch it to discover tool names, descriptions, and JSON Schemas without loading the page. It is generated from the same source files as the runtime tool registry, so it cannot drift.

```js
const manifest = await page.evaluate(() =>
  fetch('/mcp-manifest.json').then(r => r.json())
);
```

## Tool Reference (28 tools)

| Tool | Description | Example arguments |
|------|-------------|-------------------|
| `lupi.generate_molecule` | Load/generate a molecule by template, name, SMILES, XYZ, description, or procedural lattice. | `{ inputType: 'template', input: 'Caffeine' }` |
| `lupi.load_molecule_url` | Load a molecule or trajectory URL. | `{ url: 'https://example.com/molecule.xyz' }` |
| `lupi.open_saved_view` | Open a saved Lupi view by slug. | `{ slug: 'abc123' }` |
| `lupi.search_molecules` | Search molecule/catalog providers. | `{ query: 'aspirin', limit: 5 }` |
| `lupi.set_viewer` | Apply common viewer display/style settings. | `{ showBonds: true, cameraPreset: 'iso' }` |
| `lupi.export_xyz` | Return active frame XYZ text. | `{}` |
| `lupi.export_asset` | Return active view as inline PNG/JPEG/WebP or GLB/USDZ. | `{ format: 'png', width: 1024, height: 1024 }` |
| `lupi.viewer_state` | Return current viewer state. | `{}` |
| `lupi.knowledge_graph` | Query active knowledge-graph labels. | `{ query: 'force', limit: 20 }` |
| `lupi.status` | Report bridge readiness and viewer health. | `{}` |
| `lupi.set_frame` | Jump to a trajectory frame. | `{ frame: 0 }` |
| `lupi.play` | Start playback. | `{}` |
| `lupi.pause` | Pause playback. | `{}` |
| `lupi.set_playback_speed` | Set speed multiplier (0.0625–16). | `{ speed: 1.5 }` |
| `lupi.set_camera_preset` | Apply top, side, front, iso, or free. | `{ preset: 'iso' }` |
| `lupi.set_camera` | Set camera position/target/FOV. | `{ position: [10,10,10], target: [0,0,0], fov: 45 }` |
| `lupi.fit_camera` | Fit camera to molecule bounds. | `{}` |
| `lupi.set_background` | Set background preset, style, motion, etc. | `{ preset: 'blueprint', postprocessPreset: 'diagram' }` |
| `lupi.set_postprocess` | Set postprocess preset/intensity. | `{ preset: 'studio', intensity: 0.8 }` |
| `lupi.set_material` | Set material preset/scene/intensity/texture. | `{ preset: 'metallic', scene: 'studio', intensity: 1.0 }` |
| `lupi.set_lighting` | Adjust ambient/dir/rim lights and angles. | `{ ambient: 0.6, dir: 0.8, rim: 0.4 }` |
| `lupi.set_filter_shell` | Set filter shell shape/preset/opacity/radius. | `{ shape: 'sphere', preset: 'haze', opacity: 0.3 }` |
| `lupi.set_vector_field` | Set vector field layer/scale/density. | `{ fieldId: 'velocity', scale: 1.0, density: 0.5 }` |
| `lupi.set_atom_visibility` | Hide atom types or scale per-type radii. | `{ hiddenAtomTypes: [1], atomTypeScales: { '29': 1.2 } }` |
| `lupi.add_annotation` | Add an etched label to an atom. | `{ atomIndex: 10, text: 'active site' }` |
| `lupi.remove_annotation` | Remove an annotation by id. | `{ id: 'abc-123' }` |
| `lupi.encode_view_url` | Serialize current state to a shareable URL. | `{}` |
| `lupi.reset_viewer` | Reset viewer to defaults. | `{}` |

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

For visual / structural verification of `lupi.export_asset`, drive a real
browser, render PNG/JPEG/WebP/GLB, and inspect the bytes:

```bash
pnpm run verify:asset-quality
# or, against an existing dev server:
node tools/verify-asset-quality.mjs --url=http://127.0.0.1:5173/#/mcp
```

The verifier exports Caffeine and a 5,000-atom FCC Cu lattice in every
supported format and asserts:

- declared `byteLength` matches the file written to disk
- the binary header is well-formed (PNG IHDR, JPEG SOF, WebP VP8/VP8L/VP8X,
  glTF magic + chunk length)
- `dataUrl` MIME prefix matches the response `mimeType`
- the on-disk file matches the round-tripped base64

Artifacts (real PNGs/JPGs/WebPs/GLBs plus a viewer screenshot) are written
under `.verify-artifacts/asset-quality/<run>/` so a human can inspect them.
Add `--skip-glb` to skip the GLB tier when iterating on image formats.

Use `node tools/inspect-glb.mjs <file.glb>` to dump scene/mesh contents of
an exported GLB without a browser.

## Common Failures

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `window.__lupiViewerMcp` is `undefined` | Viewer not on a route that mounts the bridge. | Navigate to `/#/mcp` or wait for the route guard. |
| `ready` is `false` | Store not hydrated or route guard is `false`. | Check `window.__lupiViewerMcpVersion` exists; wait a tick. |
| `No molecule is loaded` | Tool needs a file but none is loaded. | Run `lupi.generate_molecule` via `parseCommand` first, or load via URL. |
| `Unsupported Lupi viewer MCP tool` | Tool name typo or old manifest. | Compare against `/mcp-manifest.json`. |
| PubChem fetch fails | Network or CORS. | Use a local template or SMILES that matches `TEMPLATE_MOLECULES`. |

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
pnpm --filter @atlas/ui build
pnpm --filter @atlas/ui test
pnpm run lint
pnpm run verify:mcp-bridge
pnpm run verify:asset-quality
```
