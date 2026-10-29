# Portable Lupi Asset Assessment

`@atlas/assessment` classifies and grades materialized atomistic assets without rendering, WebGL, molecule generation, or online scientific enrichment. The deterministic report is portable across Node, browsers, and Cloudflare Workers; execution timing and byte telemetry are returned separately.

## Fast path

The package is a library with no command-line tool: `pnpm lupi:assess`, its report cache and its flags were never part of this repo. Its callers are the browser bridge's `lupi.assess_asset` (`packages/ui/src/mcp/tools.ts`) and the edge Worker's (`apps/mcp-worker/src/index.ts`), both in fast mode. From Node, assess files with the library directly:

```ts
import { assessMany, rankAssessments } from '@atlas/assessment';
import { byteSourcesFromPath } from '@atlas/assessment/node';

const batch = await assessMany(await byteSourcesFromPath('./catalog'), { mode: 'fast' });
const ranked = rankAssessments(batch.results.map((run) => run.report));
```

Fast mode is the default. It reads at most 128 KiB from an asset (`maxFastBytes`), uses at most two range operations (`maxReadOperations`) and never materializes the complete trajectory. `assessMany` runs up to eight local and four remote assessments concurrently and continues when another batch item fails, listing it under `failures`. `byteSourceFromUrl` applies a five-second remote timeout and rejects private-network URLs unless the caller passes `allowPrivate: true`.

Low grades are successful results. Unsupported but readable formats return partial `Unrated` reports; operationally unreadable inputs throw, or land in `failures` from `assessMany`.

Each source carries a `cacheKey` for callers that cache reports. `envelopeSource(envelope, name, { immutableContentId })` sets one only when the caller supplies `immutableContentId`, which must cover the complete immutable payload; mutable database record IDs are not sufficient. A cache should also key on the canonical assessment context, the ruleset version and the mode. Path metadata or a bounded URL/file prefix is not a safe identity for an entire mutable object, so deep results for local files and URLs should not be reused on those keys.

## Library contract

```ts
import {
  assessAsset,
  assessMany,
  byteSourceFromBytes,
  rankAssessments,
} from '@atlas/assessment';

const run = await assessAsset(byteSourceFromBytes(bytes, 'sample.xyz'), context);
const ranked = rankAssessments([run.report]);
```

Node path and directory adapters are isolated from the portable entrypoint:

```ts
import { byteSourcesFromPath } from '@atlas/assessment/node';
```

Adapters are also provided for URLs, `Blob`, `Uint8Array`, streams, loaded Lupi trajectories, structured envelopes, and metadata-only procedural assets. `AssetInspector` extensions can add formats through `assessAsset(source, context, { inspectors })` without changing the versioned grading rules.

## Report semantics

Every report retains both observed and declared classification. Declared metadata may refine ambiguous evidence, but a contradiction is recorded and the observed class stays authoritative. The four facets are:

- Evidence and accuracy
- Method and reproducibility
- Data richness and depth
- Interpretation and completeness

Grades use `F-` through `S+` (`0` through `17`), plus `N/A` and `Unrated`. The overall grade is the rounded-down mean of applicable facets. Missing interpretation on a scientific asset is a graded completeness failure rather than an omitted facet. A positive contradiction produces an F-range evidence grade.

The `evidenceAccuracy` facet reports bounded checks derived from materialized source data alongside separately labeled declared provenance. Only the observed checks add accuracy points. Caller-supplied review, validation, URLs, identifiers, and bond labels improve traceability but are not independent proof. They cannot unlock an S grade; S-level evidence is reserved for a future trusted verification-receipt channel.

Ranking groups by asset class, then overall tier, facet total, evidence grade, and stable input order. Atom/frame counts contribute only bounded structural evidence. Viewer-inferred bonds never become source topology, and MLIP artifacts are identified as model evidence rather than DFT or experiment.

Rule-backed strengths, gaps, limitations, evidence, and diagnostics carry stable rule IDs. Use `canonicalAssessmentJson(report)` for byte-stable deterministic content; do not include the sibling execution telemetry in historical report hashes.

## Deep mode

`mode: 'deep'` streams supported complete text trajectories, inspects every currently resident frame of a materialized Lupi trajectory, checks coordinate consistency, records named properties, and computes a full content hash when the adapter supports it. Sparse trajectories continue to report authoritative, resident, and inspected frame counts separately; deep mode does not pretend non-resident frames were examined. It supplements the same schema and ruleset and is intentionally unavailable from browser or Cloudflare MCP operations.

## MCP surfaces

- Browser MCP: `lupi.assess_asset` performs bounded fast assessment of the active loaded trajectory, a URL, or an envelope. Private URLs are permitted only when the app itself runs on localhost.
- Cloudflare MCP: `lupi.assess_asset` accepts an envelope or a public HTTPS URL in `LUPI_PUBLIC_ORIGIN`, `LUPI_LARGE_ASSET_BASE_URL`, or `ASSET_BASE_URL`. Local, private, link-local, credentialed, unapproved, and unsafe redirect targets are rejected.

## Verification and reference budget

```bash
pnpm --filter @atlas/assessment test
pnpm --filter @atlas/assessment build
pnpm --filter @atlas/ui test
pnpm cloudflare:test
```

The performance fixture evaluates 100 small local assets in under three seconds (`assessment.test.ts`; CI runs it on Ubuntu with Node 22). Fast-mode memory and source bytes remain bounded by concurrency and sample size, not source-file size.
