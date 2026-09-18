# TypeSafe AI Jev: capability research and Lupi opportunities

Status: research brief, not a product decision. Written 2026-09-18, three days
after Jev's public launch. Everything below is either sourced from TypeSafe's
own docs and blog, from third-party coverage, or is a Lupi-specific proposal
marked as such. The [product ownership contract](product-ownership-contract.md)
still wins over anything here.

## Summary

Jev is not a chat model and cannot write text. It is a hosted decision
function: you send a JSON "state" plus a set of typed questions, and it
returns one typed answer per question with a calibrated probability, in one
parallel pass, in roughly 70 to 500 ms. There are exactly three question
types: pick one option from a list (up to 255), place the input on a 2 to 10
level rubric, or estimate the probability that a statement is true. Input
costs $0.042 per million tokens and output is free, which is two to three
orders of magnitude below frontier LLMs for the same classification work.

For Lupi this means Jev is a bad fit for almost everything in the rendering,
parsing, and measurement core, all of which is numeric and already
deterministic, and for any Learn copy, because it cannot generate a sentence.
It is a strong fit for the fuzzy, bounded judgments Lupi currently makes with
substring matching or by hand: routing a free-text search, resolving a
description to a template, checking that curated copy stays within the
"observation, not evidence" rule, triaging unknown pasted files, screening
public saved-view titles, and tagging external catalogs for discovery facets.
Several of these are new capabilities rather than replacements, most notably
a response path for the student observation prompts that today go nowhere.

The strongest first experiment is an offline, CI-gated semantic lint of
`gallery-data.json` and `studentCollection.ts` in shadow mode. It touches no
user data, costs under a cent per run, and directly serves the contract's
rule that inference must never be presented as evidence.

## What Jev is

### Company and launch

- TypeSafe AI is a San Francisco lab founded by Diogo Almeida, previously an
  OpenAI researcher credited on RLHF and ChatGPT. Jev, their first public
  "System One" model, opened early access on 2026-09-15 alongside a $40M
  round. Access is waitlisted; keys come from `console.typesafe.ai`.
