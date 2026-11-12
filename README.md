# lupi.live

Standalone LUPI molecular viewer repo. LUPI (lupi.live) opens structures and
LAMMPS dump files in a WebGPU-capable browser with no installation. Where the
browser has no WebGPU adapter, the viewer uses three.js's WebGL2 backend.

This repo owns the browser-native molecular viewer at `lupi.live`: the WebGPU
viewer app, shared viewer packages, parser/runtime packages, viewer verification
tools, Firebase viewer support, saved views, authentication contracts, and the
agent/MCP surface for loading and inspecting molecules.

The normative boundary is the
[Lupi product ownership contract](docs/product-ownership-contract.md). It wins
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
  (owner decision D1, [docs/ar/decisions.md](docs/ar/decisions.md))
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
[apps/apple/README.md](apps/apple/README.md) is the how-to,
[docs/ar/status.md](docs/ar/status.md) the owner's checklist, and AGENTS.md,
"Native Apple app", the summary for agents.

`apps/mobile`, the Expo SDK 57 app, is frozen as a reference. The
[M2 MacBook Air handoff guide](docs/mobile-macbook-air-handoff.md) describes
that app, not `apps/apple`.

## Terminal Authentication (planned—not yet shipped)

The tracked repository does not currently ship a tested `lupi:auth` package
script or a verified API-key management panel in the active Account shell. Do
not direct users or agents to a terminal login flow yet.

The existing Functions/data model and intended HTTP exchange are retained as
implementation inventory in [docs/api-keys.md](docs/api-keys.md). The operator's
authenticated-agent golden-path work (operator Plan 026) owns reconciling
the local helper, replacing broad identity exchange with the scoped agent
contract, testing the UI/client, and proving the live flow before this section
may become user instructions.

## Optional Local Checks

CI is one pull-request build check, and a push to `main` deploys (see
[docs/ci-trigger-policy.md](docs/ci-trigger-policy.md)). These run only when
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

## App Map

- `apps/web`: Vite/React app that ships to `lupi.live`
- `apps/mcp-worker`: the Cloudflare edge Worker (`lupi-edge`) that serves the
  built web app, MCP at `/mcp` and `/chatgpt/mcp`, and the `/v1` routes;
  deployed on every merge to `main`
- `apps/apple`: the native iPhone and iPad app and its Swift packages
- `apps/mobile`: Expo Router iPhone app, frozen as a reference
- `apps/chatgpt-widget`: the ChatGPT MCP App resource
  `ui://lupi/molecule-v2.html`, built as one HTML file that the web build
  copies to `/chatgpt-widget/index.html`
- `apps/render-backend`: the Cloud Run container behind the Worker's legacy-v0
  PNG render handoff; it drives the built viewer in Chromium and is deployed
  by `.github/workflows/deploy-render-backend.yml`
- `apps/lupine-app`: the Lupine Science self-serve service (Stripe
  subscriptions on the shared Firebase account); not deployed from this
  repo's workflows, only by hand with `gcloud builds submit`
- `apps/remotion-trailer`: media/rendering support app
- `packages/parsers`: LAMMPS/XYZ parsing and streaming contracts
- `packages/parsers/wasm`: Rust/WASM parser build
- `packages/renderer`: raw WebGPU pieces; the viewer uses only its optional
  bond-detection compute pass (`BondPipeline`)
- `packages/scene`: 3D scene components and the TSL impostor materials
- `packages/ui`: viewer shell, panels, gallery, search, auth, exports
- `packages/ui-core`: `@lupine/ui`, design tokens and a small React component
  kit; the web app imports its tokens (`theme/design-system.css`), and no
  mounted viewer surface uses its components
- `packages/core`: shared viewer types and utilities
- `packages/assessment`: rendering-free grading of atomistic assets, behind
  `lupi.assess_asset` in the browser bridge and on the edge
- `packages/nist`: the NIST Interatomic Potentials catalog loader and queries
  behind the Library's potentials collection and the NIST search provider;
  `pnpm nist:build` writes the catalog it reads (`apps/web/public/nist`)
