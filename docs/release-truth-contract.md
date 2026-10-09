# Lupi release truth contract

Status: **Normative**

Decision owner: Alex Welcing (`@alexwelcing`), repository owner

Change control: explicit reviewed release-policy decision approved by the decision owner

Ratified: 2026-07-19. Amended 2026-10-09 by owner decision: CI and
verification were cut to the bone, and receipts and release gates were
removed.

This contract says what each Lupi check proves and what it does not. It
implements the boundaries in the
[product ownership contract](product-ownership-contract.md).

Local checks, CI, the deploy, the live edge API and the public site are five
different truths. Never collapse them into one green status. They are not
gates: a push to `main` deploys what it holds, and if `main` breaks, fix it and
push again.

## Truth lanes

| Truth | What exists | What it does not prove |
|---|---|---|
| Local | Whatever you ran: `pnpm test`, `pnpm lint`, `pnpm verify:viewer-smoke`, `pnpm test:ui`, `pnpm apple:check`, or a scratch Playwright script you did not commit. | Anything about CI, the deploy or lupi.live. |
| CI | The pull request's `build-test` job: frozen install, `pnpm build`, and a pinned-Wrangler `versions upload --dry-run`. | That tests or lint pass, or that the app works in a browser. |
| Deploy | The `deploy-cloudflare.yml` run for the push to `main`: `wrangler deploy` succeeded. | That lupi.live serves it. |
| Live API | The same run waits for `https://lupi.live/health` to report the pushed commit. | MCP, render, auth or dataset behavior. Check those by hand when a change touches them. |
| Public site | The same run checks that `/` and its `/assets/index-*.js` load. | That a molecule opens, the controls work or exports return bytes, unless someone looked. |

## Saying what you checked

When you report work, say which checks ran and what you looked at, in plain
words: checked, not checked, failed, or blocked (and by what). "The build
passed" never means "it works on lupi.live". A script name you did not run is
not evidence, and a screenshot shows only what it shows.

Keep no receipts: no committed reports, golden fixtures, smoke plugins or new
verifiers. Look at your work with a scratch script and say what you saw.

Only the `build-test` check gates a merge. Nothing gates a deploy.

## Release invariants

Every release must preserve these invariants:

1. The canonical ownership boundary, the
   [product ownership contract](product-ownership-contract.md), stays
   discoverable.
2. No critical owned or reachable production vulnerability is knowingly
   shipped. Dependabot alerts in the repository's GitHub settings surface
   them; there is no audit gate in CI. Any accepted lower-severity risk names
   reachability, owner, and follow-up.
3. The edge control plane and browser bridge retain their intentionally distinct
   tool contracts (currently seven edge tools and 31 browser tools) unless a
   separately reviewed contract migration changes them.
4. Paid work fails closed without per-user authorization, explicit limits,
   durable ownership/lease semantics, a cost ceiling, and a kill switch.
5. Research claims require a supplied, versioned evidence/provenance contract.
6. Commerce or other external consumers use a versioned artifact contract and
   do not make storefront or fulfillment behavior part of viewer core.
7. A rollback is a revert or a fix pushed to `main`. It is done when
   `https://lupi.live/health` reports that commit.
8. The approved `legacy-v0` opaque-PNG lane fails closed unless caller auth,
   the private render bucket, renderer endpoint, and independent renderer auth
   are all configured. Its results are never relabeled as
   `RenderRequestV1`; V1 remains validation-only until a separately reviewed
   executor and identity migration is implemented and proven.

## Retired release machinery

The owner-dispatched v2 release controller (typed confirmation, no-traffic
candidate preview, release intent and outcome receipts, checkpoints and the
weekly reconciliation workflow) was retired on 2026-09-20. The Cloud Run viewer
fallback, the exact-SHA lint, audit and Playwright gates, and the release
verifiers were removed on 2026-10-09. All of it is in git history. The deploy
uses only the `lupi-production-write-v2` environment and its write token; no
workflow uses the read or re-anchor environments.

## Current program status

Implementing a capability in source does not make it shipped. The code now
contains two bounded vertical slices that were previously missing:

- a human distance/angle workflow that retains source-aware atom references,
  states coordinate units and the absence of minimum-image treatment, and
  preserves the measurement definition through save/reopen; and
- an owner-approved authenticated `legacy-v0` template/procedural opaque-PNG
  render, job, provenance, and private-artifact retrieval path.

Neither slice has production evidence merely because its code is present.
The renderer remains inactive in production until the private
production/preview buckets, backend endpoint, distinct secrets, deployment and
readback on lupi.live are shown working. `RenderRequestV1` remains
validation-only. Dihedrals, multiple pinned measurement history/export, and
minimum-image/triclinic PBC measurement are deferred capabilities and are not
claimed by the current distance/angle slice.

The operational use of this contract is documented in [operations](operations.md)
and the [release checklist](release-checklist.md).
