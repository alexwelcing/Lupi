# Lupi release truth contract

Status: **Normative**

Decision owner: Alex Welcing (`@alexwelcing`), repository owner

Change control: explicit reviewed release-policy decision approved by the decision owner

Ratified: 2026-07-19

This contract defines what evidence is required before a Lupi change can be
called complete or released. It implements the boundaries in the
[product ownership contract](product-ownership-contract.md).

Local checks, CI, deployment, the live edge API, and the public site are five
different truths. Never collapse them into one green status.

## Truth lanes

| Truth lane | Minimum evidence |
|---|---|
| Local | Exact Git SHA, clean integration worktree, frozen install, `pnpm verify:product-contract`, real `pnpm lint`, production dependency audits, build, unit tests, Worker tests, release-controller tests, and relevant Playwright results. A script name without its command receipt is not evidence. |
| CI | GitHub Actions run URL and conclusion for the exact SHA, with every required job and required/non-advisory gate named. A local result is not CI evidence. |
| Deploy | Separately authorized owner dispatch, exact candidate version and immutable preview origin, validated prior rollback target, durable pre-mutation intent, traffic-promotion result, and terminal outcome or rollback resolution. Source presence, merge state, package creation, or candidate upload alone is not deployment proof. |
| Live API | Separate candidate-preview and custom-domain reports for the same Git SHA and Worker version, including `/health` identity/bindings, distinct edge and browser manifests, expected authentication posture, entry-byte parity, and relevant authenticated render/job/provenance/artifact behavior. Candidate-preview evidence is not custom-domain evidence. |
| Public site | Root discovery, a real molecule loaded with a canvas present, mobile core controls, saved-view success and recoverable error behavior, and retrieved export bytes wherever the release changes export behavior. A plausible screenshot is not functional proof. |

The release receipt records every lane independently for one exact SHA.
`workers.dev` candidate-preview evidence is separate from custom-domain
evidence.

## Attestation ownership

Every receipt names an accountable Lupi release operator and the person or
automation producing each lane's evidence:

| Lane | Attestation owner |
|---|---|
| Local | Implementer or integrator who controls the clean worktree and exact SHA |
| CI | Required GitHub workflow, with a human integrator accountable for skipped or missing jobs |
| Deploy | Authorized release operator who records the prior version and owns rollback |
| Live API | Release verifier who checks both direct revision and custom-domain evidence |
| Public site | Product verifier who exercises the real human journey and inspects emitted artifacts |

A BLOCKED lane names the person responsible for resolving the credential,
environment, provider, or authority blocker. Automation can produce evidence;
it cannot own an unresolved release decision.

## Status vocabulary

Each truth lane has exactly one status:

- **PASS**: all required evidence for the lane exists, is current, and matches
  the exact intended SHA/version.
- **FAIL**: required evidence ran and contradicted the release contract.
- **NOT CHECKED**: the lane was not exercised. This is honest incompleteness,
  not success.
- **BLOCKED**: the lane could not run because a named prerequisite, authority,
  credential, environment, or external system was unavailable. Record the
  blocker and owner.

“Local PASS; Deploy NOT CHECKED” must never be summarized as “production green.”
Likewise, a successful deployment command is not Live API or Public site proof.

## Decision gates

The status vocabulary is evidence, not the decision by itself:

| Decision | Required state |
|---|---|
| Implementation plan complete | Its scoped acceptance commands pass, known contradictions are recorded, and all five lanes are reported honestly. A plan may complete while a lane remains NOT CHECKED, but that is not merge or release approval. |
| Merge ready | CI PASS exists for the exact candidate SHA; scoped local acceptance checks pass; no exercised or affected check is FAIL; and any baseline gap that prevents full Local PASS has a named owner and prerequisite. Deploy, Live API, and Public site may remain NOT CHECKED only when no production release is being claimed. |
| Production release | Local, CI, Deploy, Live API, and Public site are all PASS for the same intended SHA/version. Any FAIL, BLOCKED, or NOT CHECKED lane blocks a production-green or release-complete claim. |
| Rollback complete | The prior target is named and the Deploy, Live API, and Public site lanes prove the rollback target is serving. A rollback command alone is incomplete. |

