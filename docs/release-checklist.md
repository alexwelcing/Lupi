# Release Checklist

Use this when a change deserves a careful look before or after it ships.
Nothing here gates a merge or a deploy: a push to `main` deploys, and if it
breaks, fix it and push again (owner decision, 2026-10-09). The
[product ownership contract](product-ownership-contract.md) defines what Lupi
owns; the [release truth contract](release-truth-contract.md) says what each
check proves. Keep no receipts; say in the pull request or the chat what you
checked.

## Before merging

- [ ] The pull request's `build-test` check passes (frozen install,
      `pnpm build`, the Worker's Wrangler dry run).
- [ ] `pnpm-lock.yaml` matches `package.json`.
- [ ] CI uses pnpm 9, matching `packageManager`.
- [ ] No retired `apps/lupi-studio` or nested research-site app is present.
- [ ] The local checks that help the diff ran, and you say which:
      `pnpm test`, `pnpm lint`, `pnpm verify:viewer-smoke`, `pnpm test:ui`,
      or a scratch Playwright script you did not commit.

## Viewer

Look by hand or with a scratch script when the change touches these:

- [ ] Homepage-to-viewer and desktop settings journeys work.
- [ ] Mobile viewer settings work.
- [ ] Edge and browser MCP manifests retain their reviewed, distinct contracts.
- [ ] Export controls return working bytes for only the formats actually
      advertised by the relevant runtime.
- [ ] Gallery/search behavior is checked.

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

- [ ] The push's `deploy-cloudflare.yml` run is green: `https://lupi.live/health`
      reports the commit, and `/` and its `/assets/index-*.js` load.
- [ ] If `main` broke, the fix or revert is pushed and its run is green.
- [ ] Firebase Functions, rules and indexes are deployed separately when
      touched.

## Live Verification

After the deploy, when the change touches them:

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

`UI_TEST_URL=https://lupi.live UI_TEST_EXPECT_HEALTH=true pnpm test:ui` runs the
release smoke against the live site.

## Ownership-program capability prerequisites

- [ ] Edge/render truth proves routing, bounded inputs, artifact identity,
      persistence, and delivery truth.
- [ ] Human-loop evidence proves inspect, measure, provenance, reset,
      save/reopen, and return behavior.
- [ ] Authenticated-agent evidence proves scoped identity and the bounded
      render/poll/retrieve/cache-hit loop.

No capability may be claimed from source intent alone.

## Source Split

- [ ] Science/control-plane repo no longer owns viewer deploy after cutover.
- [ ] Library links still point to `library.lupine.site`.
- [ ] Landing-site links still point to `lupine.science`.
- [ ] Any remaining old `atlas-view` naming is either historical documentation
      or tracked as cleanup.
