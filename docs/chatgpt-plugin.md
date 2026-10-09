# Lupi Live in ChatGPT

The Lupi ChatGPT plugin connects to the public, read-only Streamable HTTP MCP endpoint at `https://lupi.live/chatgpt/mcp`. Its interactive viewer is a self-contained MCP App resource, `ui://lupi/molecule-v3.html`. The portable package lives in `plugins/lupi-live/`.

## Source choice

For everyday descriptions, `recommend_molecule` matches one of 12 known compounds from the native app's starter catalogue. Exact names/formulas work without AI. Jev description matches return a model and inferred confidence, or an explicit withheld answer. This does not retrieve a structure or predict a property. Use the returned `pubchemCid` with `resolve_molecule`, then the resulting `structureRef` with `show_molecule`. Native play uses bundled coordinates and chat uses retrieved PubChem coordinates, so discovery shares compound choices rather than guaranteeing conformer parity. See [shared discovery](jev-discovery.md).

Use **OMol25** for research molecule discovery. The plugin advertises the complete public neutral training collection (34,335,828 indexed rows), complete neutral validation, and three explicitly labeled indexed previews of larger collections. `list_omol25_collections` reports coverage. `search_omol25` pages or searches one collection by text or exact formula and returns source row indexes. `open_omol25` loads the selected row's source 3D XYZ coordinates and creates a pinned structure reference. `show_molecule` can reuse that reference for highlights or display changes.

The OMol25 conversion exposed by Lupi has atomic coordinates but no source bond table. Original `molecule.bonds` arrays and `Frame.bonds` remain empty. New tool results separately advertise geometry-based estimates from the shared `lupi-bonds.molecular.v1` recipe, using the standalone viewer's Float32 coordinates and default tolerance. `bondCount` includes inferred covalent and coordination bonds; `contactCount` reports ionic contacts separately. `bondKinds`, `bondEvidence`, and `bondParameters` describe the estimate, not chemical ground truth or a confidence score. `sourceBondTopology: "not-provided"` preserves source provenance, and `bondOrders: "not-estimated"` makes the limitation explicit. Displayed atom IDs are generated from row order. Charge and spin are whole-structure provenance, not per-atom charges or inputs to this geometry-based recipe. Indexed-preview collections do not claim complete coverage of the wider OMol25 corpus.

The card labels the estimate and distinguishes covalent bonds, coordination, and ionic contacts. The **Ionic contacts** toggle changes visibility only: it does not change source geometry, the inferred graph, or chemical bond counts. Space fill hides connections. Older OMol25 result replays that did not advertise inference remain source-only; opening a fresh result is required to exercise this upgrade.

Use **PubChem** when the user names a specific compound or CID. `resolve_molecule` returns an exact, pinned PubChem structure reference; `show_molecule` renders source atoms, bond topology, and the source coordinate dimension. PubChem connectivity is not replaced by OMol25 inference. A PubChem 2D fallback is labeled as a depiction. Ambiguous identity and retrieval errors remain explicit.

Hover over an atom or connection on desktop to inspect it locally. Click or tap to pin details, or use the accessible **Inspect atom** selector and neighboring-atom controls. Explicit pins send inspection context tied to that card's structure reference; ordinary hovering does not. Orbit drags and multi-touch must not pin. **Close details** and Escape clear inspection. Distances are shown only where the source coordinate units support them, and inferred connections never acquire invented source bond orders.

The public ChatGPT route is separate from Lupi's existing `/mcp` control plane. All six plugin tools are read-only. They do not run simulations, access private files, or change saved molecules.

## Source locations

| Part | Path |
|---|---|
| OMol25 collection API | `apps/mcp-worker/src/scienceData.ts` |
| OMol25 plugin adapter | `apps/mcp-worker/src/chatgptOmol.ts` |
| PubChem parser | `packages/core/src/pubchem.ts` |
| Shared OMol25 frame, estimate, and summary | `packages/core/src/omol25/widget.ts` (collections, URLs and truth strings: `packages/core/src/omol25/`) |
| Shared bond recipe | `packages/core/src/bonds/` |
| MCP route, version constants, and tools | `apps/mcp-worker/src/chatgpt.ts` |
| Embedded viewer and inspection | `apps/chatgpt-widget/` |
| Portable package | `plugins/lupi-live/` |