- Their stated thesis is that RLHF chat models are the wrong interface for
  software. They train instead with what they call Reinforcement Learning for
  Calibrated Decisions (RLCD), optimizing probabilities against outcomes
  rather than human preference. Architecture is undisclosed ("close to the
  chest"); a paper is promised. Weights are closed and there is no on-prem or
  local option.

### The interface

One endpoint: `POST https://api.typesafe.ai/v1/systemone` with a bearer key.

Request:

```json
{
  "model": "jev-latest",
  "state": { "any": "json object, string, or array of text" },
  "questions": {
    "topic": { "type": "choice", "instructions": "...", "criteria": { "a": "...", "b": null } },
    "depth": { "type": "score",  "instructions": "...", "criteria": ["level 0", "level 1", "level 2"] },
    "ok":    { "type": "noul",   "instructions": "The statement ... is true" }
  }
}
```

Response: one answer per question id, plus `model` (currently `jev-1.13.0`)
and `usage` token counts.

| Primitive | Returns | Notes |
|---|---|---|
| Choice | `choice`, `probabilities` per option, `confidence` 0 to 1 | Up to 255 options. Criteria may be `null`, a string, or an object with `what`, `not_for`, `examples`. Docs say always include an "other" or "none" option. |
| Score | `score` (continuous, probability-weighted mean of level index), `probabilities`, `confidence`, `legend` | 2 to 10 ordered levels. Each level is judged independently; the model never sees level numbers or neighbours, so describe situations, not "moderately". |
| Noul | `noul` (probability the statement is true) | No separate confidence. Optional `criteria.true` / `criteria.false` descriptions. |

All questions in one call are evaluated in parallel against the same state.
Adding a tenth question adds tokens but almost no latency, so the documented
pattern is "speculative fan-out": ask everything at once and let code decide.

### Limits, pricing, access paths

| Item | Value |
|---|---|
| Latency | 70 to 500 ms end to end, vendor claim; independently measured at 0.35 s per passage and 0.7 s for 777 judgments in one call |
| Price | $0.042 per million input tokens, output free |
| Context | 64k tokens per request; 32k for state plus the longest single question |
| Rate limits | 250,000 tokens per second, 1,200 requests per minute, HTTP 429 above either |
| Modality | Text only. JSON, strings, arrays. No images "yet" |
| Language | English primary; other scripts accepted with lower accuracy |
| Customization | None. Same weights for everyone; you steer with state, instructions, criteria |
| Data | Not used for training; zero data retention only on the enterprise tier; US hosted |
| SDKs | `typesafe-sdk` (Python 3.10+), `@typesafe-ai/sdk` (Node 20+, MIT) |
| Gateway | Vercel AI Gateway serves it as `typesafe-ai/jev` via AI SDK 7's `evaluate` API |
| Fallback | `typesafe-ai/system-one-adapter-python` runs the same question interface over OpenAI, Anthropic, or Google structured output; a community Rust port exists, no official JS port |

The JS SDK is built on global `fetch`, so it runs on Cloudflare Workers
unchanged. It deliberately throws in a browser unless `dangerouslyAllowBrowser`
is set, because the key would be exposed. Every Lupi call therefore belongs in
`apps/mcp-worker`, a Firebase Function, or a Node tool, never in `packages/ui`.

### Documented weaknesses

TypeSafe publishes a "jaggedness" page for Jev 1.13. The items that matter
for Lupi:

- Literal reading: it answers the question as written, not as meant.
- No arithmetic, no counting, no date ordering. Do that in code.
- Poor on low-level numeric representations (the example is hex colours).
  Atom coordinates, bond lengths, and cell vectors are exactly this.
- Score cannot be interpolated into a magnitude; use it for thresholds only.
- Accuracy drops with irrelevant state. Filter before sending.
- State is not treated as adversarial. Instructions embedded in user text can
  steer answers, so user text must never define criteria.
- No guarantee that P(true) + P(false) sums to one across primitives.

### Evidence quality

Vendor claims and independent checks, separated:

- The headline "193.6x faster, 444.6x cheaper" compares Jev with the slowest
  frontier model on the slowest task. Against GPT-5.6 Terra, TypeSafe's own
  table gives roughly 25x faster and 76x cheaper at near-equal accuracy
  (67.8% versus 67.9%).
- The accuracy figures come from four workflows written by TypeSafe's own
  team, scored against the average of two frontier models rather than human
  labels. TypeSafe discloses the bias.
- Calibration is the load-bearing claim and is undemonstrated: no reliability
  curve, no expected calibration error, no ablation is published.
- Independent tests so far: Every ran 1,709 judgments; Jev caught 6 of 7
  planted writing defects where Fable 5.1 caught 7. A launch-day tester
  classified 9,840 Enron documents at 82.9% accuracy, rising to 93.7% when
  filtering to answers above 0.95 confidence. That second number is the only
  public evidence that confidence gating works, and it is a single anecdote.
- "Cannot hallucinate" means the output is always schema-valid. A confidently
  wrong choice is still possible and is the main line of criticism.
- Pricing may be subsidized; TypeSafe says as much.

Practical reading: treat Jev as a cheap, fast, probably-calibrated classifier
that must be validated on Lupi's own labeled examples before it gates
anything user-visible. TypeSafe's docs say the same: start with conservative
thresholds and test with your own data.

## Constraints from the ownership contract

Four rules shape every proposal below.

1. The viewer must not promote an inference into evidence. Every Jev answer is
   an inference. Anything surfaced must carry a visible "inferred" marker and
   a provenance record (`jev-1.13.0`, date, confidence).
2. Viewer-owned explanatory text needs a named steward and source basis. Jev
   cannot write text, which is a feature here: it can only select among
   strings a steward already wrote.
3. Lupi does not adjudicate scientific claims. Jev must never be asked "is
   this molecule's geometry correct" or "is this property true".
4. Lifecycle messaging, retention campaigns, and customer segmentation are
   owned elsewhere. Session-level UX decisions are fine; cross-session
   targeting is not.

## Where it plugs into the stack

| Seam | Runtime | Fit |
|---|---|---|
| `apps/mcp-worker/src/index.ts` (`/mcp` JSON-RPC, `/v1/*`) | Cloudflare Worker, fetch available | Best server seam. Add `TYPESAFE_API_KEY` as a Worker secret next to `LUPI_MCP_SHARED_SECRET`. |
| `functions/src/socialView.ts` (`/view/:slug` cards) | Firebase Functions, Node | Right place for saved-view screening. |
| `tools/audit-*.mjs`, `scripts/build-nist-catalog.ts` | Node, CI | Right place for offline curation lint and catalog tagging. Receipts under `.verify-artifacts/`. |
| `packages/ui` | Browser | Never call Jev here. Route through the Worker. |
| `packages/ui/src/molecules/search.ts` `rankHits` | Pure function | Keep pure; a Worker-side re-rank returns adjusted scores, and the client merges. |

## Opportunities

Ordered within each group by how new the capability is, not by priority.
Priority is in the next section.

### Customer-facing

**C1. A response path for student observation prompts (new).**
Every entry in `packages/ui/src/gallery/studentCollection.ts` carries an
observation prompt such as "Rotate the three atoms. Does the shape look
straight or bent?" Today the prompt is a dead end. With Jev the learner types
a one-line observation, the Worker sends state `{ prompt, observation,
supplied_facts }` where the facts come from `buildMoleculeStudyFacts` (element
counts, bond source, provenance), and asks: Choice "which observation did the
learner make" over the steward-listed possibilities plus "unclear"; Noul "the
observation is about shape/arrangement rather than a property claim"; Score
"specificity" on three levels. The UI then shows one of a handful of
steward-authored follow-up lines chosen by code from those answers. No text
is generated. Cost is about $0.00004 per submission. Constraints: label it as
a nudge, not a grade; never tell a student they are wrong about chemistry;
strip identifiers; make it opt-in because learner text leaves the region and
the audience may include minors.

**C2. Intent-aware Explore search (upgrade to new behavior).**
Public search filters the student collection by substring. Queries such as
"the sugar one", "ring with an OH", or "something with nitrogen" return
nothing. A Worker-side pass sends the query plus the twelve entries (id,
formula, topic, prompt) and asks Choice "which entry best matches" with a
"none" option, plus Choice "what kind of request is this" over
{student_molecule, chemical_name, smiles, file_help, not_a_molecule}. High
confidence opens the entry; medium shows "did you mean"; low or "none" falls
through to the existing behavior. The intent choice also lets the empty state
say the right thing: a SMILES string gets the paste path, "how do I open a
LAMMPS dump" gets the How to use link. Latency fits a search box. About
$0.00008 per query, so 100k queries a month is roughly $8.

**C3. Description-to-molecule resolver.**
`findTemplateFromDescription` in `mcpViewerBridge.tsx` is a substring match
and throws "Description did not match a local viewer template" on a miss.
Replace the match with a Choice over `TEMPLATE_MOLECULES` (well under 255)
plus "not_a_template", gated on confidence, falling through to the PubChem
name lookup that the `name` input type already uses. This serves both the
`?description=` deep link and the agent path through `lupi.generate_molecule`.

**C4. Honest triage of unrecognized pasted or dropped files (new).**
`detectFormat.ts` is deterministic for XYZ, extXYZ, LAMMPS dump and data.
When it fails, the user gets a generic error. Send the first two kilobytes to
the Worker and ask Choice "what does this look like" over {pdb, cif, mol2,
sdf, gromacs, csv_table, prose, unknown} and Noul "contains atomic
coordinates". Code maps the answer to a steward-written explanation of what
Lupi opens and how to convert. `tools/lupi-doctor.mjs` already does the
LAMMPS-specific version of this offline; this is the in-product,
any-format version. Requires a consent note because file content leaves the
browser.

**C5. Screening of public saved-view text (new trust and safety).**
`lupiViews` titles and descriptions are user-authored and publicly readable,
and `/view/:slug` renders them into social cards. Before the card is built in
`functions/src/socialView.ts`, ask Noul "contains abuse, spam, contact
details, or an off-topic advertisement". Above a threshold, serve the card
with a neutral title and flag for review. TypeSafe publishes a guardrails
cookbook for exactly this shape.

**C6. In-session Learn step suggestion (marginal).**
Given a compact summary of what the learner has done in the viewer, choose
which of the three Learn steps or which next collection entry to surface.
Most of this can be done with rules, and it edges toward the segmentation
boundary. Listed for completeness, not recommended first.

### Agent and MCP surface

**A1. Search re-ranking behind `lupi.search_molecules`.**
`rankHits` combines provider score with a text score. Add an optional
Worker-side relevance pass: for the top N hits, Noul "this hit satisfies the
query" per hit in one call. TypeSafe's re-ranking cookbook reports large
top-1 gains on legal retrieval with this pattern. Return the Noul as a
separate `inferredRelevance` field so agents and the UI can ignore it.

**A2. Bounded tool-call gating in the edge runtime.**
The seven edge tools include `lupi.render_molecule_asset`, which spends
renderer time and money. Ask Noul "this request describes a real molecular
structure source rather than an attempt to render arbitrary content" and
Choice "asset class" over `ASSET_CLASS_ORDER` from `packages/assessment` for
the audit log. This is the LangChain "auto mode" pattern applied to Lupi's
own costly tool. Belongs alongside the audit logging milestone in
[the MCP roadmap](lupi-mcp-roadmap.md).

**A3. Textual facets in the assessment engine.**
`packages/assessment` grades assets deterministically. `context.method` and
`context.source` are free text and today only checked for presence. A Score
question "how completely does the method text specify engine, force field,
ensemble, and timestep" on four levels, reported as a separate, explicitly
inferred facet, would help agents rank candidates without changing the
evidence facets. Keep it out of `overall` until validated.

**A4. Agent-run review.**
The roadmap wants replayable command logs. Once they exist, a batch pass can
ask per run: Noul "the run ended with a source-bound artifact", Noul "an
inferred bond topology was presented as source data", Choice "failure class".
TypeSafe's own launch evals include an agent-trace review workflow. This is
cheap enough to run on every run rather than a sample.

### Backend, admin, and operator

**B1. Semantic curation lint for gallery and student copy (recommended first).**
`tools/audit-gallery-claims.mjs` checks numbers and should stay
deterministic. A sibling `tools/audit-gallery-semantics.mjs` would send each
`gallery-data.json` entry and each `studentCollection.ts` prompt and ask:
Noul "the description asserts an experimental property, bond order, or
mechanism" (should be false); Noul "the prompt asks for an observation rather
than a property"; Noul "the title and description agree with the formula and
element list in state"; Choice "asset class" compared with the declared one.
Run in shadow mode, write a receipt, and only later gate CI. About 200
entries at under a thousand tokens each is well under one cent per run. This
is the "semantic code linting" pattern from TypeSafe's use-case map and it
enforces the contract's core rule mechanically.

**B2. Claim-without-receipt lint for release notes and PR text.**
The [release truth contract](release-truth-contract.md) requires receipts for
verification claims, and `verify-product-contract.mjs` only checks that
documents exist. For changed Markdown and PR bodies, ask per sentence: Noul
"claims something was tested, deployed, or verified" and Noul "names a
receipt, log, artifact, or link". Sentences with the first high and the
second low get flagged. This mirrors what Every did with 21 questions per
document across 37 documents in 0.7 seconds.

**B3. PR and CI triage for a repository run largely by agents.**
Recent history shows `codex/*` and `claude/*` branches landing constantly.
On each PR: Choice "primary surface touched" over {renderer, parsers, ui,
mobile, mcp_worker, functions, docs, workflows}; Noul "touches
`firestore.rules`, `wrangler.toml`, or workflows" as a hard escalation; on
failure, Choice "failure kind" over {test_regression, flaky_timeout,
infra_checkout, lint, build}. Latency fits a GitHub Action step.

**B4. External catalog tagging for discovery facets.**
`scripts/build-nist-catalog.ts` and `nist_ipr/master_index.json` hold about a
thousand interatomic potentials with free-text descriptions. TypeSafe's
hierarchical classification cookbook (beam search over chained Choices) fits
tagging each by material class and system type, plus Noul "description
agrees with the listed elements". Store tags with provenance as inferred
search facets. Discovery is an owned outcome; the science stays NIST's.

**B5. Search quality regression harness.**
Use Jev as a cheap judge over (query, hit) pairs to score `rankHits` changes
in CI. Thousands of pairs cost cents. Judge labels are inferred and belong in
`.verify-artifacts/`, not in product data.

**B6. Search-query intent report.**
If search text is ever logged (it is not today), a monthly aggregate of
intents from C2 would show what learners look for that the collection lacks.
Aggregate only, no per-user rows, to stay inside the analytics support role.

### Not a fit

- Anything that produces text: Learn copy, study facts, alt text, release
  notes. Jev cannot write.
- Anything numeric or geometric: format parsing for supported formats, bond
  inference, measurements, atom counts, camera fitting, quality tiers,
  streaming decisions. Jev's own docs say it is not a calculator and is weak
  on low-level numeric data.
- Anything that would become evidence: property claims, geometry validity,
  scientific correctness.
- Anything called from the browser.

## Recommended sequence

1. Get on the waitlist now; access is the gating item.
2. B1 semantic curation lint in shadow mode. Zero user data, immediate
   receipt, and it produces the first Lupi-specific accuracy numbers for Jev.
3. C3 description resolver, because it is server-side, agent-facing, and has
   a safe fallback to today's behavior.
4. C2 Explore search intent, reusing the same Worker client and thresholds
   learned in step 3.
5. C5 saved-view screening once the Firebase Functions seam has the key.
6. C1 student observation feedback only after a privacy decision on sending
   learner text off-site, and after a steward writes the follow-up lines.

Build one small Worker module for all of them: a typed `askJev(state,
questions)` wrapper with timeout, retry, a per-feature confidence threshold
table, and an always-on shadow log of question id, model version, confidence,
and the deterministic decision that was actually taken. Keep an LLM-backed
fallback behind the same interface using the system-one-adapter shape, so a
vendor outage or a pricing change degrades to slower structured output
rather than to a broken feature.

## Risks and open questions

- Access: early access is waitlisted; no timeline is public.
- Calibration is unproven publicly. Every gated decision needs a Lupi labeled
  set of a few hundred examples and a plotted confidence-versus-accuracy
  curve before it leaves shadow mode.
- Privacy: US-hosted, retention policy unclear outside enterprise. Do not send
  account identifiers, and treat learner text (C1, C2, C4) as an opt-in
  data flow.
- Prompt injection: user text in state can steer answers. Criteria and
  instructions must be constants; user text is only ever a value.
- Vendor risk: closed weights, subsidized pricing, three-day-old product.
  The fallback adapter is the mitigation.
- Contract: every surfaced answer is an inference and must be marked as one.
  Any strings a user sees remain steward-authored.

## Sources

TypeSafe

- https://typesafe.ai
- https://typesafe.ai/blog/introducing-system-one-models-and-jev
- https://evals.typesafe.ai
- https://docs.typesafe.ai/introduction, /concepts/system-one, /concepts/state,
  /concepts/how-to-build-with-system-one, /concepts/use-case-map
- https://docs.typesafe.ai/primitives/choice, /primitives/score,
  /primitives/advanced, /confidence, /patterns, /models, /api
- https://docs.typesafe.ai/model-jaggedness/jev-1.13
- https://docs.typesafe.ai/llms.txt (cookbook index: re-ranking, guardrails,
  hierarchical classification, citation check, entity alignment)
- https://github.com/typesafe-ai/typesafe-sdk-js
- https://github.com/typesafe-ai/system-one-adapter-python

Coverage and independent tests

- https://www.theregister.com/ai-and-ml/2026/09/16/typesafe-ai-debuts-model-for-machines-that-plays-doom/5296711
- https://news.ycombinator.com/item?id=49717558
- https://every.to/also-true-for-humans/mini-vibe-check-typesafe-s-jev-judged-everything-i-ve-written-in-0-7-seconds
- https://www.langchain.com/blog/building-a-harness-with-jev
- https://dev.to/valyuai/how-to-use-jev-a-practical-guide-to-typesafes-system-one-model-g5e
- https://www.datacamp.com/blog/system-one-models-jev
- https://pearpages.com/blog/2026/09/16/jev-sorted-what-typesafes-system-one-model-actually-is-and-what-is-still-just-a-claim
- https://fourweekmba.com/ai-typesafe-jev-system-one-model-structured-output/
- https://actionbox.cloud/blog/typesafe-ai-jev-review/
- https://www.latent.space/p/ainews-jev-a-system-one-model-that
- https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway
- https://github.com/Anil-matcha/awesome-jev-by-typesafe
- https://github.com/AkashPriyadarshii/jev-curate
