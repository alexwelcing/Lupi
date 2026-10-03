# Lupi Live plugin — development verification

> Historical receipt for the 29 September PubChem-only branch. It predates the OMol25-first plugin and its current main-base implementation; test counts, versions, and release status below do not describe the current branch. See [the current guide](chatgpt-plugin.md).

29 September 2026

This implementation prepares the PubChem resolver, embedded molecule viewer,
MCP Apps connection, and portable plugin package. **The first launch milestone
remains open until the flow succeeds through an installed ChatGPT connection.**
The browser evidence below comes from an explicitly labeled development MCP
host, not ChatGPT. No deployment, installation, submission, approval, or public
publication was performed during this work.

## Source and scope

The implementation starts from Lupi main revision
`30bc7c481a7c629c39eaebd81bcfc71d5222ba47`. The verifier records that base,
working-tree changes, and source-file hashes alongside its receipts. The
launch example is **L-theanine, PubChem CID 439378**. The public adapter is
`/chatgpt/mcp`; the existing `/mcp` control plane retains its original role.

The package version is `0.1.0`. Server/client/core SDK packages are pinned to
`2.2.0`, MCP Apps to `2.0.3`, and Zod to `4.6.5`. The implementation uses the
SDK's Streamable HTTP transport, its Cloudflare validator, and the MCP Apps
bridge. Lookup and rendering remain separate tools.

## Live PubChem evidence

Actual external requests, rather than fixtures or gallery assets, supplied the
launch structure. `cacheMode: "refresh"` bypasses Lupi's cache and sends
`no-store`/`no-cache` upstream. PubChem's own internal caching is outside Lupi's
control. Raw request/response receipts are included with the development
verification artifacts.

| Field | Observed result |
|---|---|
| Source identity | L-Theanine, CID 439378 |
| Formula | C7H14N2O3 |
| Coordinates | Source-declared computed 3D conformer, angstroms |
| Atoms | 26, including explicit hydrogens |
| Bonds | 25: 23 single and 2 double |
| Nitrogen atom IDs | PubChem AIDs 4 and 5 |
| 3D source response | HTTP 200, 13,113 bytes |
| Raw 3D record SHA-256 | `6e813b077b9a866c96ba3e1152aad31de96f1fd997dd8e54bc1ef3d00ba26133` |

The checks compare every source atom ID, atomic number, coordinate, bond
endpoint, and bond order across retrieval and presentation. Carbon dioxide
(CID 280) supplies an independent second live structure with three atoms and
two double bonds. Its source-declared 3D coordinates remain labeled 3D even
though the geometry is linear. Recorded 2D fallback tests use depiction units
and do not assert physical distances.

## Automated checks

| Scope | Passing tests |
|---|---:|
| Shared PubChem resolution and parsing | 44 |
| Existing browser loader integration | 8 |
| Source bond rendering and inference fallback | 4 |
| Widget result, identity, and selection contract | 12 |
| New MCP adapter and admission control | 43 |
| Existing Worker route regression suite | 54 |
| **Total in `pnpm chatgpt:test`** | **165** |

The checks cover exact source identity, ambiguity, missing records, wrong
references, changed-source rejection, upstream timeouts, source dimensionality,
bounded responses, cache refresh/expiry, two distinct cards, strict schemas,
resource metadata/CSP, missing assets, HTTP method/origin/body limits, and the
absence of destructive tools. A held-request test proves that four distinct
lookups can be active, duplicates coalesce, a fifth receives `busy` without an
upstream request, and capacity is released after both success and failure.

Full TypeScript checks pass for core, UI, widget, and Worker. Widget lint passes;
the broader scoped lint has no errors and retains two pre-existing unused
parameter warnings in `Bonds.tsx`. The final lockfile passes a frozen offline
installation check with pnpm 9.0.0. The environment required restoration of
locked native build packages and a serial registry retry before installation
completed; package tarballs were verified against lockfile integrity values.

The full repository `pnpm build` command used by the production workflow passes
all 12 build tasks (1 minute 47 seconds, no cached tasks). The final frozen,
offline dependency check also succeeds across all 16 workspace projects.
The widget and full web production builds pass. The web asset build includes
the exact widget HTML at `/chatgpt-widget/index.html`. Wrangler 4.110.0 dry-run
packaging also passes with the existing asset bindings and no deployment.

## Local browser acceptance

