# Lupi product ownership contract

Status: **Normative**

Decision owner: Alex Welcing (`@alexwelcing`), repository owner

Change control: explicit reviewed product decision approved by the decision owner

Ratified: 2026-07-19

This document is the product authority for the standalone Lupi repository. If
an older roadmap, campaign plan, branch, or feature brief conflicts with this
contract, this contract wins until it is changed through an explicit reviewed
product decision.

Lupi owns the complete, trustworthy path from molecular data to human or agent
understanding:

`open/search/upload -> inspect -> measure/analyze/provenance -> save/reopen -> export/share`

## Core users

Lupi serves two core users:

1. A person opening molecular or materials data to inspect its structure,
   trajectory, properties, units, and provenance.
2. An agent requesting a bounded, reproducible viewer artifact and enough
   metadata to verify what was rendered.

Neither user should need the separate Lupine science workbench in order to
build, run, or understand the viewer.

## Owned outcomes

Lupi owns these outcomes end to end:

- **Explore** and **Search** connected structure sources.
- **Upload** or open supported local, pasted, generated, or URL-addressed data.
- Inspect atoms, bonds, cells, trajectories, properties, and visible state.
- **Analyze** and measure with explicit units, method, and provenance.
- **Learn** from viewer-owned facts and externally supplied evidence.
- Save and reopen a view without losing source identity or silently changing
  scientific or visual meaning.
- **Export** and share truthful figures, video, model assets, and saved views.
- Give an agent the same bounded artifact contract with machine-verifiable
  identity, format, and provenance.

The canonical public verbs are Explore, Search, Learn, Upload, and Research.
Inside the viewer they are Structure, Background, Analyze, Learn, and Export.
The interaction details live in the [experience redesign](ux-redesign-2026.md).

On the current landing shell, **Research** is an external handoff to
`lupine.science`. Lupi owns that handoff and viewer-attached presentation of
versioned evidence; it does not own an internal research workbench.

## Supporting capabilities

Authentication, accessibility, analytics, local persistence, rendering,
Firebase, Cloudflare, MCP, and operational verification support the owned
outcomes; they are not outcomes by themselves.

Cloud storage is bounded to saved-view metadata, authentication-owned records,
agent requests/jobs, and validated artifacts. Cloud trajectory synchronization
is not owned by this program. Local trajectory persistence may support the
save/reopen outcome when its limitations are explicit.

## Consumed contracts

Lupi may consume versioned, externally published contracts for molecules,
search results, evidence, and research results. It may display a supplied claim
only with its source, version, and provenance.

Mirrored organization metadata such as `apps/web/public/llms.txt`,
`llms-full.txt`, and `brand.json` is a consumed publication artifact, not a
viewer-owned research claim. A production mirror must identify its publisher,
canonical source, source version or date, and synchronization provenance.

Inside the viewer, Lupi's research-adjacent role is limited to discovering and
displaying externally supplied evidence, provenance, and research-result
manifests under Learn or Analyze. The public **Research** verb remains the
external handoff described above. Neither behavior means executing experiments,
choosing MLIP policy, adjudicating scientific claims, or generating synthetic
evidence.

The viewer must distinguish supplied structure/properties from inferred visual
convenience and must not promote an inference into evidence merely because it
looks plausible.

Lupi owns the Explore and Learn interaction surfaces, navigation, accessibility,
and faithful presentation. The publisher named by a source manifest owns its
claims and educational assertions. Viewer-owned explanatory text must identify
its Lupi content steward and source basis; unattributed content is not silently
treated as external evidence.

## Adjacent products with separate owners

These concerns need their own product and operational owners:

- research execution, model policy, evidence publication, and the public
  science corpus;
- commerce, catalog, storefront, ordering, suppliers, and fulfillment;
- paid acquisition, lifecycle messaging, web push, retention campaigns, and
  customer segmentation.

An adjacent product may consume a versioned Lupi artifact contract. It does not
become part of viewer core by sharing a repository branch or implementation
utility.

## Decision rules for recovered work

Restore historical or unmerged work only when all of these are true:

1. It materially advances an owned outcome above.
2. Its behavior has a named maintainer and, where applicable, an operational
   and cost owner.
3. It can satisfy the [release truth contract](release-truth-contract.md),
   including explicit failure and rollback behavior.
4. Its source can be integrated selectively against current code without
   importing unrelated product ownership.

Generic rendering mechanics may be extracted from a commerce branch when they
meet Lupi's artifact contract. Shopify, Gooten, storefront, product-catalog, and
fulfillment behavior may not be merged into viewer core.

The decision owner has approved one bounded operator-controlled execution
profile: authenticated `legacy-v0` template/procedural opaque-PNG rendering,
with private job, provenance, and artifact retrieval. That source-side approval
does not create a public or per-user render product, does not activate
`RenderRequestV1`, and does not prove production readiness. Production
activation remains conditional on a named render operator and cost owner,
private bucket/backend/secret provisioning, an authorized deployment, and live
readback under the [release truth contract](release-truth-contract.md).

## Current nonconformities

Ratification records known contradictions; it does not erase them. These items
block the affected release evidence until their exit condition is met:

| Current contradiction | Accountable owner | Exit condition |
|---|---|---|
| `?view=compare` mounts Comparison Theater with generated trajectories and an unsupported throughput label | Product decision owner and Lupi content steward | Disable public routing, label the surface unmistakably as a synthetic demonstration and remove unsupported performance claims, or supply a versioned external evidence manifest. Public-site evidence cannot PASS while the current claim remains reachable. |
| The viewer build mirrors Lupine Science `llms*.txt` and `brand.json` without a complete source-version/sync receipt | Lupi content steward and the external publisher | Record publisher, canonical source, source version/date, and synchronization provenance, or remove the mirrors from the viewer build. |
| The historical API-key exchange grants broad Firebase identity and has no shipped scoped client/UI contract | Lupi identity/data operator | Keep the user and paid-execution path dark until scoped credentials, limits, revocation, and live readback are proven. |

## Not now

The current ownership program explicitly excludes:

- synthetic Comparison Theater claims without a versioned external evidence
  manifest;
- lifecycle email, web push, RFM segmentation, or paid-acquisition operations;
- anonymous paid rendering;
- cloud trajectory synchronization;
- wholesale commerce-branch merges;
- research execution, MLIP policy selection, and scientific claim decisions.

These exclusions are product boundaries, not assertions that the ideas have no
future value. Bringing one into Lupi requires an explicit ownership decision,
operator, evidence contract, and release plan.

## Accountability map

Ownership must be operational, not merely architectural. A release receipt names
the actual person filling each applicable role; “the platform” or a repository
name is not an accountable owner.

| Surface | Accountable role |
|---|---|
| Product boundary and core viewer experience | Lupi product decision owner |
| `lupi.live`, Cloudflare Worker, routes, bindings, and rollback | Lupi release operator |
| Firebase auth, Functions, rules, and saved-view records | Lupi identity/data operator |
| Render jobs, artifacts, quotas, and spend | The decision owner approved the bounded authenticated `legacy-v0` source implementation. The release receipt must still name the render operator and cost owner; production execution stays dark until private infrastructure, deployment, and live readback are proven. |
| Viewer-owned gallery and explanatory content | Lupi content steward |
| External evidence or research-result manifest | Publishing source owns the claim; Lupi content steward owns faithful display and provenance |
| Commerce adapter, catalog, orders, and fulfillment | Separate commerce owner; unassigned inside viewer core |

The same person may fill several roles for a small project, but the receipt must
still make the responsibilities and escalation path explicit.
