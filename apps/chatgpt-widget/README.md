# Lupi Live embedded molecular viewer

This workspace builds the versioned MCP Apps resource `ui://lupi/molecule-v2.html`.
The production output is one self-contained `dist/index.html`, with local JavaScript,
CSS and worker code inlined. It uses Lupi's shared `LupiCanvas`, `AtomsOptimized` and
`Bonds` on the existing Three WebGPURenderer stack, including its WebGL2 fallback.

```sh
pnpm --filter @atlas/chatgpt-widget build
pnpm --filter @atlas/chatgpt-widget test
```

The edge build copies the HTML to `/chatgpt-widget/index.html` in its static assets.
The resource has an identifying `lupi-widget=molecule-v2` meta tag so the MCP server
can distinguish it from a mistaken SPA fallback response.

## Result contract

Register the MCP Apps `App` result callback **before** connecting to the host.
Every render is derived solely from that call's self-contained result:

```ts
{
  structuredContent: {
    status: 'shown', structureRef, source, name, dimension,
    view: { style: 'ball-and-stick', highlightAtomIds: [], highlightElements: [] }
  },
  _meta: {
    molecule, // validated lupi.omol25.v1 or lupi.pubchem.v1 record
    view: { style: 'ball-and-stick', highlightAtomIds: [], highlightElements: [] }
  }
}
```

The visible molecule is validated through `@atlas/core/omol25` or
`@atlas/core/pubchem`. Source row or CID, name, dimensionality and view must
agree with the model-readable result. Geometry never
comes from a prompt, a bundled gallery molecule, or global latest-compound state.
There is no default demo structure when the HTML is opened directly.

PubChem source AIDs or OMol25 row-order IDs are the selection identifiers. The
scene resolves selected IDs to source-coordinate subsets, uses the same atom
renderer for the highlight, and disables inferred bonding.
`AtomsOptimized.highlightedAtoms` currently has no
effect, so the widget does not depend on that prop. Source bond orders are preserved
in PubChem records. OMol25 has no supplied bond topology and draws atoms only.
The shared bond renderer depicts PubChem connectivity cylinders;
the source details make that presentation limit explicit. Space-fill atom radii are
display-scaled, not a quantitative van der Waals surface.

Validated source bonds are applied directly by the shared `Bonds` component.
The inference worker starts only when inference is allowed, so this source-only
widget does not require blob workers or a worker exception in the host CSP.
Read-only `window.__lupiChatgpt.state()` diagnostics report source metadata and
applied Three geometry instance counts separately for browser acceptance tests.

Element selection, style changes and reset publish `updateModelContext` with this
card's exact `structureRef`, source identity and bounded view. Camera dragging remains local.
A host may create a new card for a follow-up rather than update an existing one.
When reopening, the app accepts a replay of the original tool result; it does not
claim that unsaved local camera movements or element selections will persist.

## Host and graphics behavior

- Local rotation, pinch/scroll zoom, zoom buttons and reset use shared viewer controls.
- Keyboard controls: arrow keys rotate a 3D view, `+`/`-` zoom, `Home` resets.
- 2D fallback data is labeled as a depiction with no physical distance units.
- Graphics failure leaves molecule identity, provenance and the source website link visible.
- Offscreen iframes may have animation frames throttled by the host browser.
  Initialization remains pending until the card can render; a wall-clock delay
  alone never labels valid graphics unavailable or permanently unmounts a card.
- The renderer event sink is scoped locally. This build does not import Firebase
  or send account/analytics requests from the embedded resource.
- The pinned drei WebGPU entry eagerly initializes optional developer-inspector
  settings through localStorage. The widget build omits that unused warmup, with
  an exact-block guard for dependency upgrades, so opaque iframes remain supported.
  It does not replace storage or require `allow-same-origin`.
- App-initiated links use the host `openLink` bridge. Denied links show a recoverable notice.
- Expanded presentation is shown only when the host advertises fullscreen support.
- The host supplies molecule data, so this iframe makes no source API request.

Local build, unit tests or a simulated host are not evidence of installation,
ChatGPT iframe compatibility, mobile hardware behavior, listing approval or publication.
