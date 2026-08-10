# Lupi MCP Model Integration Brief

This document is a handoff for a model or agent that needs to integrate with Lupi quickly and reliably. The browser-native bridge remains useful for visual QA and local viewer debugging, but the preferred production path is the Cloudflare MCP control plane in `apps/mcp-worker`; see `docs/cloudflare-mcp.md`.

The browser route at `https://lupi.live/#/mcp` is still the compatibility fallback when you need to drive the real WebGL/WebGPU viewer.

## Current judgment

The MCP control panel works as a developer/debug surface, but it should not be the model-facing integration contract.

The panel currently has too much density and too little hierarchy:

- Search, catalog browsing, command staging, response logs, auth state, file state, and tool controls compete for the same narrow rail.
- The visible UI does not clearly separate “human exploration” from “agent execution.”
- Many controls are small and similarly styled, so affordances are weak: it is not obvious which actions load data, stage commands, execute commands, or only filter lists.
- The catalog/search region dominates the panel and makes the actual MCP affordances harder to discover.
- The panel is useful for debugging, but it is not the shortest path for a model. Models should call the bridge directly through `window.__lupiViewerMcp` and use the UI only as a visual/debug fallback.

Recommended integration stance:

1. Prefer the Cloudflare MCP endpoint for agent-native asset requests.
2. Use the browser bridge only when you need live viewer visual QA or a fallback before the Cloudflare renderer is fully wired.
3. Use `/mcp-manifest.json` for the seven-tool edge runtime and
   `/browser-mcp-manifest.json` for the 30-tool browser viewer runtime.
4. Do not wait for browser `networkidle`; wait for explicit MCP readiness/status checks.

## Fast path for model integration

Open the live MCP route:

```txt
https://lupi.live/#/mcp
```

Wait for readiness:

```js
await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true);
await page.waitForFunction(() => window.__lupiViewerMcp?.status?.().ready === true);
```

Read health:

```js
const status = await page.evaluate(() => window.__lupiViewerMcp.status());
// {
//   ready: true,
//   version: string,
//   toolCount: 30,
//   moleculeLoaded: boolean,
//   atomCount: number,
//   frame: number,
//   playing: boolean
// }
```

Discover tools:

```js
const tools = await page.evaluate(() => window.__lupiViewerMcp.tools());
const manifest = await page.evaluate(() => fetch('/browser-mcp-manifest.json').then((r) => r.json()));
```

Execute a single tool:

```js
const response = await page.evaluate(() =>
  window.__lupiViewerMcp.execute({
    id: 'camera-iso-1',
    tool: 'lupi.set_camera_preset',
    arguments: { preset: 'iso' },
  })
);
```

Execute a batch:

```js
const responses = await page.evaluate(() =>
  window.__lupiViewerMcp.executeBatch([
    { id: 'load-1', tool: 'lupi.generate_molecule', arguments: { template: 'benzene' } },
    { id: 'speed-1', tool: 'lupi.set_playback_speed', arguments: { speed: 2 } },
    { id: 'camera-1', tool: 'lupi.set_camera_preset', arguments: { preset: 'iso' } },
    { id: 'bg-1', tool: 'lupi.set_background', arguments: { preset: 'slate' } },
    { id: 'style-1', tool: 'lupi.set_postprocess', arguments: { preset: 'diagram', intensity: 0.8 } },
  ])
);
```

Render a molecule asset for a model:

```js
const [load, asset] = await page.evaluate(() =>
  window.__lupiViewerMcp.executeBatch([
    {
      id: 'load-caffeine',
      tool: 'lupi.generate_molecule',
      arguments: {
        inputType: 'template',
        input: 'Caffeine',
        viewer: { showBonds: true, cameraPreset: 'iso', postprocessPreset: 'studio' },
      },
    },
    {
      id: 'render-caffeine-png',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 1024, height: 1024 },
    },
  ])
);

// asset.result.asset.dataBase64 is the PNG bytes; dataUrl is also provided.
```

Natural-language shortcut:

```js
const requests = await page.evaluate(() =>
  window.__lupiViewerMcp.parseCommand('render caffeine png 1024x1024 with bonds on camera iso')
);
// => lupi.generate_molecule, then lupi.export_asset
```

Verify state after actions:

```js
const state = await page.evaluate(() => window.__lupiViewerMcp.state());
```

Generate a shareable URL:

```js
const encoded = await page.evaluate(() =>
  window.__lupiViewerMcp.execute({
    id: 'share-1',
    tool: 'lupi.encode_view_url',
    arguments: {},
  })
);
```

## Public bridge API

When the MCP route is mounted, the page exposes:

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

Request shape:

```ts
interface LupiMcpRequest {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
}
```

Response shape:

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

Status shape:

```ts
interface LupiMcpStatus {
  ready: true;
  version: string;
  toolCount: number;
  moleculeLoaded: boolean;
  atomCount: number;
  frame: number;
  playing: boolean;
}
```

## Tool inventory

There are currently 30 browser-viewer `lupi.*` tools. Always prefer
`/browser-mcp-manifest.json` for their live schemas.

Molecule and asset tools:

- `lupi.generate_molecule` — load/generate by template, name, SMILES, XYZ, description, or procedural lattice.
- `lupi.load_molecule_url` — load a molecule or trajectory URL.
- `lupi.open_gallery_example` — open a canonical gallery item with caller-pinned identity and atom-count limits.
- `lupi.open_saved_view` — open a saved Lupi view slug.
- `lupi.search_molecules` — search molecule/catalog providers and return load specs.
- `lupi.set_viewer` — broad viewer patch for common style/camera settings.
- `lupi.export_xyz` — return active frame XYZ text.
- `lupi.export_asset` — return the active deterministic view as inline PNG/JPEG/WebP or GLB with `dataBase64`, `dataUrl`, `mimeType`, `filename`, and `byteLength`. USDZ stays outside the immutable-key lane until its serializer is byte-stable.
- `lupi.viewer_state` — return current viewer state.
- `lupi.assess_asset` — run a bounded fast assessment of active, URL, or envelope source evidence.
- `lupi.knowledge_graph` — query active knowledge-graph labels.

Core health:

- `lupi.status` — report readiness and viewer health.

Trajectory and playback:

- `lupi.set_frame`
- `lupi.play`
- `lupi.pause`
- `lupi.set_playback_speed`

Camera and view:

- `lupi.set_camera_preset`
- `lupi.set_camera`
- `lupi.fit_camera`
- `lupi.encode_view_url`
- `lupi.reset_viewer`

Visual style:

- `lupi.set_background`
- `lupi.set_postprocess`
- `lupi.set_material`
- `lupi.set_lighting`
- `lupi.set_filter_shell`
- `lupi.set_vector_field`
- `lupi.set_atom_visibility`

Annotations:

- `lupi.add_annotation`
- `lupi.remove_annotation`

For PNG/GLB output, prefer `executeBatch([generate/load/style..., export_asset])` so the response contains the binary asset directly instead of requiring a UI download.

## Recommended model loop

A robust model integration loop should be:

1. Navigate to `/#/mcp`.
2. Wait for `window.__lupiViewerMcp.ready === true`.
3. Call `status()`.
4. Fetch `/browser-mcp-manifest.json`.
5. Choose tool calls from the manifest, not from guesses.
6. Call `executeBatch()` when multiple actions form one view change.
7. Assert every response has `ok === true`.
8. Read `state()` after the batch.
9. If a binary artifact is needed, call `lupi.export_asset`; if a shareable view is needed, call `lupi.encode_view_url`.
10. If a tool fails, inspect `response.error.message` and `response.transcript`; do not retry blindly.

Example Playwright helper:

```js
async function callLupi(page, tool, args = {}, id = tool) {
  await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true);
  const response = await page.evaluate(
    ({ id, tool, args }) => window.__lupiViewerMcp.execute({ id, tool, arguments: args }),
    { id, tool, args },
  );
  if (!response.ok) {
    throw new Error(`${tool} failed: ${response.error?.message ?? 'unknown error'}`);
  }
  return response;
}
```

## UI improvement direction

The visible MCP control panel should become a model cockpit, not a dense catch-all sidebar.

Recommended redesign principles:

### 1. Split modes clearly

Use explicit tabs or sections:

- **Status** — readiness, loaded molecule, frame, tool count, last error.
- **Prompt / Command** — natural-language command input and staged JSON.
- **Tools** — searchable manifest-driven tool list with schema examples.
- **Results** — response log, transcripts, exported artifacts.
- **Catalog** — molecule/dataset search, visually separate from execution.

### 2. Make execution obvious

- Use one dominant primary action: “Run command” or “Execute batch.”
- Clearly distinguish “stage,” “run,” “copy,” “load,” and “filter.”
- Show pending requests before execution.
- Show success/failure per request after execution.

### 3. Make status persistent

A compact sticky status strip should always show:

- ready/not ready
- tool count
- molecule loaded
- atom count
- current frame
- playing/paused
- last error

### 4. Make tools manifest-driven

The browser tool list should be generated from `/browser-mcp-manifest.json`, not hand-maintained UI code. For each tool:

- name
- description
- JSON schema
- example arguments
- “copy request” button
- “run with current args” button

### 5. Separate human browsing from model execution

Catalog search is useful, but it overwhelms the control panel. It should be either:

- a dedicated “Catalog” tab, or
- a separate drawer/panel launched from the MCP cockpit.

### 6. Include a model handoff box

Add a copyable block in the UI:

```txt
Open https://lupi.live/#/mcp
Wait for window.__lupiViewerMcp.ready === true
Fetch /browser-mcp-manifest.json
Call window.__lupiViewerMcp.status()
Use execute()/executeBatch() for lupi.* tools
Verify with state() and encode with lupi.encode_view_url
```

This makes the UI itself teach the integration path.

## Verification commands

For a model or external integrator, verify against the live website:

```bash
node tools/verify-mcp-bridge.mjs --url=https://lupi.live/#/mcp
```

For developers changing bridge behavior in the repo, run the local checks before deployment:

```bash
pnpm run generate:mcp-manifest
pnpm --filter @atlas/ui build
pnpm run lint
pnpm run verify:mcp-bridge
```

The full test suite is intentionally separate and can be run later:

```bash
pnpm run test
```

## Current known good smoke result

As of this brief, the Playwright MCP smoke verifies:

- driver ready on `window`
- 30 live tools
- `status()` reports ready and matching `toolCount`
- `/browser-mcp-manifest.json` matches the live registry
- unsupported tools return structured errors
- legacy molecule generation works
- AI-control batch tools execute successfully
- command bus emits request/success events
- postMessage bridge returns a response payload

## Integration rule of thumb

Do not teach a model to click the MCP panel unless the task is explicitly UI QA. Teach it to use the browser bridge.

The UI can be improved, but the browser integration contract is already good:
`status()`, `tools()`, `/browser-mcp-manifest.json`, `execute()`,
`executeBatch()`, and `state()` are the path of least resistance.
