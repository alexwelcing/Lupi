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
| Local | Exact Git SHA, clean integration worktree, frozen install, `pnpm verify:product-contract`, build, real lint, unit tests, Worker tests, and relevant Playwright results. Until a non-vacuous lint gate exists, local release evidence is incomplete. |
| CI | GitHub Actions run URL and conclusion for the exact SHA, with every required job and required/non-advisory gate named. A local result is not CI evidence. |
| Deploy | Authorized deployment run, exact candidate/revision URL and version, bindings/configuration validation, and the previously serving rollback target. Source presence or merge state is not deployment proof. |
| Live API | Custom-domain `/health` version and bindings, distinct edge and browser manifests, expected authentication posture, and relevant render/job/asset behavior. Direct `workers.dev` evidence is recorded separately from custom-domain evidence. |
| Public site | Root discovery, a real molecule loaded with a canvas present, mobile core controls, saved-view success and recoverable error behavior, and retrieved export bytes wherever the release changes export behavior. A plausible screenshot is not functional proof. |

The release receipt records every lane independently for one exact SHA. Direct
revision evidence and custom-domain evidence must not be substituted for one
another.

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
2. A real, blocking lint gate exists before release evidence may claim lint
   success; the current root `pnpm lint` script is not sufficient evidence by
   its name alone.
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

Ratifying this contract does not make the application release-ready. Four
capability gates remain: the correctness/security/lint baseline, truthful
render/artifact behavior, the complete human
inspect-measure-provenance-save/reopen loop, and the authenticated agent
render/retrieve path. The operator planning workspace labels these waves
023 through 026; those numbers are execution references, not the normative
definition of readiness.

The operational use of this contract is documented in [operations](operations.md)
and the [release checklist](release-checklist.md).
