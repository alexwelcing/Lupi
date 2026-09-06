# Release Checklist

Use this before promoting the standalone viewer or cutting over `lupi.live`.
The [product ownership contract](product-ownership-contract.md) defines what
Lupi owns; the [release truth contract](release-truth-contract.md) defines what
evidence is sufficient.

## Receipt identity and owners

- [ ] Exact integration Git SHA is recorded.
- [ ] Product decision owner and release/rollback operator are named.
- [ ] Identity/data, render/cost, and content owners are named where the change
      touches those surfaces.
- [ ] Every lane below is marked PASS, FAIL, NOT CHECKED, or BLOCKED; partial
      evidence is not summarized as production success.

| Lane | Status | Required receipt |
|---|---|---|
| Local | NOT CHECKED | exact source identity, tool versions, scoped acceptance results and scope rationale; clean final integration worktree |
| CI | NOT CHECKED | exact-SHA GitHub run URL, conclusion, and required jobs |
| Deploy | BLOCKED | v2 cutover authority plus run URL, immutable revision/version, bindings/config, and previous rollback target |
| Live API | BLOCKED | authorized promotion plus custom-domain health/version/bindings, distinct manifests, auth and relevant render/job/asset behavior |
| Public site | BLOCKED | authorized promotion plus discovery, loaded molecule/canvas, mobile controls, saved-view success/error, and relevant exported bytes |

Direct `workers.dev` evidence and `https://lupi.live` evidence are separate.
Source presence and screenshots are not deployment or functional proof.

## Workspace

Record the following full gates from exact-SHA CI/release-package receipts;
do not repeat them all locally. Local work runs the checks relevant to its diff.

- [ ] `pnpm install --frozen-lockfile` succeeds from a clean clone.
- [ ] `pnpm verify:product-contract` succeeds.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm-lock.yaml` matches `package.json`.
- [ ] CI uses pnpm 9, matching `packageManager`.
- [ ] No retired `apps/lupi-studio` or nested research-site app is present.
- [ ] The real `pnpm lint` gate and both production dependency audits run and
      pass for this exact SHA in CI/release-package; their source definitions
      alone are not evidence.

## Viewer Verification

Full regression belongs in CI. Candidate/public deployment checks use
`UI_TEST_URL=https://TARGET UI_TEST_EXPECT_HEALTH=true pnpm test:ui:release`.
Historical rollback targets retain their own recorded suite, including full UI.

```bash
pnpm test
pnpm test:ui
pnpm verify:mcp-bridge
pnpm verify:exports
```

- [ ] Homepage-to-viewer and desktop settings journeys pass.
- [ ] Mobile viewer settings journey passes.
- [ ] Edge and browser MCP manifests retain their reviewed, distinct contracts.
- [ ] Export controls return structurally and visually verified bytes for only
      the formats actually advertised by the relevant runtime.
- [ ] Gallery/search behavior is checked.
- [ ] Mobile controls smoke is run for UI-affecting changes.

## Firebase And Auth

- [ ] Firestore rules match saved-view and API-key behavior.
- [ ] Firestore indexes are current.
- [ ] Cloud Functions build/deploy path is viewer-only.
- [ ] Until the authenticated-agent capability gate passes, API-key UI/terminal
      auth and paid agent rendering remain documented as planned and execution
      remains dark.
- [ ] After that gate passes, scoped key/token lifecycle is tested with a designated
      canary identity and guaranteed revocation cleanup.
- [ ] Signed-out states are understandable and safe.

## Deploy

The v2 controller source does not authorize its own cutover. Mark Deploy, Live
API, and Public site **BLOCKED** until every cutover item and a separately
authorized production run are proven. Do not mark them NOT CHECKED when the
known authority prerequisite is absent.

### Cutover authority

- [ ] The Plan 022 freeze is freshly revalidated: the old workflow remains
      disabled, the legacy token is revoked, the legacy secret name is absent,
      and every still-rerunnable historical snapshot is unable to reach fresh
      authority.
- [ ] `lupi-production-read-v2`, `lupi-production-write-v2`, and
      `lupi-production-reanchor-v2` exist with reviewed protection rules and the
      exact job mapping asserted by the authority scanner.
- [ ] `LUPI_CLOUDFLARE_READ_TOKEN_V2` and
      `LUPI_CLOUDFLARE_WRITE_TOKEN_V2` are separately scoped to their literal
      environments; evidence records identifiers and scopes, never values.
- [ ] Protected `main`, its required-check ruleset, the active integrated
      workflow content/state, the closed-world current/historical authority
      scan, and the protected `LUPI_RELEASE_CUTOVER_RECEIPT_SHA256` value all
      match one separately approved non-secret cutover receipt.
