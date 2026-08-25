# lupine-app

Self-serve SaaS for Lupine Science — sign in with your Lupi account (shared
Firebase project `shed-489901`), subscribe via Stripe Checkout, manage billing
via the Stripe portal. Deployed to Cloud Run as `lupine-app`
(`app.lupine.science`).

## Stack

- Node 22 ESM + Hono (`src/app.mjs`), no build step
- Firebase Admin SDK (ADC via the runner service account; no key files)
- Stripe Node SDK (Checkout subscriptions + webhook → Firestore entitlement)
- Static frontend in `public/` (Firebase Web SDK via CDN)

## Firestore model (rules live in the `lupi` repo — `firestore.rules`)

- `customers/{uid}` — Stripe customer link (server-write, owner-read)
- `entitlements/{uid}` — `{ status, priceId, currentPeriodEnd, cancelAtPeriodEnd }`
- `stripeEvents/{eventId}` — webhook idempotency markers (server-only)
- `usageEvents/{id}` — stub for future usage-based billing (shape TBD)

## Local dev

```bash
npm install
npm test                 # offline; Firebase/Stripe are injected fakes
STRIPE_SECRET_KEY=sk_test_... npm run dev
```

Without `STRIPE_SECRET_KEY` the server still boots; billing endpoints return 503.

## Deploy

One-time infra + secrets: see the header comment in `cloudbuild.yaml`.
Then: `gcloud builds submit --project shed-489901` from this directory. The
`glim-think-token` Secret Manager value must match the Worker's configured
`INTERNAL_TASK_TOKEN`; it is sent only as a server-side Bearer token.

## Operator surface (`/campaigns`)

The product workflow for a researcher (e.g. Li-S batteries): define a candidate
space → configure the model fleet + frozen union-sparse anchor policy → review,
lock the preregistered manifest, enqueue → monitor cells live → per-path results
+ evidence.

- `GET /api/panel-template` / `/api/models` / `/api/savings-preview` — public
- `POST /api/panels/validate` — structural check + content hash (schema `lupine.z1.neb_barrier_panel.v1`); custom panels remain `needs-verification` and cannot dispatch
- `GET /api/campaigns` — recorded Z1-union pilot seed + live fleet campaigns (proxied from glim-think; degrades honestly)
- `GET /api/campaigns/:id`, `GET /api/beats` — proxied status
- `POST /api/campaigns` — entitlement-gated launch of the reviewed Z1 panel/model set; a canonical dispatch request is sha256-locked server-side and succeeds only after glim-think reports a queued cell

Vendored contracts live in `data/` (source of truth: `lupine-rhizo`, see
`source_path`/`sha256` fields). Public economics are restricted to the reviewed
guardrails; recorded pilot data is labeled recorded.

## Env

| Var | Purpose |
| --- | --- |
| `PORT` | listen port (8080 default) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe (Secret Manager in prod) |
| `PLANS_JSON` | pricing page plans: `[{name, blurb, priceId, amount, interval}]` |
| `BASE_URL` | absolute origin for Stripe redirect URLs |
| `GLIM_THINK_BASE` / `GLIM_THINK_TOKEN` | fleet status/dispatch proxy target (default: glim-think-v1 worker) |
| `FIREBASE_*` | override the public web config defaults (not secrets) |

## Deliberate non-goals (v1)

- No usage-based billing logic — only the `usageEvents` stub.
- No shared-cookie SSO (lupi.live / lupine.science are different eTLD+1).
- No marketing claims beyond the frozen economics guardrails.
