# Lupi Live in ChatGPT

Development implementation and release guide • 29 September 2026

The first workflow is **“Show me L-theanine from PubChem”**, followed by
**“Highlight its nitrogen atoms.”** The launch record is PubChem CID **439378**.
The molecule must come from a real PubChem request, with its source atom IDs,
coordinates, and bond table preserved.

This branch prepares a public MCP adapter, an embedded viewer, and a portable
plugin package. The intended endpoint in the package is
`https://lupi.live/chatgpt/mcp`. Its presence in a manifest is **not evidence that
the route is deployed or that ChatGPT has rendered it**. Keep source retrieval,
local tests, host testing, deployment, and public publication as separate
results. No installation, submission, or publication is performed by the
package builder.

See [development verification](chatgpt-plugin-verification.md) for the measured
results, artifact hashes, runtime limits, and remaining launch evidence.

## Implementation boundary

| Component | Source | Responsibility |
|---|---|---|
| Shared PubChem adapter | `packages/core/src/pubchem.ts` | Name/CID resolution, bounded retrieval, source atom IDs and bonds, coordinate-dimension labeling |
| Public MCP adapter | `apps/mcp-worker/src/chatgpt.ts` | Two public read-only tools, pinned structure references, bounded caching, UI resource |
| Embedded viewer | `apps/chatgpt-widget/` | Lupi scene/renderer reuse, local rotation and zoom, source identity, highlighting, MCP Apps bridge |
| Portable package | `plugins/lupi-live/` | Manifest, remote MCP connection, molecule workflow skill, brand asset, review cases |
| Package builder | `tools/package-chatgpt-plugin.mjs` | Offline package checks and deterministic ZIP creation |

The public route is separate from the existing `/mcp` control plane. It exposes
`resolve_molecule` and `show_molecule`; it does not expose legacy render jobs,
the full browser control surface, an arbitrary URL fetcher, or a new chemistry
engine. It needs no Lupi account, API key, model call, or paid render service for
the public molecule flow.

### Dependency generation

The new adapter and component use these exact versions, verified against npm
metadata during implementation:

| Package | Pin |
|---|---|
| `@modelcontextprotocol/server` | `2.2.0` |
| `@modelcontextprotocol/client` | `2.2.0` |
| `@modelcontextprotocol/core` | `2.2.0` |
| `@modelcontextprotocol/ext-apps` | `2.0.3` |
| `zod` | `4.6.5` |