The Worker fetches the built widget from its bound web assets at `/chatgpt-widget/index.html`. The web build copies that versioned asset into its output. The browser component receives source geometry in the tool result `_meta`; the model-visible result contains identity, provenance, counts, coverage, estimate parameters, and selected atom IDs. `renderStatus: "awaiting-component"` means the server prepared a view, not that ChatGPT rendered the iframe.

## Build and verify

Run from the repository root with Node 22.13+ and pnpm 9.0.0:

```bash
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level high
pnpm chatgpt:build
pnpm chatgpt:test
pnpm chatgpt:package --check
node --import tsx tools/verify-chatgpt-inspection.mts
pnpm chatgpt:verify --no-browser
```

The deterministic inspection verifier uses synthetic coordinate fixtures with the actual MCP server, SDK development host, and production widget. It checks rendered inferred connections, source-only bond arrays, desktop hover, mobile-emulated pinning, same-structure model context, drag separation, accessible inspection, and contact visibility. Its evidence is saved under `.verify-artifacts/chatgpt-inspection/`. It is not a live OMol25 retrieval, actual ChatGPT iframe, physical-phone, or WebGPU acceptance test.

`pnpm chatgpt:verify --no-browser` requires live OMol25 and PubChem upstream access. It checks the advertised v3 resource, empty OMol25 source bond arrays, and the complete inferred-bond summary against the shared recipe, while preserving the PubChem identity and connectivity checks. Upstream unavailability must be reported as a limitation or failure, never replaced with fixture evidence or counted as a pass.

`pnpm chatgpt:verify` additionally exercises the development MCP host in desktop and mobile Chromium lanes. Its rendered connection counts include chemical bonds plus only visible ionic contacts. It records evidence under `.verify-artifacts/chatgpt/`. Local SDK and browser checks do not prove an installed ChatGPT connection or a production Cloudflare deployment. See the historical [PubChem-only development receipt](chatgpt-plugin-verification.md) for the older branch's evidence; its test counts and release status do not describe this release.

## Installed-plugin acceptance

After the current commit is deployed and the HTTPS endpoint is verified, select the installed Lupi Live plugin in a new conversation. The portable package's `mcp.json` points to `https://lupi.live/chatgpt/mcp`. Try “Explore OMol25 neutral training molecules and show the first result,” then “Highlight oxygen in that same structure.” Open a fresh card rather than relying on an older result replay.

Verify the actual card in ChatGPT: the source row and collection must agree with the tool result, all source atoms must appear, and the card must label estimated bonds and ionic contacts separately. Hover on desktop or tap to pin on mobile; inspect an atom and a connection, confirm appropriate coordinates and distances, then toggle ionic contacts. Confirm that hiding contacts does not change chemical bond counts or source identity, and that an orbit drag does not pin details. Also exercise the atom selector, neighboring-atom inspection, close/clear, and Escape. Original OMol25 source bond arrays must remain empty even when inferred connections render.

A link to the Lupi website alone is not proof that the embedded viewer rendered. For PubChem, verify source CID, coordinate dimension, atom and source bond counts. Each follow-up may open a new card rather than changing an existing one. Record actual host and device coverage separately from Chromium emulation.

## Deployment boundary

The production Worker route is part of the Cloudflare build and deploy pipeline for `main`. Keep the widget and Worker build from the same commit: the Worker checks the `molecule-v3` widget marker before serving it. Before merging, require successful full LUPI CI, including build-test and mobile-testflight-source, ChatGPT widget checks, Apple packages, and dependency/security gates against the current PR head and current main, with no unresolved blocking reviews.

The package manifest and a passing local test do not activate the endpoint. After merging, verify the production Cloudflare deployment for that exact merge commit and successful custom-domain live checks for `lupi.live`, not merely a build or a `workers.dev` preview. Check deployed `tools/list`, `resources/list`, `resources/read`, OMol25 browse/open and inferred-bond metadata, PubChem lookup, and an installed ChatGPT card. Public directory submission has a separate review process and needs current listing metadata and an installed-host demo.
