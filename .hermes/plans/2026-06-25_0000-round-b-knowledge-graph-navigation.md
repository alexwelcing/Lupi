# Round B: Knowledge-graph navigation — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn knowledge labels into a real navigation surface for the sphere-grid graph.

**Architecture:** Add pointer-event handlers to knowledge labels that trigger atom selection and camera focus. Extend the store with neighbor-highlighting state. Add a "Show neighbors" toggle to the Atom Info HUD. Implement neighbor dimming via atom color overrides in the Atoms component.

**Tech Stack:** React Three Fiber, Zustand, TypeScript

---

## Task 1: Add click-to-select on knowledge labels

**Objective:** Clicking any label selects the matching atom and triggers camera focus.

**Files:**
- Modify: `packages/ui/src/KnowledgeLabelsLayer.tsx` (add onClick to CardLabel)
- Modify: `packages/ui/src/store.ts` (add `focusedAtom` state if needed, or reuse `selectedAtoms`)

**Step 1: Add onClick handler to CardLabel**

In `KnowledgeLabelsLayer.tsx`, the `CardLabel` component needs an `onClick` prop. When a label with `atomIndex` is clicked, call `useStore.getState().setSelectedAtoms([atomIndex])`.

**Step 2: Verify CameraFocus picks it up**

`CameraFocus.tsx` already watches `selectedAtoms` and moves the camera. No changes needed there.

**Step 3: Test**

Run: `pnpm run test`
Expected: existing tests pass

---

## Task 2: Add hover neighbor highlighting

**Objective:** Hovering a node dims non-neighbor atoms/bonds.

**Files:**
- Modify: `packages/ui/src/store.ts` (add `highlightedNeighbors: Set<number>`)
- Modify: `packages/ui/src/SelectionMarkers.tsx` (add neighbor ring markers)
- Modify: `packages/scene/src/Atoms.tsx` (accept `dimmedAtoms` set, lower opacity for non-neighbors)

**Step 1: Add neighbor state to store**

```typescript
// In store.ts
highlightedNeighbors: Set<number>;
setHighlightedNeighbors: (neighbors: Set<number>) => void;
```

**Step 2: Compute neighbors from knowledge labels**

Knowledge labels don't contain edge data directly. However, the `labels.json` export from lupine-wiki contains edges. We need to load edge data into the store.

For now, compute neighbors from the `degree` property and `nodeId` — or add a `neighbors` field to `KnowledgeLabel` if the export provides it.

Since the current `KnowledgeLabel` type has `degree` but not `neighbors`, we'll add a `neighbors` array to the type and populate it from the export.

**Step 3: In AtomPicker, on hover, set highlighted neighbors**

When `onHover` fires, look up the atom's neighbors from `knowledgeLabels` and call `setHighlightedNeighbors`.

**Step 4: In Atoms.tsx, dim non-highlighted atoms**

Add a `dimmedOpacity` prop. When `highlightedNeighbors` is non-empty, dim atoms not in the set.

---

## Task 3: Add "Focus sphere" action from sphere labels

**Objective:** Clicking a sphere label focuses the camera on the sphere's centroid.

**Files:**
- Modify: `packages/ui/src/KnowledgeLabelsLayer.tsx` (add "Focus" button to sphere CardLabel)
- Modify: `packages/ui/src/CameraFocus.tsx` (accept a manual focus target override)

**Step 1: Add focus target override to store**

```typescript
manualFocusTarget: [number, number, number] | null;
setManualFocusTarget: (target: [number, number, number] | null) => void;
```

**Step 2: In CameraFocus, check manualFocusTarget first**

If `manualFocusTarget` is set, lerp to it instead of the selected atom.

**Step 3: In CardLabel for sphere kind, add a small "Focus" button**

When clicked, call `setManualFocusTarget(label.position)`.

---

## Task 4: Add "Show neighbors" toggle in AtomInfoHUD

**Objective:** The HUD has a working toggle that highlights neighbors of the selected atom.

**Files:**
- Modify: `packages/ui/src/AtomInfoHUD.tsx` (add toggle button)
- Modify: `packages/ui/src/store.ts` (add `showNeighbors` boolean)

**Step 1: Add `showNeighbors` to store**

```typescript
showNeighbors: boolean;
setShowNeighbors: (show: boolean) => void;
```

**Step 2: In AtomInfoHUD, add a toggle row**

When the selected atom has a knowledge label with neighbors, show a "Show neighbors" chip toggle.

**Step 3: Connect to SelectionMarkers or Atoms**

When `showNeighbors` is true and an atom is selected, highlight its neighbors using the same dimming mechanism as hover.

---

## Task 5: Run lint and tests

Run: `pnpm run lint && pnpm run test`
Expected: all pass

---

## Task 6: Open PR

Branch: `feat/round-b-knowledge-graph-navigation`
PR title: `feat(round-b): knowledge-graph navigation`
Body: `Closes #5`

---

## Risks

1. **No edge data in current labels.json** — The current export may not include neighbor arrays. We may need to add edge parsing to `loadGalleryExample.ts` or derive neighbors from the `degree` field alone (which only gives count, not indices).
2. **Performance of neighbor dimming** — Updating instance colors for 600+ atoms every hover could be slow. Use `useMemo` and only update when `highlightedNeighbors` changes.
3. **Bond highlighting** — The bond rendering is complex (GPU/CPU worker). Dimming bonds may require filtering `bondPairs` before upload, which is non-trivial. For Round B, we may scope bond dimming to a follow-up.

## Decision: Scope for Round B

Given the complexity of bond dimming (GPU pipeline, worker, instanced mesh), **Round B will focus on atom highlighting only**. Bond dimming can be deferred to Round C or E when edge data is fully exported.

For neighbor data, we'll add a `neighbors?: number[]` field to `KnowledgeLabel` and populate it from the labels.json export if available, or compute it from the frame's `bonds` array as a fallback (since the sphere-grid is rendered as atoms with implicit bonds).