The development host uses the official SDK Client and AppBridge with an
opaque, script-enabled iframe and explicit CSP. Chromium 147 provides
software WebGPU/WebGL2 in this environment. The mobile lanes emulate a
390-pixel touch viewport; they do not test a physical phone.

The canonical run below verifies the final component and server source. It
checks actual rendered atom
and bond instances, framebuffer changes during rotation and zoom, stable
nitrogen highlighting, model-context messages, reset, separate compounds,
complete-result replay, and the useful no-graphics state. Browser-side
requests to external domains are not needed by the component.

**Canonical run:** `2026-09-29T20-42-01-154Z` (20:42–20:45 UTC).
All **96 checks** passed: 24 protocol/live-source checks and 72 browser checks.
The receipt captures 28 actual upstream PubChem requests. No browser lane had
an uncaught JavaScript error or an external component network request.

| Lane | Result | Initial show-tool → interactive | Cached follow-up → interactive |
|---|---|---:|---:|
| WebGPU / desktop | Passed (17 checks) | 5.869 s | 5.376 s |
| WebGPU / mobile | Passed (14 checks) | 5.551 s | — |
| WebGL2 / desktop | Passed (17 checks) | 6.726 s | 5.328 s |
| WebGL2 / mobile | Passed (14 checks) | 6.824 s | — |
| No graphics / desktop | Passed (10 checks) | Fallback verified | — |

Each timing is one observed local sample. Initial lookup-to-interactive times
were 6.144 s, 16.693 s, 14.655 s, and 16.063 s for the four graphics lanes
in table order; those include the separate fresh PubChem lookup. The no-graphics
fallback was useful and source-linked without claiming a ready renderer.

**Final component:** 2,976,855 bytes; SHA-256
`c74dab786734861a6fa7a307d4d2b4d839373cc7e91510f9097c90f3cdd32f60`.
The production asset copy has the same bytes. Full report, raw HTTP responses,
SDK bridge events, and actual screenshots accompany the downloadable evidence
bundle. The standard verifier recreates this directory under
`.verify-artifacts/chatgpt/<timestamp>/`.

Single local timings are not p95 measurements. The three-second cached-card
target and the 20/20 model prompt-selection target remain unproven. Tool calls
in the verifier exercise the API directly; they do not establish whether
ChatGPT will choose the tools for outcome-only prompts.

## Portability repairs made during verification

- Source topology now bypasses bond inference workers and retains the existing
  inference path for other Lupi views. Stale inference replies cannot replace
  a newly supplied source bond table.
- The embedded build omits one pinned, unused Drei developer-inspector warmup
  that accessed browser storage during module initialization. The match is
  asserted so a dependency upgrade requires review. Renderer/control imports
  and iframe isolation remain intact.
- Offscreen cards remain pending while the browser throttles animation frames;
  a wall-clock delay no longer permanently labels them as graphics failures.
- The narrow viewport has separate readable rotate and zoom instructions.
- Seven existing implicit callback parameters received explicit types in five
  UI files so the full web build passes; those annotations change no runtime
  behavior.

Bond cylinders depict source connectivity. The payload preserves source bond
orders, and the card explains that the drawing does not use separate multiple
bond cylinders. Display radii are illustrative. No molecular simulation or
new scientific conclusion is produced.

## Worker runtime and remaining launch work

A local `workerd` run completed initialization, tool discovery, UI resource
reads through `WEB_ASSETS`, and strict input validation. Its direct upstream
network probe failed because this execution environment could not resolve
PubChem DNS. Independent minimal global, detached, and cache-enabled fetch
probes reproduced that DNS failure. The live Node-backed development host
retrieval passed. **Hosted Cloudflare-to-PubChem retrieval remains untested.**

Before broad traffic, enforce PubChem's application/organization-wide
[five-request-per-second limit](https://pubchem.ncbi.nlm.nih.gov/pcfe/docs/markdown/pug-rest.md).
The four-job admission limit and bounded cache operate per isolate; they do
not provide distributed pacing. The 30-second deadline applies to upstream
resolution, while inbound connection/body timing remains a deployment control.

The draft package intentionally leaves category, support, privacy, terms, and
actual installed-host video metadata incomplete. Publisher/domain readiness,
actual ChatGPT desktop/mobile behavior, discovery prompts, policy pages,
recording, submission, approval, and fresh-user installation remain release
tasks. The existing GitHub workflow deploys production on a merge to `main`;
review this change before taking that release action.

See [the development and release guide](chatgpt-plugin.md) for commands,
review cases, package contents, and the exact ChatGPT acceptance procedure.
