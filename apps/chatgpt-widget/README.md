# Lupi Live embedded viewer v0.3.0

The self-contained MCP Apps resource is `ui://lupi/molecule-v3.html`. It reuses
LupiCanvas, AtomsOptimized and Bonds, including WebGL2 fallback.

OMol25 coordinates and empty source bond tables remain untouched. The server
and component run the released `@atlas/core/bonds` Molecular v1 recipe on the
same Float32 coordinates. The component checks every summary field before
rendering. Covalent bonds are solid, coordination dashed, ionic contacts dotted.
Contacts are optional and never included in the scientific bond count. No bond
orders are estimated. PubChem still uses its own source connection table.
Legacy v2 tool-result replays remain atom-only rather than silently contradicting
their recorded model summary.

Hover over an atom or bond to inspect it. Click/tap to pin; choose an atom with
the keyboard selector or close with Escape. Atom details identify source versus
row-generated IDs, element, coordinates, and typed neighbors. Bond details give
lengths only for 3D coordinates. Drags and multi-touch gestures do not pin.
Hover is local, with no tool or model calls; explicit pinning publishes context
using the same card's structureRef. New results and Reset clear inspection.

The component makes no external asset, account or analytics requests. It uses
host openLink and feature-detected expansion. Graphics failure preserves source
identity and links. Build and tests are not actual ChatGPT host acceptance.

```sh
pnpm chatgpt:build
pnpm chatgpt:test
pnpm chatgpt:verify
```