No stage may reinterpret BLOCKED as success. A known public product
nonconformity blocks PASS and therefore blocks production release until its exit
condition is met; if the affected surface is exercised and the contradiction is
present, record FAIL.

## Release invariants

Every release must preserve these invariants:

1. `pnpm verify:product-contract` passes and the canonical ownership boundary is
   discoverable.
2. The real, blocking lint and production dependency-audit gates run for the
   exact release SHA. Their source definitions or script names are not command
   receipts.
3. No critical owned or reachable production vulnerability is knowingly
   shipped. Any accepted lower-severity risk names reachability, owner, and
   follow-up.
4. The edge control plane and browser bridge retain their intentionally distinct
   tool contracts (currently six edge tools and 28 browser tools) unless a
   separately reviewed contract migration changes them.
5. Paid work fails closed without per-user authorization, explicit limits,
   durable ownership/lease semantics, a cost ceiling, and a kill switch.
6. Research claims require a supplied, versioned evidence/provenance contract.
7. Commerce or other external consumers use a versioned artifact contract and
   do not make storefront or fulfillment behavior part of viewer core.
8. Rollback evidence names what was serving before mutation and proves what is
   serving after rollback; rollback source code alone is not rollback proof.
9. The approved `legacy-v0` opaque-PNG lane fails closed unless caller auth,
   the private render bucket, renderer endpoint, and independent renderer auth
   are all configured. Its operational receipts are never relabeled as
   `RenderRequestV1`; V1 remains validation-only until a separately reviewed
   executor and identity migration is implemented and proven.

## Production controller contract

The repository now contains a source-side v2 production design in
`.github/workflows/deploy-cloudflare.yml` and
`.github/workflows/reconcile-cloudflare-deploy.yml`. This section defines how
that design may be operated; it does not attest that the workflows or their
external authority are configured or active.

### Release admission and write isolation

- Production release entry is manual `workflow_dispatch` only. It must be run
  by the exact repository owner `alexwelcing`, from `refs/heads/main`, on the
  first attempt, with `target_sha` equal to both the workflow SHA and the
  repository API's current `main` SHA. The confirmation must be exactly
  `DEPLOY <target_sha> WITH BOUNDED ROLLBACK`.
- A no-Cloudflare-secret job runs the source, build, unit, audit, and controller
  gates and builds a closed, digest-bound, data-only release package.
  Credentialed write jobs start clean:
  they do not check out repository source, install project dependencies, build,
  test, execute candidate code, or receive broad/dynamic secrets. They validate
  downloaded data, bootstrap integrity-pinned Wrangler without the token, and
  expose `LUPI_CLOUDFLARE_WRITE_TOKEN_V2` only to the final closed mutation
  step in `lupi-production-write-v2`.
- Read jobs use only `LUPI_CLOUDFLARE_READ_TOKEN_V2` in
  `lupi-production-read-v2`. Manual chain reconstruction uses the read token in
  the separately named `lupi-production-reanchor-v2` environment. No other
  workflow, job, dynamic environment, inherited secret, or computed secret name
  may reach v2 Cloudflare authority.
- Upload is a no-traffic Worker version upload. The immutable candidate preview
  must pass the live verifier and the complete UI suite before a durable
  `lupi-release-intent-v1` is written and before the fixed 100% promotion step.
  After promotion, `https://lupi.live` is verified separately for exact
  Worker/Git identity and entry bytes. Only then may a validated
  `lupi-release-outcome-v1` close the successful chain.

### Durable recovery chain

Release intent records the prior and candidate versions, package and rollback-
contract hashes, expected posture, owner confirmation, and bounded rollback
authorization before traffic changes. A successful outcome carries the exact
candidate identity, custom-domain report, source/package identity, and rollback
bundle. A failed post-promotion verification remains a failed release even if
the authorized bounded rollback restores the prior version.

