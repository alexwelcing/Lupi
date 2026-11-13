# lupi.live: development

Moved from the root [README](../README.md) on 2026-11-13, when the README was cut
to one screen. The text is unchanged; only link paths are adjusted for this folder.
Agent instructions are in [AGENTS.md](../AGENTS.md).

## Quick Start

Use Git Bash for Node tasks on Windows.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open `http://localhost:5173`.

## iPhone and iPad development

The iPhone and iPad app is `apps/apple`: native SwiftUI + RealityKit, bundle id
`live.lupi.app`, iOS 26.0, for iPhone Pro and iPad Pro. Its pure-Swift packages
(LupiKit, LupiScale, LupiGame, LupiCloud) build and test on Linux with
`swift test`. The app itself builds only in Xcode on a Mac:

```bash
brew install xcodegen
cd apps/apple && xcodegen generate && open Lupi.xcodeproj
```

Nothing has been compiled against Apple's SDK or run on a device yet.
[apps/apple/README.md](../apps/apple/README.md) is the how-to,
[docs/ar/status.md](ar/status.md) the owner's checklist, and AGENTS.md,
"Native Apple app", the summary for agents.

`apps/mobile`, the Expo SDK 57 app, is frozen as a reference. The
[M2 MacBook Air handoff guide](mobile-macbook-air-handoff.md) describes
that app, not `apps/apple`.

## Terminal Authentication (planned—not yet shipped)

The tracked repository does not currently ship a tested `lupi:auth` package
script or a verified API-key management panel in the active Account shell. Do
not direct users or agents to a terminal login flow yet.

The existing Functions/data model and intended HTTP exchange are retained as
implementation inventory in [docs/api-keys.md](api-keys.md). The operator's
authenticated-agent golden-path work (operator Plan 026) owns reconciling
the local helper, replacing broad identity exchange with the scoped agent
contract, testing the UI/client, and proving the live flow before this section
may become user instructions.

## Optional Local Checks

CI is one pull-request build check, and a push to `main` deploys (see
[docs/ci-trigger-policy.md](ci-trigger-policy.md)). These run only when
you run them:

```bash
pnpm test
pnpm lint
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm verify:viewer-smoke
pnpm test:ui
```

`pnpm verify:viewer-smoke` drives the built app in the WebGL2 lane (home,
caffeine, an export, the renderer fallback; about a minute) and writes under
`.verify-artifacts/viewer-smoke/`. `pnpm test:ui` runs the one release smoke,
`tests/ui/release-smoke.spec.ts`, against the local build. Against a deployed
origin:

```bash
UI_TEST_URL=https://lupi.live UI_TEST_EXPECT_HEALTH=true pnpm test:ui
```

Playwright writes failure diagnostics under `playwright-report/` and
`test-results/`. To look at your own change, write a scratch Playwright script
and don't commit it.

## More

- [Overview](overview.md)
- [Repository map](repository-map.md)
- [Privacy](privacy.md)
