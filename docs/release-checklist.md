# Release Checklist

Use this before promoting the standalone viewer or cutting over `lupi.live`.

## Workspace

- [ ] `pnpm install --frozen-lockfile` succeeds from a clean clone.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm-lock.yaml` matches `package.json`.
- [ ] CI uses pnpm 9, matching `packageManager`.
- [ ] No retired `apps/lupi-studio` or nested research-site app is present.

## Viewer Verification

```bash
pnpm verify:standalone
pnpm verify:mcp-bridge
pnpm verify:exports
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

- [ ] `deploy-viewer.yml` is rooted in this repo and packages only viewer assets.
- [ ] Deploy workflow builds only viewer output.
- [ ] Old `atlas/deploy_slim.py` coupling is gone.
- [ ] Cloud Run service and region are correct.
- [ ] Traffic moves to the latest revision after smoke.
- [ ] Deploy telemetry posts to `glim-think` `/ops/report`.

## Live Verification

- [ ] `https://lupi.live` loads the intended revision.
- [ ] A built-in molecule opens.
- [ ] Gallery search works.
- [ ] NIST and OMol providers behave as expected.
- [ ] Saved views and API-key surfaces are checked.
- [ ] Export drawer works for the supported public formats.
- [ ] Public metadata, sitemap, social image, and `llms.txt` are current.

## Source Split

- [ ] Science/control-plane repo no longer owns viewer deploy after cutover.
- [ ] Library links still point to `library.lupine.site`.
- [ ] Landing-site links still point to `lupine.science`.
- [ ] Any remaining old `atlas-view` naming is either historical documentation
      or tracked as cleanup.