The reconciliation controller serializes with release through the same
non-cancelling queue. Its automatic `workflow_run` and weekly
`17 7 * * 1` paths are read-only: they may verify a no-op, refresh a complete
`lupi-release-checkpoint-v1`, or emit a rollback-required incident, but they may
not change traffic. An independent rollback, refresh, or re-anchor requires a
fresh exact-owner, current-`main`, first-attempt manual dispatch and its
mode-specific typed confirmation. A third or split active deployment is a STOP,
not an inferred rollback target.

Every retained checkpoint must be self-contained, no older than 30 days, have
at least seven days before expiry, and embed the complete active rollback
bundle rather than only linking to an artifact that can expire. GitHub may
automatically disable scheduled workflows in an inactive public repository, so
the weekly cron is best-effort. During repository inactivity the owner checks
the reconciliation workflow's API state and checkpoint age at least every 30
days. If the workflow is not `active`, releases are BLOCKED until the exact
integrated workflow is inspected, separately re-enabled, and an owner-only
refresh succeeds; an invalid history requires the full re-anchor path.

### Single-owner authority and cutover interlock

This repository intentionally uses a single-owner model rather than a
two-person approval requirement. Exact actor/current-main checks, typed
confirmations, isolated credentials, immutable receipts, and reconciliation
reduce mistakes and stale-writer risk. They cannot independently contain
compromise of the `alexwelcing` account, because that one account controls both
source and production authorization. Every release receipt records that
residual risk without describing it as dual control.

The v2 workflow source is not production authority. Deploy, Live API, and
Public site remain **BLOCKED** until a separately authorized cutover proves all
of the following together:

- the pre-v2 workflow/token freeze remains valid and no still-rerunnable
  historical workflow can reach a current credential;
- literal `lupi-production-read-v2`, `lupi-production-write-v2`, and
  `lupi-production-reanchor-v2` environments have the intended protection and
  exact read/write token mapping, with identifiers recorded but no values;
- protected `main` and its required-check ruleset are active;
- the integrated workflow content and state, closed-world authority scan,
  protected cutover-receipt digest, reconciliation state, and fresh checkpoint
  all pass; and
- an authorized run produces separate Deploy, candidate-preview, custom-domain,
  and Public site evidence for one exact version.

Routine Cloudflare dashboard/CLI deploys, traffic changes, or secret changes are
prohibited because they bypass the durable chain. A necessary break-glass
change first holds both controllers and receives separate authorization and
post-change verification. Source merge is never permission to create/rotate
tokens, configure environments/rulesets, enable a workflow, upload a version,
or change traffic.

## Required report shape

Use this table in release receipts:

| Lane | Status | Exact SHA/version | Evidence | Notes or blocker |
|---|---|---|---|---|
| Local | NOT CHECKED | — | — | — |
| CI | NOT CHECKED | — | — | — |
| Deploy | NOT CHECKED | — | — | — |
| Live API | NOT CHECKED | — | — | — |
| Public site | NOT CHECKED | — | — | — |

Evidence should be a command receipt, CI/deploy run URL, machine-readable report,
or inspectable artifact as appropriate. Screenshots may supplement but not
replace behavioral evidence.

## Current program status

Ratifying this contract, or implementing a capability in source, does not make
the application release-ready. The current candidate now contains two bounded
vertical slices that were previously missing:

- a human distance/angle workflow that retains source-aware atom references,
  states coordinate units and the absence of minimum-image treatment, and
  preserves the measurement definition through save/reopen; and
- an owner-approved authenticated `legacy-v0` template/procedural opaque-PNG
  render, job, provenance, and private-artifact retrieval path.

Neither slice has production evidence merely because its code is present.
Local and CI integration receipts are **NOT CHECKED** until the
end-of-development verification pass. The renderer additionally remains
inactive in production
until the private production/preview buckets, backend endpoint, distinct
secrets, authorized deployment, and candidate/custom-domain readback are
proven. `RenderRequestV1` remains validation-only. Dihedrals, multiple pinned
measurement history/export, and minimum-image/triclinic PBC measurement are
deferred capabilities and are not claimed by the current distance/angle slice.
The correctness/security/lint baseline and every applicable truth lane above
still determine release readiness.

The operational use of this contract is documented in [operations](operations.md)
and the [release checklist](release-checklist.md).
