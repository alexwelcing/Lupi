# Portable Lupi Asset Assessment

`@atlas/assessment` classifies and grades materialized atomistic assets without rendering, WebGL, molecule generation, or online scientific enrichment. The deterministic report is portable across Node, browsers, and Cloudflare Workers; execution timing and byte telemetry are returned separately.

## Fast path

```bash
pnpm lupi:assess -- ./asset.xyz ./catalog --mode fast --format json
pnpm lupi:assess -- https://lupi.live/gallery/example.glimbin --format ndjson
pnpm lupi:assess -- http://127.0.0.1:8787/asset.xyz --allow-private
Get-Content envelopes.ndjson | pnpm lupi:assess -- --stdin --format ndjson
```

Fast mode is the default. It reads at most 128 KiB from an asset, uses at most two range operations, never materializes the complete trajectory, and continues when another batch item fails. The CLI runs up to eight local and four remote assessments concurrently, applies a five-second remote timeout, and caches reports under `.verify-artifacts/assessment-cache` using source metadata, a sampled-byte fingerprint, the ruleset, mode, and canonical assessment context. Private-network URL inputs require the explicit local-operator `--allow-private` flag. Cache-hit telemetry reports the bytes and operations used to establish cache identity.

Low grades are successful results. `--strict-errors` changes the exit code only for operationally unreadable inputs; unsupported but readable formats return partial `Unrated` reports.

An stdin wrapper may supply `immutableContentId` to enable envelope caching only when that identifier covers the complete immutable payload. The CLI still includes canonical assessment context in the cache identity; mutable database record IDs are not sufficient.

Deep scans are reused only for stdin envelopes carrying a caller-verified `immutableContentId`. Path metadata or a bounded URL/file prefix is not a safe identity for an entire mutable object, so deep local-file and remote results are not cached by default.

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

`--mode deep` streams supported complete text trajectories, inspects every currently resident frame of a materialized Lupi trajectory, checks coordinate consistency, records named properties, and computes a full content hash when the adapter supports it. Sparse trajectories continue to report authoritative, resident, and inspected frame counts separately; deep mode does not pretend non-resident frames were examined. It supplements the same schema and ruleset and is intentionally unavailable from browser or Cloudflare MCP operations.

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

The performance fixture evaluates 100 small local assets in under three seconds on the CI reference environment (Windows x64, Node 22, warm dependency install). Fast-mode memory and source bytes remain bounded by concurrency and sample size, not source-file size.
