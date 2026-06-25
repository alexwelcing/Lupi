# Round D: End-to-end test coverage — Implementation Plan

**Goal:** Prevent regressions in knowledge-label behavior with automated tests.

**Architecture:** Extract a pure `selectVisibleLabels` helper from `KnowledgeLabelsLayer.tsx` so the salience/distance/maxCount logic can be unit-tested without R3F. Add Playwright assertions to the existing `verify-gallery.mjs` harness for label rendering, hover, and density toggle. Add a snapshot test for the sphere-grid gallery card.

**Tech Stack:** Vitest (jsdom), Playwright (Chromium), TypeScript.

---

## Task 1: Extract `selectVisibleLabels` pure helper

**Objective:** Make the label-filtering logic testable outside React Three Fiber.

**Files:**
- Create: `packages/ui/src/knowledgeLabels/selectVisibleLabels.ts`
- Modify: `packages/ui/src/KnowledgeLabelsLayer.tsx` (replace inline useMemo with imported helper)

**Step 1: Write the helper**

```typescript
// packages/ui/src/knowledgeLabels/selectVisibleLabels.ts
import type { KnowledgeLabel } from '../store';

export interface SelectVisibleLabelsOptions {
  labels: KnowledgeLabel[];
  visibleKinds: Set<string>;
  visible: boolean;
  threshold: number;
  maxCount: number;
  cullDistance: number;
  cameraPosition: [number, number, number];
  hoveredAtom: number | null;
}

export interface SelectVisibleLabelsResult {
  visibleLabels: KnowledgeLabel[];
  hoverLabelToRender: KnowledgeLabel | undefined;
}

export function selectVisibleLabels(options: SelectVisibleLabelsOptions): SelectVisibleLabelsResult {
  const { labels, visibleKinds, visible, threshold, maxCount, cullDistance, cameraPosition, hoveredAtom } = options;
  if (!visible || labels.length === 0) {
    return { visibleLabels: [], hoverLabelToRender: undefined };
  }

  const [cx, cy, cz] = cameraPosition;
  const scored: Array<{ label: KnowledgeLabel; dist: number }> = [];

  for (const label of labels) {
    if (!visibleKinds.has(label.kind)) continue;
    if (label.kind === 'sphere') {
      const dx = label.position[0] - cx;
      const dy = label.position[1] - cy;
      const dz = label.position[2] - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist <= cullDistance) scored.push({ label, dist });
      continue;
    }
    if ((label.salience ?? 0) < threshold) continue;
    const dx = label.position[0] - cx;
    const dy = label.position[1] - cy;
    const dz = label.position[2] - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= cullDistance) scored.push({ label, dist });
  }

  scored.sort((a, b) => a.dist - b.dist);
  const kept = scored.slice(0, maxCount).map((s) => s.label);
  const visibleIds = new Set(kept.map((l) => l.id));

  const hoveredLabel =
    hoveredAtom != null
      ? labels.find((l) => l.kind === 'node' && l.atomIndex === hoveredAtom && visibleKinds.has('node'))
      : undefined;
  const hoverLabelToRender =
    hoveredLabel && !visibleIds.has(hoveredLabel.id) ? hoveredLabel : undefined;

  return { visibleLabels: kept, hoverLabelToRender };
}
```

**Step 2: Import and use in `KnowledgeLabelsLayer.tsx`**
Replace the inline `useMemo` with a call to `selectVisibleLabels`, passing `camera.getWorldPosition(...)` result as `cameraPosition`.

---

## Task 2: Unit tests for `selectVisibleLabels`

**Objective:** Cover salience filtering, distance culling, maxCount ceiling, kind filtering, and hover reveal.

**Files:**
- Create: `packages/ui/src/knowledgeLabels/selectVisibleLabels.test.ts`

**Tests:**
1. `returns empty when visible=false`
2. `returns empty when labels array is empty`
3. `filters out kinds not in visibleKinds`
4. `spheres always render regardless of salience`
5. `nodes below threshold are hidden`
6. `nodes at or above threshold are visible`
7. `labels beyond cullDistance are hidden`
8. `only closest maxCount labels are kept`
9. `hovered node below threshold is revealed as hoverLabelToRender`
10. `hovered node already visible does not duplicate in hoverLabelToRender`

Run: `cd packages/ui && pnpm vitest run src/knowledgeLabels/selectVisibleLabels.test.ts`
Expected: 10 passed

---

## Task 3: Playwright tests for label rendering, hover, click, density toggle

**Objective:** Exercise the real DOM and store behavior via the existing `verify-gallery.mjs` harness.

**Files:**
- Modify: `tools/verify-gallery.mjs`

**Additions after the existing checks:**

1. **Load a gallery example with labels** (e.g., the one with `labelsUrl: "generated/lupine-wiki/sphere-grid.labels.json"`).
2. **Assert labels render by default:** After load, check `window.__atlas.labelPerf.renderedLabels > 0` via `page.evaluate`.
3. **Assert hover reveals low-salience labels:** Simulate hover over an atom index that has a low-salience node label, then check that `hoverLabelToRender` logic fires (via store inspection or DOM presence of a label with `-hover` suffix).
4. **Assert click opens HUD:** Click a label card and verify the `AtomInfoHUD` or selection state updates (e.g., `store.selectedAtoms` changes).
5. **Assert density toggle changes count:** Use the Visuals panel to toggle `Key nodes` (threshold=1) vs `All nodes` (threshold=0), then verify `renderedLabels` count changes via `window.__atlas.labelPerf`.

---

## Task 4: Snapshot test for sphere-grid gallery card

**Objective:** Guard the visual appearance of the sphere-grid gallery card.

**Files:**
- Modify: `tools/verify-gallery.mjs`

**Addition:**
After loading the sphere-grid example, take a screenshot of the 3D canvas area and compare it to a stored baseline (or simply assert the screenshot was captured and the file exists). For now, since we don't have a baseline, we'll capture the screenshot and assert the file is non-empty, establishing the baseline for future runs.

---

## Task 5: Run full test suite and verify

**Command:** `pnpm run test`
**Expected:** All existing tests pass + ≥3 new label-specific tests pass.

---

## Acceptance criteria
- [ ] `pnpm run test` includes ≥3 new label-specific tests and they all pass.
- [ ] CI runs the new Playwright tests without flakiness.

---

## Risks / Open questions
- Playwright tests interacting with the 3D canvas may be flaky due to timing. We'll use `page.evaluate` to inspect `window.__atlas.labelPerf` rather than DOM selectors where possible.
- The hover test requires knowing which atom indices have low-salience labels. We'll derive this from the loaded `knowledgeLabels` store state.
- The sphere-grid gallery example may not be the first card. We'll search for it by `labelsUrl`.
