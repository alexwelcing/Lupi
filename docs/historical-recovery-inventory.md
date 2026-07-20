# Historical recovery inventory

Snapshot date: 2026-07-19

This inventory compares the extracted `alexwelcing/Lupi` repository with all
fetched `origin/*` branches and the 61 branch heads from the original
`alexwelcing/lupine` repository. The repositories have no merge base, so an
original branch is evidence and source material, not a merge candidate. Recover
work path-selectively against the current architecture and prove its behavior.

The current recovery baseline deliberately excludes the active Plan 022 and
Plan 023 changes from the historical candidate list.

## Recover next

| Priority | Capability | Historical evidence | Current gap | Recovery contract |
|---|---|---|---|---|
| P0 | Live distance, angle, and dihedral measurement | `7e26da85`, `e66fa866`; the older panel at `ea22fa1c` also had history and CSV export | Current Lupi has no measurement component even though current UX and trailer documentation promise measurement | Reimplement on the current selection/store architecture. Add pure geometry tests, explicit units, source/frame provenance, pinning, and a defined saved-view policy. Do not transplant the obsolete panel wholesale. |
| P0 | Real render executor | `origin/shop-route`, especially `apps/render-backend` at `17bc7d00` and `eb2ca630` | The edge Worker exposes a `RENDERER_ENDPOINT` contract but no configured executor | Port the backend as PNG-only first. Require its bearer token, cap and validate request bodies, validate input state, and verify the returned byte signature and MIME type before storage. Add formats only when each format is truly implemented. |
| P0 | API-key account UI and caller-owned render/retrieve | `979b1298` added `ApiKeyManager.tsx` and `apiKeys.ts`; `4839079b` deleted the unwired UI. `advisor/013` contains a useful Firebase verification primitive, not a complete edge-auth design. | Functions, rules, and key documentation remain, but users cannot manage keys in the current UI. The Worker still has an optional global shared secret and public asset retrieval. | Integrate only the key client/manager into the existing `LupiAgentDock` account surface. Then add edge-verifiable caller identity, owner IDs on jobs/assets, and authenticated or signed retrieval. Do not restore the duplicate historical settings shell or claim Functions-only verification secures the Worker. |
| P1 | Save/reopen ownership proof | Feature code from `871e734c` is already present. Lost verifiers are in `afce92dd`, `e967e4d7`, and `b6bb6a77`. | The product can save and reopen, but the extracted repository lost authenticated end-to-end proof, ownership rejection, and cleanup verification. | Adapt the latest historical verifier to current routes and UI. Keep it opt-in for staging/release credentials and prove save, reopen, unauthorized rejection, and cleanup. Recover the tests, not duplicate feature code. |
| P1 | Inspect and provenance proof | Study Lens remains current; `tools/verify-study-lens.mjs` evolved from `04b76cf7` through `4a184dc1`. | Visible source-versus-rendered bond truth and printable provenance no longer have end-to-end coverage. | Port the verifier into the current Playwright harness and retain both source-truth and visible-output assertions. |
| P2 | Adaptive viewer performance | Original tip `6a67f870` added adaptive device DPR and computed atom bounds for frustum culling. | Current `ViewerCanvas.tsx` has no adaptive DPR cap and `AtomsOptimized.tsx` disables frustum culling. | Port DPR and bounds as separate changes with desktop/mobile performance measurements and visual snapshots. Review historical tone-mapping changes independently for image parity. |

## Preserve as product boundaries

| Lane | Historical evidence | Ownership decision |
|---|---|---|
| Commerce | `origin/claude/lammps-research-support-q38hsl`, including `434de611`, `51b0e51a`, `4f22aefe`, `b21de6ab`, and `161280d2` | Extract pure print composition, art direction, and provider adapters into the commerce repository or service. Shopify, Gooten, orders, and checkout do not belong in the viewer. Lupi should emit a versioned rendered-artifact and provenance contract. |
| Research execution | Examples include `cf6f9792`, `5f54a380`, `d7b075c1`, and `521af2b6` | Keep Glim Think, cloud runners, benchmarks, and research-site execution outside Lupi. Preserve only a versioned evidence/artifact ingestion seam; the current `MlipArtifactLoader.ts` is the right direction. |

## Explicit rejections

- Do not merge `advisor/010-rate-limiter-xff` as written. It selects the
  right-most `X-Forwarded-For` value, which is the Google load balancer under
  Google's documented append order, while the current left-most strategy can
  trust a spoofed prefix. Confirm the exact Firebase Functions proxy path, then
  use a trusted platform address or the verified client hop with spoof-prefix
  tests.
- Do not restore the historical RDF, MSD, Voronoi, phonon, or GNN "analysis"
  panels. They toggled property names without implementing the computations
  their labels claimed.
- Do not merge an original repository branch or the render backend wholesale.
  The backend currently returns PNG bytes for requests labeled as JPEG, WebP,
  GLB, or USDZ, treats its token as optional, accepts unbounded bodies, and
  ignores most viewer state. The current Worker trusts the returned MIME type,
  so that implementation could persist mislabeled bytes.
- Do not restore the duplicate historical Firebase settings UI. Integrate the
  useful key-management primitive into the current account surface.

## Already represented or superseded

- Homepage, gallery, knowledge, and most deployment work is merged or
  content-superseded in the extracted repository.
- `origin/claude/mobile-viewer-ui-overhaul-qz7y6k` is represented by the active
  Plan 023 mobile playback work.
- The 13 local `worktree-agent-*` branches all point at one old commit; they are
  not independent feature candidates.

## Recovery acceptance rule

Every recovered capability must identify its current product owner and truth
lane, be rebuilt against current contracts, include focused regression tests,
and pass the repository release gates. A historical commit hash establishes
provenance; it does not establish current correctness.
