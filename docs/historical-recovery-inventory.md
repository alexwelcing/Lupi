# Historical recovery inventory

Snapshot date: 2026-07-20

This inventory compares the extracted `alexwelcing/Lupi` repository with all
fetched `origin/*` branches and the 61 branch heads from the original
`alexwelcing/lupine` repository. The repositories have no merge base, so an
original branch is evidence and source material, not a merge candidate. Recover
work path-selectively against the current architecture and prove its behavior.

The current recovery baseline deliberately excludes the active Plan 022 and
Plan 023 changes from the historical candidate list.

## Recovered in the current candidate

| Capability | Historical lineage | Current source implementation | Remaining boundary or proof |
|---|---|---|---|
| Truthful distance and angle measurement | `7e26da85` introduced live distance/angle/dihedral visualization; `e66fa866` added pinned measurements; `44657022` removed both measurement surfaces during the visual/export overhaul. The older `ea22fa1c` panel also carried history and CSV export. | Rebuilt against the current R3F/Three.js picker, scene, and store. The current slice measures distance or angle on an exact resident source frame, tracks atoms by source ID or guaranteed source order when available, falls back honestly to capture-frame row identity, labels Å only when source semantics prove it, states that minimum-image/PBC treatment is absent, renders the geometry in-scene, and saves/reopens the measurement definition rather than treating a derived number as source evidence. | End-of-development local/CI evidence is still pending. Dihedrals, multiple pinned measurements/history, CSV export, minimum-image/triclinic PBC treatment, and source-content drift detection are deferred rather than implied. |
| Authenticated legacy PNG executor | `origin/shop-route`, especially `apps/render-backend` at `17bc7d00` and `eb2ca630`, supplied architectural lessons but was not imported wholesale. | A new bounded `apps/render-backend` and Worker path implement authenticated synchronous template/procedural opaque-PNG execution, independent response validation, private R2 job/provenance/artifact persistence, and authenticated retrieval. The profile remains visibly `legacy-v0`; `RenderRequestV1` remains validation-only. | Production activation requires private production/preview buckets, the backend endpoint, distinct caller/renderer secrets, authorized deployment, and candidate/custom-domain live proof. No source-state statement is a deployment receipt. |

## Recover next

| Priority | Capability | Historical evidence | Current gap | Recovery contract |
|---|---|---|---|---|
| P0 | API-key account UI and caller-owned render/retrieve | `979b1298` added `ApiKeyManager.tsx` and `apiKeys.ts`; `4839079b` deleted the unwired UI. `advisor/013` contains a useful Firebase verification primitive, not a complete edge-auth design. | The owner-operated legacy lane now fails closed behind one global caller secret and private retrieval, but users still cannot manage scoped keys, jobs/assets have no per-user ownership contract, and paid or multi-user execution remains dark. | Integrate only the key client/manager into the existing `LupiAgentDock` account surface. Then replace the operator secret for user traffic with edge-verifiable scoped caller identity, owner IDs on jobs/assets, limits, revocation, and authenticated or signed retrieval. Do not restore the duplicate historical settings shell or claim Functions-only verification secures the Worker. |
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
- Do not merge an original repository branch or its historical render backend
  wholesale. That historical backend returned PNG bytes for requests labeled
  as JPEG, WebP, GLB, or USDZ, treated its token as optional, accepted unbounded
  bodies, and ignored most viewer state; its paired Worker trusted the returned
  MIME type. The current candidate instead uses a newly bounded opaque-PNG-only
  backend and independently validates the renderer response before private
  persistence. That selective recovery does not make the rejected historical
  implementation safe to merge.
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