The [MCP Apps v2 migration guide](https://apps.extensions.modelcontextprotocol.io/api/documents/migrate-to-v2.html)
explains the split SDK dependencies. The iframe wire protocol remains
compatible with v1 hosts, but server classes and TypeScript APIs must come
from the same SDK generation. Do not combine unpinned `ext-apps` with the old
`@modelcontextprotocol/sdk` imports shown in some examples.

The Worker imports `McpServer` and `WebStandardStreamableHTTPServerTransport`
from `@modelcontextprotocol/server`. It creates a fresh server/transport for
each HTTP request with `sessionIdGenerator: undefined` and
`enableJsonResponse: true`, then closes the server after the JSON response is
available. This is the negotiated 2025 Streamable HTTP lane; SDK version 2.2.0
does not make this route a 2026-07-28 stateless-protocol endpoint.

Cloudflare uses the SDK's `CfWorkerJsonSchemaValidator` and Zod's `jitless`
configuration. The package's `workerd` export condition supplies the edge
runtime shims. Keep the actual Worker build check: a successful Node test
alone does not verify Cloudflare execution.

## Tool contract

### `resolve_molecule`

```json
{
  "query": "L-theanine",
  "cacheMode": "refresh"
}
```

`query` accepts a compound name, a decimal CID, or a CID form such as
`cid:439378`. `cacheMode` is optional; `prefer-cache` is the default.
`refresh` bypasses Lupi's cached result and requests an upstream response
without HTTP cache reuse. PubChem's internal caching is outside this adapter's
control.

A resolved result identifies `structureRef`, `cid`, `name`, `formula`,
`sourceUrl`, `recordUrl`, `retrievedAt`, `dimension`, `coordinateUnits`, atom and
bond counts, element counts, and `cacheHit`. Keep these fields model-visible.
The structure reference pins the returned identity and geometry. It is not a
mutable session-wide “current molecule.”

For an ambiguous lookup, return source-labeled candidates and ask the user to
choose. For not-found, invalid input, upstream failure, or an unsupported
record, return the explicit failure. Never replace a failed lookup with a
bundled gallery molecule.

### `show_molecule`

```json
{
  "structureRef": "<exact reference returned by resolve_molecule>",
  "view": {
    "style": "ball-and-stick",
    "highlightElements": ["N"]
  }
}
```

The other style is `spacefill`. `highlightAtomIds` accepts stable IDs from the
PubChem record, not an atom's position in a JavaScript array. The server
resolves element highlights into source IDs and rejects absent elements or
IDs. Follow-ups retain the same reference. A reopened card can re-fetch its
CID, but if the current source record no longer matches the pinned digest,
the adapter requires resolution again rather than silently changing the
geometry.

The model-readable result says the view is prepared and reports the selected
IDs. `renderStatus: "awaiting-component"` deliberately does not claim that the
iframe has rendered. Geometry travels in result `_meta.molecule`, with view
data in `_meta.view`, for the component. Each call is a complete presentation;
the host may create a new card for a follow-up.

The first release bounds source records to 512 atoms and 2,048 bond entries,
upstream responses to 1 MiB, and each PubChem resolution to a 30-second deadline.
Each isolate admits at most four distinct in-flight lookups; an excess request
receives an explicit busy result and does not start an upstream request. Its cache is
opportunistic and bounded per Worker isolate; it is not an account store or
cross-device saved-view feature. Consult the source constants if changing
these limits.

Before public traffic, configure shared upstream pacing across Worker isolates.
[PubChem's usage policy](https://pubchem.ncbi.nlm.nih.gov/pcfe/docs/markdown/pug-rest.md)
limits each application or organization to five requests per second. A name
lookup uses three upstream requests, or four when 3D is absent. The current
adapter coalesces identical in-flight lookups and bounds its cache, but those
per-isolate measures do not enforce an organization-wide rate limit. Record
that operational check with the deployment evidence before broad rollout.

## Embedded UI contract

Only the render tool declares `_meta.ui.resourceUri`:
`ui://lupi/molecule-v1.html`. The resource is returned as
`text/html;profile=mcp-app`. The Worker reads the built component HTML through
`WEB_ASSETS` at `/chatgpt-widget/index.html`; the package ZIP does not carry the
running server or deploy the component.

The component registers its tool-result handler before `App.connect()` and
uses the MCP Apps bridge. It keeps camera gestures local, reports useful
selection context with `updateModelContext`, and uses `openLink` for source
and website links. Feature-detect optional host behavior and show a useful
unavailable state if the bridge or graphics cannot start.

The UI declares `https://lupi.live` as its component origin for this one
plugin. OpenAI requires that origin to be unique per submitted UI plugin;
there is no documented requirement to create a new subdomain when an origin
already belongs to only one plugin. Do not reuse this component origin for a
second plugin. The component is bundled with a narrow CSP; add an external
domain only when the component actually needs it. Do not iframe the entire
Lupi website as a substitute for the embedded component.

The widget's Vite configuration omits the pinned Drei package's eager
developer-inspector warmup. That optional module reads `localStorage` during
initialization, which fails in an iframe with an opaque origin. The transform
is limited to the embedded bundle and checks for exactly one known warmup;
review it when upgrading Drei and repeat the sandboxed-iframe check.

PubChem views use the validated source connection table. The shared `Bonds`
component does not create its inference Worker when inference is disabled,
so these views work without granting Worker/blob execution through the
component CSP. Preserve this behavior when changing the shared scene code.

The URI is a component cache key. Change it when making a breaking change to
the bundle, and update the tool metadata and acceptance evidence together.
See [OpenAI's UI guide](https://developers.openai.com/plugins/build/chatgpt-ui)
and [UI reference](https://developers.openai.com/plugins/reference).

## Local development and verification

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm chatgpt:build
pnpm chatgpt:test
pnpm chatgpt:package --check
```

To inspect the local SDK host manually:

```bash
pnpm chatgpt:dev
```

The scoped verifier starts and stops its own local server on an available
port. It does not require the manual development host:

```bash
pnpm chatgpt:verify
```

The manual host defaults to `http://127.0.0.1:4319`. Verification receipts
belong under `.verify-artifacts/chatgpt/<timestamp>/`. Keep the exact command,
commit/diff, tool versions, network mode, results, and screenshots together.
Mocked-source checks prove error handling and invariants; a separate run must
exercise a real uncached PubChem request. A local MCP Apps harness is useful
for the bridge and renderer but is not a ChatGPT installation test.

For direct HTTP debugging, send `Content-Type: application/json` and
`Accept: application/json, text/event-stream`. The SDK requires both accepted
response types even when this route returns JSON. Exercise initialization,
tool and resource listing, resource reads, both tool calls, notification
responses, and invalid schemas with an MCP client. Check negotiation at
`2025-03-26` and `2025-11-25`. This stateless route responds `405` to standalone
GET and DELETE requests; it does not advertise resumable sessions.

### Package artifact

```bash
pnpm chatgpt:package --output=.verify-artifacts/chatgpt-plugin/lupi-live-0.1.0.zip
```

The archive contains `plugin.json`, `mcp.json`, `skills/`, `assets/`, and the
existing license notices at its root. It contains no development dependencies
or secrets. Identical source files produce identical archive bytes; the
builder prints a SHA-256 digest. Its offline checks cover the package's shape,
referenced files, icon, skill metadata, review-case counts, and stable route.
They do not replace the publisher portal's validation.

The package intentionally omits unverified public-submission fields. To see
the remaining metadata requirements, run:

```bash
pnpm chatgpt:package --submission
```

An incomplete metadata check exits nonzero. This does not invalidate a draft
package and does not install or submit it.

## Actual ChatGPT acceptance

Follow the current [connection and testing guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
For development, use a publicly reachable HTTPS endpoint or Secure MCP Tunnel.
Local plaintext HTTP by itself is not reachable from ChatGPT. A development
tunnel does not replace the stable public endpoint needed for submission.

1. Enable developer mode where the account/workspace permits it. Register the
   isolated MCP connection and inspect the two discovered tools.
2. In a new conversation, request a fresh L-theanine PubChem lookup. Confirm
   the run sends `cacheMode: "refresh"`, returns CID 439378 with
   `cacheHit: false`, and records the external source request and timestamp.
3. Confirm that the inline card shows the returned identity, source link, and
   dimension. Rotate and zoom the actual molecule. Capture the real host UI.
4. Ask to highlight nitrogen. Check that the compound/reference is unchanged
   and only the returned nitrogen IDs are selected. Record whether the host
   updated a card or opened another.
5. Package and install the complete plugin through a supported local source.
   Repeat the flow with the bundled skill active. A working bare MCP
   connection does not prove that the packaged skill and connection work
   together.

After server metadata, tool schemas, authentication, or resource changes,
refresh the development connection and start a new conversation before
retesting. Record the actual desktop/mobile host, account/workspace conditions,
browser/device, and renderer backend. Do not claim WebGPU, WebGL2, or mobile
compatibility from source inspection alone.

The five positive and three negative cases in `plugin.json` are **test
definitions**, not test receipts. Also exercise: upstream timeout/rate limit,
missing 3D coordinates, wrong or expired reference, iframe/CSP failure, no
graphics support, two open compounds, and reopening a conversation. Test
source ambiguity with a controlled multi-CID response as well as a realistic
user clarification. A source link, static image, or external website handoff
does not satisfy the in-chat interaction requirement.

## Submission readiness

The package is a development draft. Before a public submission, complete the
publisher/domain setup and collect actual host evidence. In particular:

| Item | Current package state |
|---|---|
| Product website | `https://lupi.live` is the existing brand URL; verify the intended plugin route independently |
| MCP URL | Intended stable route is declared; no deployed-route assertion follows from packaging |
| Listing category | Omitted until selected from the current portal categories |
| Support page | Omitted; no support contact or monitored inbox has been invented |
| Privacy policy and terms | Omitted; publish and verify the actual policies before adding their URLs |
| Icon | Existing repository brand asset, copied unchanged |
| Review cases | Five positive and three negative definitions included; execute and retain receipts |
| Demo and screenshots | Real installed-host recording required; no placeholder video URL or fabricated screenshots |
| Publisher/domain verification | Complete through the publisher portal; not established by this branch |
| Installation, approval, publication | No such action is performed by these source or packaging commands |

Current submission guidance requires website, support, privacy, and terms URLs
for MCP review. Add them to `extensions.com.openai.interface` only after they
are real. Add the actual video URL to `extensions.com.openai.review`.
Credentials, if an account flow is ever added, belong in the portal's secure
review form and not in this package.

The current publishing flow does not support changing an existing MCP URL
without support. Keep `/chatgpt/mcp` stable before initial publication. Hosted
tool changes and package/skill changes follow different update paths; verify
the [current submission guide](https://developers.openai.com/plugins/deploy/submission)
before releasing. The existing deployment workflow runs on pushes to `main`,
so review this branch before a merge that could deploy the route.

## Documentation references

- [Plugin architecture](https://developers.openai.com/plugins/concepts/plugins)
- [Portable plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [MCP Apps UI guide](https://developers.openai.com/plugins/build/chatgpt-ui)
- [OpenAI UI metadata and annotations](https://developers.openai.com/plugins/reference)
- [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Upload and submit](https://developers.openai.com/plugins/deploy/submission)
- [MCP TypeScript SDK releases](https://github.com/modelcontextprotocol/typescript-sdk/releases)
- [MCP Apps v2 migration](https://apps.extensions.modelcontextprotocol.io/api/documents/migrate-to-v2.html)
- [MCP Apps App bridge API](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html)
- [L-theanine on PubChem](https://pubchem.ncbi.nlm.nih.gov/compound/439378)

Recheck these contracts before each public release. This implementation does
not create a recurring monitoring task.
