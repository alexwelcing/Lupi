# Mobile Viewer UI Overhaul

A focused pass on the phone viewing experience, taking inspiration from the
Lupine mobile controls work and pushing further on layout, reachability, and
visual coherence. All changes are scoped to the viewer chrome — no renderer,
parser, or data behavior is touched.

## What changed

### Persistent bottom tab bar
- The mobile quick-actions pill is now a **persistent tab bar** (`<nav>`) that
  stays mounted whenever a molecule is on screen — including while a panel is
  open — so Play / Controls / Atoms / Search are always one thumb-tap away.
  Previously the bar disappeared the moment any panel opened.
- Tabs carry a **clear active state** (teal fill + glow) and **toggle**: tapping
  the active Controls or Search tab closes the panel instead of being a no-op.
- New shared `MobileTabButton` control (in `controls.tsx`) with 40px+ hit
  targets and tactile press feedback.

### Bottom sheet
- The sheet is now a **floating rounded card** that **docks above the tab bar**
  (and above the timeline when a trajectory is loaded) so the two never overlap.
- Added a **dimming scrim** behind the sheet; tapping the dimmed scene closes it.
- Smooth slide-up entrance, larger drag handle (44×5), and a bigger, higher-
  contrast close button.
- Tighter sheet heights (`clamp(240px, 34dvh, 320px)`, studio
  `clamp(340px, 54dvh, 520px)`) leave more of the scene visible.

### Header & floating launchers
- Mobile loaded-header trimmed from 76px → 64px with safe-area-aware padding.
- Camera-view selector and Controls launcher reposition cleanly below the
  header (`safe-area + 108px`) and **dim out of the way** (lower z, reduced
  opacity, non-interactive) while a panel is open.

### Timeline
- Safe-area-aware height and padding so transport controls clear the home
  indicator; tighter spacing and non-shrinking control clusters on mobile.
- Speed selector active state moved from amber to the viewer's **teal accent**
  (`#1edce0`) for a consistent accent system.

### Controls drawer & studio deck
- Tighter, less redundant drawer chrome (the sheet already provides the handle
  and close), compact studio-deck header, two-column segment layout in the
  drawer, and an active-tab glow on the Look / Surface / World / Export tabs.
- "Copy look link" is now a proper full-width button with a 40px touch target.

## Verification
- `tsc --noEmit` passes across the monorepo.
