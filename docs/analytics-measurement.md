# Lupi Analytics Measurement

Lupi has two measurement lanes:

- First-party analytics: enabled in production through `VITE_LUPI_ANALYTICS_URL`.
  Events go to `collectAnalytics`. On lupi.live that is the edge Worker's
  collector (`VITE_LUPI_ANALYTICS_URL=/collectAnalytics`), which writes each
  event as a `component: "lupi_analytics"` line to the Worker's logs
  (`apps/mcp-worker/src/index.ts`). The Firebase Functions collector
  (`functions/src/analytics.ts`) writes structured Cloud Logging entries
  with `jsonPayload.component="lupi_analytics"`, but no shipped build posts
  to it since the Cloud Run fallback was removed on 2026-10-09.
- Firebase/GA4: available, but intentionally disabled by default. Only enable it
  with `VITE_FIREBASE_ANALYTICS_ENABLED=true` and
  `VITE_FIREBASE_ANALYTICS_CONSENT=granted` after consent/legal basis is handled.

## Live Verification

There is no scripted live check. To check by hand after a deploy, open
`https://lupi.live/?utm_source=codex_verify&utm_campaign=verify` and confirm in
the browser's network panel that:

- the page sends a first-party `app_landed` event to `collectAnalytics`;
- no Firebase/GA network requests are made by default.

Synthetic verification traffic uses `utm_source=codex_verify` and is excluded
from the report tool by default.

## Funnel Report

Summarize recent events from Cloud Logging. The report reads only Cloud
Logging, so it sees the Firebase Functions collector's events; it sees the
edge Worker's only if the Worker's logs are shipped there, and nothing in
this repo configures that:

```bash
pnpm analytics:report -- --hours=24
pnpm analytics:report -- --hours=168 --limit=5000
pnpm analytics:report -- --hours=24 --json
```

The report shows:

- event counts and unique-session counts by funnel step;
- conversion from the previous step and from `app_landed`;
- top UTM cohorts by session count, signup completions, and saves;
- the most recent events.

To include synthetic verifier traffic:

```bash
pnpm analytics:report -- --include-probes=true
```

## Raw Logs Explorer Filter

```text
jsonPayload.component="lupi_analytics"
```

Useful refinements:

```text
jsonPayload.component="lupi_analytics"
jsonPayload.event="view_saved"
```

```text
jsonPayload.component="lupi_analytics"
jsonPayload.utm.utm_campaign="launch"
```
