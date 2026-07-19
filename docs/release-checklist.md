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
| Local | NOT CHECKED | clean worktree, exact SHA, install/build/real lint/tests/Worker/Playwright results |
| CI | NOT CHECKED | exact-SHA GitHub run URL, conclusion, and required jobs |
| Deploy | NOT CHECKED | run URL, immutable revision/version, bindings/config, previous rollback target |
| Live API | NOT CHECKED | custom-domain health/version/bindings, distinct manifests, auth and relevant render/job/asset behavior |
| Public site | NOT CHECKED | discovery, loaded molecule/canvas, mobile controls, saved-view success/error, and relevant exported bytes |

Direct `workers.dev` evidence and `https://lupi.live` evidence are separate.
Source presence and screenshots are not deployment or functional proof.

## Workspace

- [ ] `pnpm install --frozen-lockfile` succeeds from a clean clone.
- [ ] `pnpm verify:product-contract` succeeds.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm-lock.yaml` matches `package.json`.
- [ ] CI uses pnpm 9, matching `packageManager`.
- [ ] No retired `apps/lupi-studio` or nested research-site app is present.
- [ ] A real, non-vacuous lint gate exists and passes; the root script name
      alone is not accepted as lint evidence.

## Viewer Verification

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

- [ ] `deploy-cloudflare.yml` builds the web app and edge Worker from this repo.
- [ ] Cloudflare secrets are available through the protected `prod` environment.
- [ ] Old `atlas/deploy_slim.py` coupling is gone.
- [ ] Wrangler returns a direct `workers.dev` deployment URL.
- [ ] Exact Worker/Git version, prior rollback target, structured readiness, and
      deployed Playwright checks pass.
- [ ] The manual Cloud Run fallback still tests its candidate before routing traffic.

## Live Verification

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
