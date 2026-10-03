# Lupi Live in ChatGPT

The Lupi ChatGPT plugin connects to the public, read-only Streamable HTTP MCP endpoint at `https://lupi.live/chatgpt/mcp`. Its interactive viewer is a self-contained MCP App resource, `ui://lupi/molecule-v2.html`. The portable package lives in `plugins/lupi-live/`.

## Source choice

Use **OMol25** for research molecule discovery. The plugin advertises the complete public neutral training collection (34,335,828 indexed rows), complete neutral validation, and three explicitly labeled indexed previews of larger collections. `list_omol25_collections` reports coverage. `search_omol25` pages or searches one collection by text or exact formula and returns source row indexes. `open_omol25` loads the selected row's source 3D XYZ coordinates and creates a pinned structure reference. `show_molecule` can reuse that reference for highlights or display changes.

The OMol25 conversion exposed by Lupi has atomic coordinates but no source bond table. The viewer draws source atoms without adding inferred bonds. Its displayed atom IDs are generated from row order. The card and model-visible tool result state both limits. The additional indexed-preview collections do not claim complete coverage of the wider OMol25 corpus.

Use **PubChem** when the user names a specific compound or CID. `resolve_molecule` returns an exact, pinned PubChem structure reference; `show_molecule` renders source atoms, bond topology, and the source coordinate dimension. A PubChem 2D fallback is labeled as a depiction. Ambiguous identity and retrieval errors remain explicit.

The public ChatGPT route is separate from Lupi's existing `/mcp` control plane. All five plugin tools are read-only. They do not run simulations, access private files, or change saved molecules.

## Source locations

| Part | Path |
|---|---|
| OMol25 collection API | `apps/mcp-worker/src/scienceData.ts` |
| OMol25 plugin adapter | `apps/mcp-worker/src/chatgptOmol.ts` |
| PubChem parser | `packages/core/src/pubchem.ts` |
| Shared OMol25 frame | `packages/core/src/omol25.ts` |
| MCP route and tools | `apps/mcp-worker/src/chatgpt.ts` |
| Embedded viewer | `apps/chatgpt-widget/` |
| Portable package | `plugins/lupi-live/` |

The Worker fetches the built widget from its bound web assets at `/chatgpt-widget/index.html`. The web build copies that versioned asset into its output. The browser component receives source geometry in the tool result `_meta`; the model-visible result contains identity, provenance, counts, coverage, and selected atom IDs. `renderStatus: "awaiting-component"` means the server prepared a view, not that ChatGPT rendered the iframe.

## Build and verify

Run from the repository root with Node 22.13+ and pnpm 9:

```bash
pnpm install --frozen-lockfile
pnpm chatgpt:build
pnpm chatgpt:test
pnpm chatgpt:package --check
pnpm chatgpt:verify --no-browser
```

`pnpm chatgpt:verify` additionally exercises the development MCP host in desktop and mobile Chromium lanes. It records evidence under `.verify-artifacts/chatgpt/`. Local SDK and browser checks do not prove an installed ChatGPT connection or a production Cloudflare deployment. See the historical [PubChem-only development receipt](chatgpt-plugin-verification.md) for the older branch's evidence; its test counts and release status do not describe this release.

## Connect in ChatGPT

After the current branch is deployed and the HTTPS endpoint responds, enable Developer mode in ChatGPT's connector settings and add a custom MCP connector using `https://lupi.live/chatgpt/mcp`. Choose Lupi Live in a new conversation. Try “Explore OMol25 neutral training molecules and show the first result,” then “Highlight oxygen in that same structure.” The plugin package `mcp.json` points to the same endpoint for portable installation.

Verify the actual card in ChatGPT: the source row and collection must agree with the tool result, all source atoms must appear, controls must work, and OMol25 bonds must remain absent. A link to the Lupi website alone is not proof that the embedded viewer rendered. For PubChem, verify source CID, coordinate dimension, atom and bond counts. Each follow-up may open a new card rather than changing an existing one.

## Deployment boundary

The production Worker route is part of the Cloudflare build and deploy pipeline for `main`. Keep the widget and Worker build from the same commit: the Worker checks the `molecule-v2` widget marker before serving it. The package manifest and a passing local test do not activate the endpoint; check the deployed `tools/list`, `resources/read`, OMol25 browse/open, PubChem lookup, and an installed ChatGPT card after deployment. Public directory submission has a separate review process and needs current listing metadata and an installed-host demo.
