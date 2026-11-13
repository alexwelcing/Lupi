# lupi.live: overview

Moved from the root [README](../README.md) on 2026-11-13, when the README was cut
to one screen. The text is unchanged; only link paths are adjusted for this folder.

Standalone LUPI molecular viewer repo. LUPI (lupi.live) opens structures and
LAMMPS dump files in a WebGPU-capable browser with no installation. Where the
browser has no WebGPU adapter, the viewer uses three.js's WebGL2 backend.

This repo owns the browser-native molecular viewer at `lupi.live`: the WebGPU
viewer app, shared viewer packages, parser/runtime packages, viewer verification
tools, Firebase viewer support, saved views, authentication contracts, and the
agent/MCP surface for loading and inspecting molecules.

The normative boundary is the
[Lupi product ownership contract](product-ownership-contract.md). It wins
when an older roadmap, campaign plan, branch, or overview conflicts with it.

It owns the lightweight `lupi.live` discovery/landing shell that opens the
viewer. It does not own the Lupine editorial/public-science front door at
`lupine.science`, the research corpus, Lean proofs, MLIP distillation policy, or
experiment execution. Those stay in the science control-plane and Library
repos.

## Boundary

Owns:

- `apps/web`: public LUPI viewer
- `apps/apple`: the native SwiftUI + RealityKit app for iPhone Pro and iPad Pro
  (bundle id `live.lupi.app`), a physics sandbox played against the room's
  LiDAR mesh
- `apps/mobile`: the earlier Expo Router iPhone app, frozen as a reference
  (owner decision D1, [docs/ar/decisions.md](ar/decisions.md))
- `packages/core`, `packages/parsers`, `packages/renderer`, `packages/scene`,
  `packages/ui`, `packages/ui-core`
- `functions`: viewer Firebase functions
- `firestore.rules`, `firestore.indexes.json`, `firebase.json`
- `tools`: the viewer smoke check, gallery checks, asset tools
- public gallery assets and viewer-owned manifests

Does not own:

- article bodies or Library shelves
- science claim decisions
- Lean proof source
- MLIP/Distill runtime policy
- `lupine.science` landing copy
- old `apps/lupi-studio` or nested marketing-site experiments

## Deploy Status

Production deploy is owned by this standalone repo. A merge to `main` is the
release: `.github/workflows/deploy-cloudflare.yml` builds the app and edge
Worker, deploys through the pinned Wrangler, and confirms `https://lupi.live`
reports the merged commit, then checks that `/` and its bundle load. Nothing
gates it; if `main` breaks, fix it and push again. That check is not proof that
the public product works. See the
[release truth contract](release-truth-contract.md).

## License

Code is MIT ([LICENSE](../LICENSE)). First-party prose, figures and data are
CC BY 4.0 ([LICENSE-CONTENT.md](../LICENSE-CONTENT.md),
[LICENSE-DATA.md](../LICENSE-DATA.md)). Third-party material keeps its own terms
([NOTICE.md](../NOTICE.md)). You can reuse our code (MIT) and our first-party
text and data (CC BY 4.0) with attribution and no share-alike obligations.

## More

- [Development](development.md)
- [Repository map](repository-map.md)
- [Privacy](privacy.md)
