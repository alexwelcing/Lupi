# Release Checklist

Use this before promoting `lupi.live`. Cloudflare Worker `lupi-edge` is the canonical production runtime; Cloud Run is manual fallback only.

## Workspace

- [ ] `pnpm install --frozen-lockfile` succeeds from a clean clone.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm-lock.yaml` matches `package.json`.
- [ ] CI uses pnpm 9, matching `packageManager`.
- [ ] No retired `apps/lupi-studio` or nested research-site app is present.

## Viewer Verification

```bash
pnpm cloudflare:build
pnpm cloudflare:test
pnpm verify:standalone
pnpm verify:mcp-bridge
pnpm verify:asset-quality
pnpm verify:operational-contract
```

- [ ] Controls smoke passes.
- [ ] Study Lens smoke passes.
- [ ] MCP bridge reports expected auth state.
- [ ] Export controls expose expected formats.
- [ ] Gallery/search behavior is checked.
- [ ] Mobile controls smoke is run for UI-affecting changes.

## Firebase And Auth

- [ ] Firestore rules match saved-view and API-key behavior.
- [ ] Firestore indexes are current.
- [ ] Cloud Functions build/deploy path is viewer-only.
- [ ] API-key exchange is tested with a staging or real test key.
- [ ] Signed-out states are understandable and safe.

## Deploy

- [ ] `deploy-cloudflare.yml` deploys Cloudflare Worker `lupi-edge` from `apps/mcp-worker`.
- [ ] Cloudflare build and Worker tests pass before deploy.
- [ ] `lupi.live` routes to the Cloudflare Worker, not an automatic Cloud Run push deploy.
- [ ] Cloud Run workflow is manually triggered fallback only and its service/region are known.
- [ ] Old `atlas/deploy_slim.py` coupling is gone.
- [ ] Rollback target/version is recorded before promotion.

## Live Verification

- [ ] `https://lupi.live/health` reports the intended Cloudflare Worker readiness.
- [ ] `https://lupi.live` loads the intended Cloudflare deployment.
- [ ] A built-in molecule opens.
- [ ] Gallery search works.
- [ ] NIST and OMol providers behave as expected.
- [ ] Saved views, signed-out behavior, and API-key surfaces are checked.
- [ ] MCP `initialize` and `tools/list` work against `/mcp`.
- [ ] A deterministic render request returns a stable job/cache response.
- [ ] Export drawer works for the supported public formats.
- [ ] Public metadata, sitemap, social image, and `llms.txt` are current.

## Source Split

- [ ] Science/control-plane repo no longer owns viewer deploy after cutover.
- [ ] Library links still point to `library.lupine.site`.
- [ ] Landing-site links still point to `lupine.science`.
- [ ] Any remaining old `atlas-view` naming is either historical documentation
      or tracked as cleanup.