- `functions`: Firebase custom-token/API-key and viewer backend helpers

## Deploy Status

Production deploy is owned by this standalone repo. A merge to `main` is the
release: `.github/workflows/deploy-cloudflare.yml` builds the app and edge
Worker, deploys through the pinned Wrangler, and confirms `https://lupi.live`
reports the merged commit, then checks that `/` and its bundle load. Nothing
gates it; if `main` breaks, fix it and push again. That check is not proof that
the public product works. See the
[release truth contract](docs/release-truth-contract.md).

## Privacy

The public page is [`apps/web/public/privacy/index.html`](apps/web/public/privacy/index.html)
(`https://lupi.live/privacy/`, linked from the landing footer). In short, from
the code:

- **Visit counts**: built pages load the first-party, cookieless
  `/audience.js` tracker (`apps/web/vite.config.ts`,
  `apps/mcp-worker/src/audience-tracker.ts`). Its IDs live in page memory only.
  It sends page views with IDs stripped from the path, the referrer host, a
  device class and allowlisted action names. It sends nothing under Global
  Privacy Control or Do Not Track. The Worker (`apps/mcp-worker/src/audience.ts`)
  forwards a reduced event, a coarse browser class and Cloudflare's request
  metadata to the `audience-events` service binding, which is not in this repo.
- **No Google Analytics**: `packages/ui/src/analytics/firebaseSink.ts` is not
  imported anywhere, and the deploy sets `VITE_FIREBASE_ANALYTICS_ENABLED=false`.
- **Sign-in is optional** (Google or GitHub through Firebase Authentication)
  and is needed only to save views. Saved views live in Firestore
  (`lupiViews`). A small structure opened from a local file is stored inline
  in the view.
- **One first-party cookie**: `lupi_viewer_auth=1` (30 days, a signed-in hint).
  Preferences and Lupi Daily results stay in local/session storage.
- **Input sent to other services**: molecule-name lookups go from the browser
  to PubChem. Command-palette and switcher text go through the Worker to
  TypeSafe's Jev (`TYPESAFE_API_KEY`). Photo scan goes through the Worker to
  Hugging Face (`HF_TOKEN`) and Jev. Without those keys the routes answer
  `{ configured: false }`.

What the collector service stores, and how long Cloudflare and Firebase keep
logs, is set outside this repo.

## License

Code is MIT ([LICENSE](LICENSE)). First-party prose, figures and data are
CC BY 4.0 ([LICENSE-CONTENT.md](LICENSE-CONTENT.md),
[LICENSE-DATA.md](LICENSE-DATA.md)). Third-party material keeps its own terms
([NOTICE.md](NOTICE.md)). You can reuse our code (MIT) and our first-party
text and data (CC BY 4.0) with attribution and no share-alike obligations.

## Docs

- [LUPINE.md](LUPINE.md): how this repo fits the Lupine constellation
- [docs/product-ownership-contract.md](docs/product-ownership-contract.md): normative product boundary
- [docs/release-truth-contract.md](docs/release-truth-contract.md): what a check proves, and what it does not
- [docs/extraction-packet.md](docs/extraction-packet.md): original split plan
- [docs/api-keys.md](docs/api-keys.md): legacy API-key backend inventory and Plan 026 target
- [docs/lupi-mcp-roadmap.md](docs/lupi-mcp-roadmap.md): agent/MCP roadmap
- [docs/operations.md](docs/operations.md): local, CI, deploy, and live checks
- [docs/deploy-cutover.md](docs/deploy-cutover.md): production deploy split
- [docs/release-checklist.md](docs/release-checklist.md): what to look at before and after a release
- [docs/ar/README.md](docs/ar/README.md): the native Apple app's plan, decisions, contracts and status
- [docs/mobile-macbook-air-handoff.md](docs/mobile-macbook-air-handoff.md): Apple Silicon handoff for the frozen Expo app