- [ ] The reconciliation workflow is `active`, its newest self-contained
      checkpoint is no older than 30 days with at least seven days remaining,
      and its complete embedded rollback bundle validates.

### Owner dispatch and package boundary

- [ ] Production entry is a fresh first-attempt `workflow_dispatch` by exact
      owner `alexwelcing` from `refs/heads/main`.
- [ ] `target_sha` equals the workflow SHA and the repository API's current
      `main`; confirmation is exactly
      `DEPLOY <target_sha> WITH BOUNDED ROLLBACK`.
- [ ] The no-secret release-package job passes product-contract, lint, audit,
      build, unit, Worker, Functions, and controller gates and emits a closed
      digest-bound data-only package.
- [ ] Every write job starts clean: no checkout, project install/build/test,
      candidate execution, broad/dynamic secret access, or mutable tool. The
      write token appears only in the final closed Wrangler mutation step.

### Candidate, promotion, and durable receipts

- [ ] A full-SHA-tagged no-traffic version upload records the exact candidate
      version ID and immutable preview origin.
- [ ] Candidate-preview Live API verification and `release-smoke-v1` pass
      before promotion. This is not custom-domain or Public site PASS.
- [ ] A validated `lupi-release-intent-v1` records the prior/candidate versions,
      package and rollback-contract hashes, expected posture, and bounded
      rollback authorization before traffic changes.
- [ ] Immediately before promotion, the prior version is still the only active
      version and remains an eligible rollback target; immediately afterward,
      the candidate alone is active at 100%.
- [ ] Custom-domain Live API verification and `release-smoke-v1` pass after
      promotion for the same Worker version/Git SHA and matching entry bytes.
- [ ] A validated `lupi-release-outcome-v1` closes success, or a linked rollback
      resolution proves the prior version and its exact-source UI contract were
      restored. A rolled-back run remains a failed release.

### Reconciliation and operating discipline

- [ ] Release and reconciliation use the same queue-max, non-cancelling
      single-writer group; no older unresolved intent remains ahead of this run.
- [ ] Automatic weekly and `workflow_run` reconciliation paths are read-only.
      A rollback, refresh, or re-anchor uses a fresh exact-owner/current-main
      manual dispatch with its exact mode-specific confirmation.
- [ ] During repository inactivity, the owner checks reconciliation workflow
      state and checkpoint age at least every 30 days. If GitHub auto-disabled
      the weekly schedule, releases stop until the inspected workflow is
      explicitly re-enabled and an owner-only refresh succeeds.
- [ ] The receipt records the accepted single-owner residual risk: the controls
      cannot independently contain compromise of the one account that controls
      source and production authority.
- [ ] No routine Cloudflare dashboard/CLI deploy, traffic change, or secret
      change occurred. Break-glass work, including any use of the Cloud Run
      fallback, held both controllers and has separate authorization and proof.

## Live Verification

- [ ] The immutable candidate-preview report and post-promotion
      `https://lupi.live` report are retained separately and identify the same
      exact Git SHA and Worker version; preview PASS is not public PASS.
- [ ] `https://lupi.live` loads the intended revision.
- [ ] A built-in molecule opens.
- [ ] Gallery search works.
- [ ] NIST and OMol providers behave as expected.
- [ ] Saved views and API-key surfaces are checked.
- [ ] Export drawer works for the supported public formats.
- [ ] Public metadata, sitemap, social image, and `llms.txt` are current.
- [ ] The reachable Comparison Theater nonconformity is disabled, unmistakably
      labeled without unsupported performance claims, or backed by the required
      versioned evidence manifest.
- [ ] Mirrored `llms*.txt` and `brand.json` identify publisher, canonical source,
      source version/date, and synchronization provenance.

## Ownership-program capability prerequisites

- [ ] Correctness/security baseline proves real lint, dependency policy,
      regression tests, exact release identity, rollback, and custom-domain
      verification.
- [ ] Edge/render truth proves routing, bounded inputs, artifact identity,
      persistence, and delivery truth.
- [ ] Human-loop evidence proves inspect, measure, provenance, reset,
      save/reopen, and return behavior.
- [ ] Authenticated-agent evidence proves scoped identity and the bounded
      render/poll/retrieve/cache-hit loop.

An implementation plan may legitimately complete with unrelated lanes NOT
CHECKED, and a non-release merge may leave Deploy/Live API/Public site unchecked
under the decision matrix in the release truth contract. A production release
requires all five lanes to PASS; no capability may be claimed from source intent
alone.

## Source Split

- [ ] Science/control-plane repo no longer owns viewer deploy after cutover.
- [ ] Library links still point to `library.lupine.site`.
- [ ] Landing-site links still point to `lupine.science`.
- [ ] Any remaining old `atlas-view` naming is either historical documentation
      or tracked as cleanup.
