# Viewer UI Cleanup — Evaluation & First Pass

An evidence-based audit of the viewer UI (panels, controls, atom coloring)
turned up real logical inconsistencies, an unreachable feature, and duplicated
code paths. This pass fixes the highest-impact items and condenses the worst
duplication. The store/renderer data model was left untouched — the complexity
lived in the presentation layer.

## Shipped in this pass

### 1. Atom color UI — condensed from two groups to one (flagship)
The "Atoms" color controls had grown into two stacked control groups: a scheme
picker, plus a second group whose **title and contents changed** based on the
selected scheme (`Elements` / `Color` / `Palette`), with the property selector
living awkwardly in the first group.

- Collapsed into a **single "Color" group**: pick a scheme, then tune the one
  control that scheme actually uses.
- Each scheme now shows its **tagline** as a one-line hint (the `tagline` field
  in `SchemeProfile` existed but was never surfaced).
- **Removed the dead colormap rail for Botanical** — Botanical paints from a
  fixed hand-tuned palette (`atomColorSource: 'botanical'`) and ignores the
  colormap entirely, so the rail did nothing there. It now shows only for
  Family and Property, the two schemes that are colormap-driven.
- Replaced an inline accent ternary with a `SCHEME_ACCENTS` map.

### 2. Logic fix — Botanical was unselectable
`StudioControlDeck` filtered Botanical out of the scheme picker unless it was
*already* active (`atomColorSchemes` memo), so it could never be chosen from a
cold start. The filter is gone; all schemes render from `SCHEME_ORDER`.

### 3. Logic fix — the `v` keyboard shortcut was broken
Pressing `v` set `activePanel = null` while setting `studioDeck = 'look'`. Both
the desktop dock and the mobile sheet render off `activePanel`, so the panel
never appeared — the shortcut toggled a dangling piece of state. It now toggles
the Controls panel correctly (and keeps the studio invariant intact).

### 4. Duplication — one panel body for desktop and mobile
The 7-way `activePanel` → component switch was copy-pasted in two places
(`PanelHost` for the desktop dock, the bottom sheet in `App.tsx`) and had
already drifted (mobile showed a redundant close button inside the export
panel). Extracted to a single `ViewerPanelBody` consumed by both. Adding or
changing a panel is now a one-place edit, and the export close button is
consistent. Removed six now-unused panel imports from `App.tsx`.

## Verification
- `tsc --noEmit` passes across the monorepo.
- `store.test.ts` passes (22/22).

## Audited but deliberately NOT changed
- **"Unused" colormaps (magma, cividis, ocean, fire, …):** an audit pass
  flagged 9 colormaps as dead because they're absent from StudioControlDeck's
  curated set. They are **not** dead — `XRControlPanel`, `mcpViewerBridge`, and
  `Testbed` all expose them. Removing them would break those surfaces.

## Recommended follow-ups (larger, want a green light first)
- **Consolidate button variants** — `ToolButton`, `CameraPresetButton`,
  `TransportButton`, `MobileTabButton`, `LupiButton`, plus hand-rolled
  `lupine-btn` usages → one `<Button variant>` factory.
- **Shared icon module** — `IconClose` and friends are re-defined per file with
  "local copy avoids a circular dep with App.tsx" comments; a leaf `icons.tsx`
  removes the duplication and the circular-dep workaround.
- **Extract a typography/color token module** — ~280 ad-hoc `*Style` objects and
  repeated rgba literals; a small `styles/tokens.ts` would cover most.
- **Split the god-components** — `StudioControlDeck` (Look/Surface/World), and
  `mcpViewerBridge` (protocol vs generation vs UI) have clean extractable seams.
- **Centralize panel open/close** — entry points (launcher, tab bar, shortcuts,
  command palette) coordinate `activePanel`/`studioDeck`/`showPotentialBrowser`
  inconsistently; one `openPanel/closePanel` helper would enforce the invariants
  by construction instead of via a cleanup effect.
