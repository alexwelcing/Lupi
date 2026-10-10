# CI trigger policy

By owner decision (2026-10-09) CI is cut to the bone. A pull request gets one
build check; a push to `main` is the release and waits on nothing. If `main`
breaks, fix it and push again.

| Workflow | Runs on | Does |
|---|---|---|
| `ci.yml` (job `build-test`) | every pull request; manual dispatch | `pnpm install --frozen-lockfile`, `pnpm build`, and a pinned-Wrangler `versions upload --dry-run` (about 3 min). No tests, lint, audit or Playwright. |
| `deploy-cloudflare.yml` | push to `main`; manual dispatch | Builds, runs `wrangler deploy`, waits for `https://lupi.live/health` to report the commit, then checks that `/` and its `/assets/index-*.js` load. |
| `apple.yml` | pull requests touching `apps/apple/**` or `tools/apple/**`; manual dispatch | `swift test` in the Swift packages, then parse and type-check the app sources. |
| `mobile.yml` | pull requests touching `apps/mobile/**`; manual dispatch | The frozen Expo app's TestFlight source check. |
| `chatgpt-widget.yml` | pull requests touching the widget, its Worker routes or `plugins/lupi-live/**`; manual dispatch | `pnpm chatgpt:test`, `pnpm chatgpt:build`, the widget's inspection check in a sandboxed MCP host, `pnpm chatgpt:package --check`. |
| `deploy-render-backend.yml` | push to `main` touching `apps/render-backend/**`; otherwise manual dispatch | Rebuilds and deploys the Cloud Run render backend. |

Outside those path-filtered workflows, tests, lint and the browser checks
are optional local tools: `pnpm test`,
`pnpm lint`, `pnpm test:ui` (release smoke) and `pnpm verify:viewer-smoke`.
Dependabot alerts in the repository's GitHub settings replace the old
dependency-audit gate.
