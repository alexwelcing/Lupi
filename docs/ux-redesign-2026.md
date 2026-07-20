# Lupi 2026 experience redesign

This experience brief implements the normative
[Lupi product ownership contract](product-ownership-contract.md). If an older
phase or success measure conflicts with that contract, the contract wins.

## Product outcome

A first-time visitor should be able to open a useful 3D structure, rotate it,
understand what its colors mean, and find the next relevant action without
documentation or a guided tour.

The complete owned outcome continues through inspect, measure/analyze with
units and provenance, save/reopen, and export/share. A visually successful first
viewport is only the entry to that loop.

Lupi remains visually distinctive: matter, light, scale, and the cinematic
archive are the brand layer. Navigation and controls use literal language so a
visitor never has to translate the poetry before acting.

## Canonical product language

Use these verbs consistently across navigation, headings, analytics, and help:

- **Explore** — curated molecules, materials, and simulations.
- **Search** — all connected structure sources.
- **Learn** — guided activities and the adaptive Study Guide.
- **Upload** — a researcher's files, URL, or pasted data.
- **Research** — hand off to the separately owned `lupine.science` research
  surface. Viewer-attached external evidence and provenance appear under Learn
  or Analyze; Lupi does not run experiments, choose MLIP policy, adjudicate
  claims, or generate synthetic evidence.

Inside the viewer:

- **Structure** — atoms, bonds, color, and data arrows.
- **Background** — simple backdrops, environments, lighting, and reference guides.
- **Analyze** — properties, measurements, selection, and provenance.
- **Learn** — the Study Guide.
- **Export** — figures, video, and 3D assets.

Avoid using *body*, *world*, *scene*, *grade*, or *lens* as an action label.
Those words may remain in editorial copy when their meaning is clear.

## Interaction model

### Homepage

The first viewport must answer four questions in order:

1. What is Lupi? A browser-based 3D molecule and materials viewer.
2. What can I open? A named example, a simulation, or my own data.
3. What can I do? Rotate, inspect, reveal properties, and export.
4. What should I click? Search, an example chip, or Open your data.

The lightweight landing boundary remains mandatory. Do not import Three.js,
React Three Fiber, postprocessing, or viewer-native rendering into
`LandingShell`; the live viewer should load only after molecule intent.

### Viewer

Progressive disclosure has four layers:

| Layer | Contents |
| --- | --- |
| Always visible | Structure preset, color meaning, camera view, Analyze, Learn, Export |
| Selection context | Atom identity, focus, measure, label, isolate, neighbors |
| Settings drawer | Bonds, atom appearance, reference guides, simple background |
| Advanced | Rendering style, sensitivity values, immersive environments, lighting, atmosphere, developer tools |

A control should describe an outcome before exposing a parameter. For example,
“Inferred bonds — see likely distance-based connections” comes before atom size
and bond sensitivity.

### Contextual guidance

Help is ambient and dismissible:

- “Drag to rotate · Scroll or pinch to zoom · Select an atom to inspect.”
- Dataset-specific prompts only when the capability exists, such as trajectory
  playback, a unit cell, properties, or force vectors.
- A future Help surface can replay gestures and show task recipes; it should not
  become a mandatory carousel.

## Implemented in the first pass

- Reframed the hero around a clear product statement and one-click structures.
- Added local example search with full-library handoff for unmatched queries.
- Made field-index choices apply the corresponding library filter.
- Standardized landing navigation around Explore, Learn, Research, and Upload.
- Replaced the initial structure-settings wall with four task presets:
  Balanced, Inferred bonds, Occupied space, and Property map.
- Kept large structures atoms-first by disabling costly bond/volume presets and
  retaining the diagram renderer at 200,000 atoms and above.
- Kept color meaning and available data arrows visible; moved presentation
  grading, atom material, and bond sensitivity under Fine-tune structure.
- Made simple backgrounds and reference guides primary; moved immersive worlds,
  lighting, projection, and atmosphere under Advanced.
- Removed the duplicate desktop Export tab while retaining the mobile path.
- Kept saved views and sign-in in the account menu while moving MCP, endpoint,
  token, and bearer controls behind explicit developer mode.
- Added first-use canvas gesture guidance.
- Made mobile Learn and Style surfaces mutually exclusive.
- Repaired upload keyboard semantics and same-file retry behavior.
- Corrected the repository link and license statement in the footer.

## Next phases

### P0 — scientific comprehension

- Preserve and harden the existing atom selection/fact HUD so element, stable
  identity, coordinates, and available properties remain the shared foundation
  for canvas and keyboard inspection.
- Add measurement actions for distance and angle without requiring a separate
  selection mode, with explicit unit and provenance semantics.
- Add a clear **Reset view** and **Reset appearance** action; introduce undo for
  reversible visual changes.
- Separate supplied bonds/properties from visually inferred bonds in both labels
  and provenance.
- Make the Study Guide adapt its first section to molecule, crystal, trajectory,
  and knowledge-graph content.

### P1 — navigation and mobile

- Consolidate Style, Analyze, Learn, Animate, and Export into one panel model on
  mobile, with only one surface active at a time.
- Reduce the mobile trajectory footer to play/pause, scrubber, and frame count;
  put stepping and speed in an overflow menu.
- Move flythrough, immersive backgrounds, XR, and MCP/token inspection into More
  or Developer tools.
- Add a dedicated Explore route so the homepage can show a small starter set
  instead of embedding the full research workbench.

### P2 — connected scientific views

- Synchronize 3D selection with composition, atom/property tables, plots, and
  trajectory annotations.
- Add short guided stories that progress from overview to one scientific idea
  per scene.
- Add high-contrast and color-vision-safe viewing presets plus a structured text
  alternative to the canvas.

## Success measures

These are product targets, not release evidence. They require a named analytics
owner, a documented denominator, and validated instrumentation before they may
be reported as measured results. Release status follows the
[release truth contract](release-truth-contract.md).

- Median time to first live structure: under 10 seconds.
- At least 80% of first-time visitors open a structure without help.
- First successful rotate or zoom: under 20 seconds.
- At least 70% can find provenance and change the structure view.
- Mobile users can complete Open → Rotate → Learn → Return with no overlapping surfaces.
- No core action requires hover, right-click, horizontal discovery scrolling, or
  knowledge of a scientific rendering parameter.

## Reference direction

- [RCSB Mol* common actions](https://www.rcsb.org/docs/3d-viewers/mol%2A/common-actions)
- [RCSB Mol* getting started](https://www.rcsb.org/docs/3d-viewers/mol%2A/getting-started)
- [Mol* display presets](https://molstar.org/viewer-docs/managing-the-display/)
- [MolViewStories](https://molstar.org/mol-view-stories/)
- [WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [WCAG dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
