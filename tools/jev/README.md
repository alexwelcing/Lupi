# Lupi × Jev command lab

An opt-in local demo that turns one natural-language viewer request into an existing typed Lupi command. This does not change the production viewer, add a public endpoint, deploy a secret, or replace the existing parser.

## Run

Requires Node 22.13+ and a browser with WebGL. No package installation is required for this demo.

```bash
# Enter the provider key without saving it to a file or shell history.
read -rsp 'TypeSafe API key: ' TYPESAFE_API_KEY
export TYPESAFE_API_KEY
npm run demo:jev
```

Open the printed `http://127.0.0.1:4318` URL. Wait for the live viewer, choose **Load caffeine**, then try **Look straight down at it from above** or **Remove the sticks joining the atoms**. The page uses the viewer's existing localhost `postMessage` bridge. A visible receipt distinguishes `local`, `jev`, and `cache` decisions from viewer execution. It checks the reply's origin, source window, request ID and success flag. The viewer continues to validate the actual command.

The server performs one authenticated `GET /v1/models` before printing its URL. In this environment, initial/idle connection setup took several seconds and repeatedly exceeded an interactive deadline without this step. Startup can take up to ten seconds; this cost is not included in the warm request figures below. Idle connections can still time out. Exact commands such as `hide bonds` need no key and no remote call.

## What is implemented

- Thirteen code-owned commands: playback, camera presets/fit, bonds, cell and axes.
- Exact literal commands handled in code; whole-input matching avoids accidental matches inside negations or compound requests.
- One Jev request with independent action and scope choices, pinned to `jev-1.13.0`.
- Strict response validation, including finite probability distributions, known labels, matching model and complete question results.
- Conservative action gate: confidence >= 0.9 and chosen probability >= 0.95 for both questions. These are experimental thresholds, not calibrated reliability guarantees.
- A 1,200 ms interactive deadline, no inline retries, exact-request memory cache (five minutes, 128 entries) and duplicate-request coalescing. Late responses cannot populate the cache after timeout.
- Localhost-only server; exact Host/Origin checks, fixed asset paths, 4 KiB request bound, two concurrent requests, 60 requests/minute and 100 requests/process.

The provider sees the command text only. It cannot invent a tool, URL, molecule, numerical argument or scientific result. Unsupported, compound, uncertain and unavailable decisions execute nothing. This is a development server, not production authentication or durable rate limiting.

## Measured evidence — 2026-09-19

Fixtures were labeled before evaluation. The prompt and thresholds were not revised after the development run; the separate holdout was evaluated once. Requests were sequential, uncached, without retries, from one workspace. Timing is client wall time including transport, not isolated GPU inference. Nearest-rank percentiles are used. These are small authored English fixtures, not representative production traffic.

| Metric | Development | Holdout |
|---|---:|---:|
| Cases | 16 | 16 |
| Raw action labels correct | 16/16 | 15/16 |
| Valid commands automatically accepted | 7/9 | 4/10 |
| Invalid requests automatically executed | 0/7 | 0/6 |
| Wrong automatic actions | 0 | 0 |
| Warm p50 / p95, excluding first request | 335 / 408 ms | 296 / 355 ms |
| First request | 4,560 ms | 4,518 ms |

The holdout exposed a limitation: the model abstained on a self-correction, “Display bonds? Actually, hide them instead.” Several correct labels were also withheld by the confidence gate. Do not lower thresholds just to make this fixture set look better. Expand the evaluation with real traffic before enabling automatic interpretation broadly.

After explicit connection warmup, the real local HTTP demo returned a new semantic camera command in **309 ms** and repeated exact requests in **4 ms / 3 ms** from cache. The local command path took **31 ms** including first local HTTP setup. Those cached/local numbers are not model latency. The prior no-warmup run repeatedly returned a bounded timeout; that finding motivated startup preparation.

The model-selected `lupi.set_camera_preset({preset: 'top'})` command was entered through the public viewer's JSON interface. Its result was `ok`, the returned state reported `cameraPreset: top`, and the Top camera control was visibly selected. **This proves command/state compatibility, not an end-to-end iframe demo or rendered molecule:** this review browser cannot reach workspace localhost and has WebGL disabled. The canvas could not render.

Evidence lives in `results/2026-09-19.json`, `http-demo-2026-09-19.json`, and `viewer-state-2026-09-19.json`.

## Verify or rerun

```bash
npm run test:jev                  # 15 focused tests, no provider access
npm run bench:jev -- --replay      # replay checked-in decisions; no key required
npm run bench:jev                 # 32 paid calls; writes results/latest.json
```

The benchmark intentionally uses a 15-second deadline to measure cold/idle calls. The interactive demo uses 1.2 seconds. Fresh benchmark responses are not silently retried or cached. Existing full viewer CI was not run for these isolated development-tool additions; production code and MCP manifests are unchanged.

## Integration (2026-09-20)

The integration path below was taken. The interpreter and the provider client moved to `packages/core/src/jev/` and are shared with the Cloudflare Worker, which serves them as `POST /v1/viewer/command` behind the `TYPESAFE_API_KEY` secret; the viewer's command palette offers the decision as a labeled suggestion that runs only on explicit selection. This directory is now a thin wrapper over that shared code: `client.mjs` keeps the demo envelope, memory cache, and coalescing; `interpreter.mjs` keeps the call shapes and receipt hashes. Scripts run with `tsx` because the shared code is TypeScript. Thresholds, fixtures, and receipts are unchanged. See `docs/jev-integration.md`.

Run: `pnpm demo:jev`, `pnpm test:jev`, `pnpm bench:jev -- --replay`.

## Integration path (as written on 2026-09-19)

For a production trial, keep the existing local parser for supported exact commands. Put `interpret()` behind an authenticated server endpoint using a provider secret, and expose semantic suggestions for unsupported command phrasing. Start with explicit user acceptance or reversible camera changes. Recheck viewer readiness and command eligibility at execution. Do not place the TypeSafe key or the shared MCP service secret in the browser. Observe accepted accuracy, abstention, idle-time failures and end-to-end latency before widening the allowlist.

References: [TypeSafe API](https://docs.typesafe.ai/api), [current model](https://docs.typesafe.ai/models), [known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
