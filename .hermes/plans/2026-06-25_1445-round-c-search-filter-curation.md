# Round C: Search, Filter & Curation — Implementation Plan

> **For Hermes:** Implement this plan task-by-task.

**Goal:** Let users find and curate specific nodes in the large knowledge graph.

**Architecture:** Add a new `SearchPanel` component with a search input and filter chips. Extend the Zustand store with `knowledgeLabelSearchQuery`, `knowledgeLabelSearchFilter`, and `pinnedKnowledgeLabelIds`. Wire `KnowledgeLabelsLayer` to highlight matches and fly the camera to the first match. Persist pinned labels in `savedViews.ts`.

**Tech Stack:** React, TypeScript, Zustand, R3F/drei

---

## Task 1: Extend store with search and pin state

**Objective:** Add search query, filter kind, and pinned label IDs to the store.

**Files:**
- Modify: `packages/ui/src/store.ts`

**Step 1: Add fields to `AppState` interface**

Insert after `knowledgeLabelCullDistance` (around line 425):

```typescript
  /** Current search query string for knowledge labels. */
  knowledgeLabelSearchQuery: string;
  /** Filter mode: 'all' | 'text' | 'nodeId' | 'nodeKind' | 'sphereId'. */
  knowledgeLabelSearchFilter: 'all' | 'text' | 'nodeId' | 'nodeKind' | 'sphereId';
  /** Set of pinned knowledge-label ids (persisted in saved views). */
  pinnedKnowledgeLabelIds: Set<string>;
```

Add actions after `setShowLabelPerfHud` (around line 434):

```typescript
  setKnowledgeLabelSearchQuery: (query: string) => void;
  setKnowledgeLabelSearchFilter: (filter: AppState['knowledgeLabelSearchFilter']) => void;
  togglePinnedKnowledgeLabel: (id: string) => void;
  clearPinnedKnowledgeLabels: () => void;
```

**Step 2: Add defaults in `DEFAULTS`**

Insert after `showLabelPerfHud: false` (around line 740):

```typescript
  knowledgeLabelSearchQuery: '',
  knowledgeLabelSearchFilter: 'all' as const,
  pinnedKnowledgeLabelIds: new Set<string>(),
```

**Step 3: Add actions in the store body**

Insert after `setShowLabelPerfHud` action (around line 1164):

```typescript
    setKnowledgeLabelSearchQuery: (knowledgeLabelSearchQuery) => set({ knowledgeLabelSearchQuery }),
    setKnowledgeLabelSearchFilter: (knowledgeLabelSearchFilter) => set({ knowledgeLabelSearchFilter }),
    togglePinnedKnowledgeLabel: (id) => set((s) => {
      const next = new Set(s.pinnedKnowledgeLabelIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { pinnedKnowledgeLabelIds: next };
    }),
    clearPinnedKnowledgeLabels: () => set({ pinnedKnowledgeLabelIds: new Set<string>() }),
```

**Step 4: Add URL serialization in `encodeToURL`**

After `delta.rlc = s.rimLightColor;` (around line 1378):

```typescript
      if (s.knowledgeLabelSearchQuery)               delta.ksq = s.knowledgeLabelSearchQuery;
      if (s.knowledgeLabelSearchFilter !== 'all')    delta.ksf = s.knowledgeLabelSearchFilter;
      if (s.pinnedKnowledgeLabelIds.size > 0)        delta.kpl = Array.from(s.pinnedKnowledgeLabelIds);
```

**Step 5: Add URL deserialization in `decodeFromURL`**

After `rimLightColor: s.rlc ?? DEFAULTS.rimLightColor,` (around line 1461):

```typescript
          knowledgeLabelSearchQuery: s.ksq ?? '',
          knowledgeLabelSearchFilter: (s.ksf as any) ?? 'all',
          pinnedKnowledgeLabelIds: new Set((s.kpl as string[]) ?? []),
```

**Verification:** `pnpm run lint` passes with no new errors.

---

## Task 2: Create `SearchPanel` component

**Objective:** Build a new panel with search input, filter chips, match count, and pinned list.

**Files:**
- Create: `packages/ui/src/panels/SearchPanel.tsx`

**Step 1: Write the component**

```tsx
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { QuantumSection } from '@lupine/ui';

export function SearchPanel({ embedded = false }: { embedded?: boolean }) {
  const {
    knowledgeLabels,
    knowledgeLabelSearchQuery,
    setKnowledgeLabelSearchQuery,
    knowledgeLabelSearchFilter,
    setKnowledgeLabelSearchFilter,
    pinnedKnowledgeLabelIds,
    togglePinnedKnowledgeLabel,
    clearPinnedKnowledgeLabels,
    setSelectedAtoms,
    setCameraState,
    setActivePanel,
  } = useStore();

  const [filterOpen, setFilterOpen] = useState(false);

  const matches = useMemo(() => {
    const q = knowledgeLabelSearchQuery.trim().toLowerCase();
    if (!q) return [];
    const filter = knowledgeLabelSearchFilter;
    return knowledgeLabels.filter((l) => {
      const textMatch = l.text.toLowerCase().includes(q);
      const nodeIdMatch = l.nodeId?.toLowerCase().includes(q) ?? false;
      const nodeKindMatch = l.nodeKind?.toLowerCase().includes(q) ?? false;
      const sphereIdMatch = l.sphereId?.toLowerCase().includes(q) ?? false;
      switch (filter) {
        case 'text': return textMatch;
        case 'nodeId': return nodeIdMatch;
        case 'nodeKind': return nodeKindMatch;
        case 'sphereId': return sphereIdMatch;
        default: return textMatch || nodeIdMatch || nodeKindMatch || sphereIdMatch;
      }
    });
  }, [knowledgeLabels, knowledgeLabelSearchQuery, knowledgeLabelSearchFilter]);

  const pinned = useMemo(
    () => knowledgeLabels.filter((l) => pinnedKnowledgeLabelIds.has(l.id)),
    [knowledgeLabels, pinnedKnowledgeLabelIds],
  );

  const handleFlyTo = (label: typeof knowledgeLabels[0]) => {
    if (label.atomIndex != null) {
      setSelectedAtoms([label.atomIndex]);
    }
    const [x, y, z] = label.position;
    setCameraState([x + 8, y + 8, z + 8], [x, y, z]);
  };

  const filterOptions: { value: typeof knowledgeLabelSearchFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'text', label: 'Text' },
    { value: 'nodeId', label: 'Node ID' },
    { value: 'nodeKind', label: 'Kind' },
    { value: 'sphereId', label: 'Sphere' },
  ];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: embedded ? 'transparent' : '#0a0a0c',
      borderLeft: embedded ? 'none' : '1px solid #1f2937',
    }}>
      {!embedded && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid #1f2937', background: '#121318', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 4, height: 14, background: '#1edce0' }} />
            <span style={{
              fontSize: 12, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              textTransform: 'uppercase', letterSpacing: '0.15em', color: '#e2e8f0',
            }}>
              Search & Curation
            </span>
          </div>
          <button
            onClick={() => setActivePanel(null)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, background: 'transparent', border: '1px solid #334155',
              borderRadius: 0, color: '#94a3b8', cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>
      )}

      <div className="lupine-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Search input */}
          <div>
            <input
              type="text"
              value={knowledgeLabelSearchQuery}
              onChange={(e) => setKnowledgeLabelSearchQuery(e.target.value)}
              placeholder="Search labels..."
              style={{
                width: '100%',
                background: '#121824',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: 4,
                padding: '9px 10px',
                fontSize: 12,
                outline: 'none',
              }}
            />
            {matches.length > 0 && (
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                {matches.length} match{matches.length === 1 ? '' : 'es'}
              </div>
            )}
          </div>

          {/* Filter chips */}
          <div>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>
              Filter by
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {filterOptions.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setKnowledgeLabelSearchFilter(f.value)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: `1px solid ${knowledgeLabelSearchFilter === f.value ? '#1edce0' : '#334155'}`,
                    background: knowledgeLabelSearchFilter === f.value ? 'rgba(30,220,224,0.12)' : '#121824',
                    color: knowledgeLabelSearchFilter === f.value ? '#9ff7ff' : '#94a3b8',
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Matches list */}
          {matches.length > 0 && (
            <QuantumSection label="Matches" defaultOpen={true}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {matches.slice(0, 20).map((label) => (
                  <div
                    key={label.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '6px 8px', background: '#121418', borderRadius: 4, border: '1px solid #1f2937',
                    }}
                  >
                    <button
                      onClick={() => handleFlyTo(label)}
                      style={{
                        flex: 1, textAlign: 'left', background: 'transparent', border: 'none',
                        color: '#e2e8f0', fontSize: 11, cursor: 'pointer', padding: 0,
                      }}
                      title="Fly to label"
                    >
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label.text}
                      </div>
                      <div style={{ fontSize: 9, color: '#64748b' }}>
                        {label.nodeKind ?? label.kind} · {label.sphereId ?? '—'}
                      </div>
                    </button>
                    <button
                      onClick={() => togglePinnedKnowledgeLabel(label.id)}
                      style={{
                        background: 'transparent', border: 'none', color: pinnedKnowledgeLabelIds.has(label.id) ? '#1edce0' : '#64748b',
                        cursor: 'pointer', fontSize: 14, padding: '0 4px',
                      }}
                      title={pinnedKnowledgeLabelIds.has(label.id) ? 'Unpin' : 'Pin'}
                    >
                      {pinnedKnowledgeLabelIds.has(label.id) ? '★' : '☆'}
                    </button>
                  </div>
                ))}
                {matches.length > 20 && (
                  <div style={{ fontSize: 10, color: '#64748b', textAlign: 'center' }}>
                    +{matches.length - 20} more
                  </div>
                )}
              </div>
            </QuantumSection>
          )}

          {/* Pinned list */}
          {pinned.length > 0 && (
            <QuantumSection label={`Pinned (${pinned.length})`} defaultOpen={true}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {pinned.map((label) => (
                  <div
                    key={label.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '6px 8px', background: '#121418', borderRadius: 4, border: '1px solid #1edce0',
                    }}
                  >
                    <button
                      onClick={() => handleFlyTo(label)}
                      style={{
                        flex: 1, textAlign: 'left', background: 'transparent', border: 'none',
                        color: '#e2e8f0', fontSize: 11, cursor: 'pointer', padding: 0,
                      }}
                    >
                      {label.text}
                    </button>
                    <button
                      onClick={() => togglePinnedKnowledgeLabel(label.id)}
                      style={{
                        background: 'transparent', border: 'none', color: '#1edce0',
                        cursor: 'pointer', fontSize: 14, padding: '0 4px',
                      }}
                      title="Unpin"
                    >
                      ★
                    </button>
                  </div>
                ))}
                <button
                  onClick={clearPinnedKnowledgeLabels}
                  style={{
                    background: 'transparent', border: '1px solid #334155', borderRadius: 4,
                    color: '#94a3b8', fontSize: 10, cursor: 'pointer', padding: '4px 8px',
                  }}
                >
                  Clear all pins
                </button>
              </div>
            </QuantumSection>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Verification:** Component compiles; `pnpm run lint` passes.

---

## Task 3: Wire `SearchPanel` into the main UI

**Objective:** Add the panel to the active panel switcher and the toolbar.

**Files:**
- Modify: `packages/ui/src/store.ts` (activePanel union)
- Modify: wherever `activePanel` is rendered (likely `App.tsx` or a layout component)

**Step 1: Extend `activePanel` type in `AppState`**

Change `activePanel` type from:

```typescript
activePanel: 'studio' | 'export' | 'flythrough' | 'telemetry' | 'equilibrium' | 'mlipLongRun' | null;
```

to:

```typescript
activePanel: 'studio' | 'export' | 'flythrough' | 'telemetry' | 'equilibrium' | 'mlipLongRun' | 'search' | null;
```

**Step 2: Find the panel switcher and add `SearchPanel`**

Search for `activePanel` usage in the UI root (likely `App.tsx` or `Layout.tsx`):

```bash
grep -r "activePanel" packages/ui/src --include="*.tsx" | grep -v "store.ts"
```

Add the import and case:

```tsx
import { SearchPanel } from './panels/SearchPanel';

// In the panel switcher:
{activePanel === 'search' && <SearchPanel />}
```

Also add a toolbar button that opens the search panel. Search for existing panel buttons (e.g., `setActivePanel('studio')`) and add:

```tsx
<button onClick={() => setActivePanel('search')} title="Search & Curation">
  🔍
</button>
```

**Verification:** Panel opens and closes correctly; `pnpm run lint` passes.

---

## Task 4: Highlight search matches in `KnowledgeLabelsLayer`

**Objective:** Labels that match the current search query should render with a distinct highlight border.

**Files:**
- Modify: `packages/ui/src/KnowledgeLabelsLayer.tsx`

**Step 1: Read search state from the store**

Add selectors near the existing ones (around line 39):

```typescript
  const searchQuery = useStore((s) => s.knowledgeLabelSearchQuery);
  const searchFilter = useStore((s) => s.knowledgeLabelSearchFilter);
  const pinnedIds = useStore((s) => s.pinnedKnowledgeLabelIds);
```

**Step 2: Build a `isMatch` helper**

Before the component or inside `useMemo`:

```typescript
function labelMatches(label: KnowledgeLabel, query: string, filter: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const textMatch = label.text.toLowerCase().includes(q);
  const nodeIdMatch = label.nodeId?.toLowerCase().includes(q) ?? false;
  const nodeKindMatch = label.nodeKind?.toLowerCase().includes(q) ?? false;
  const sphereIdMatch = label.sphereId?.toLowerCase().includes(q) ?? false;
  switch (filter) {
    case 'text': return textMatch;
    case 'nodeId': return nodeIdMatch;
    case 'nodeKind': return nodeKindMatch;
    case 'sphereId': return sphereIdMatch;
    default: return textMatch || nodeIdMatch || nodeKindMatch || sphereIdMatch;
  }
}
```

**Step 3: Pass `isMatch` and `isPinned` to `CardLabel`**

In the `visibleLabels.map` and `hoverLabelToRender` blocks, add props:

```tsx
<CardLabel
  ...
  isMatch={labelMatches(label, searchQuery, searchFilter)}
  isPinned={pinnedIds.has(label.id)}
/>
```

**Step 4: Update `CardLabel` props and styling**

Extend the `CardLabel` interface:

```typescript
  isMatch?: boolean;
  isPinned?: boolean;
```

In the `CardLabel` body, adjust the border color:

```typescript
  const borderColor = isMatch ? '#fbbf24' : isPinned ? '#1edce0' : `${tint}${hover ? '88' : '55'}`;
```

And update the inline style:

```typescript
            border: `1px solid ${borderColor}`,
```

**Verification:** Typing in the search box highlights matching labels with an amber border; pinned labels keep a cyan border.

---

## Task 5: Fly camera to first match on Enter

**Objective:** When the user presses Enter in the search box, fly the camera to the first match.

**Files:**
- Modify: `packages/ui/src/panels/SearchPanel.tsx`

**Step 1: Add `onKeyDown` handler to the input**

```tsx
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches.length > 0) {
                  handleFlyTo(matches[0]);
                }
              }}
```

**Verification:** Pressing Enter with matches present flies the camera to the first match.

---

## Task 6: Persist pinned labels in saved views

**Objective:** Include `pinnedKnowledgeLabelIds` in the saved view capture and restore.

**Files:**
- Modify: `packages/ui/src/savedViews.ts`

**Step 1: Add to `CanonicalMolecularView`**

After `annotations: Pick<AppState, 'annotations' | 'labelStyle'>;` (around line 125):

```typescript
  knowledgeLabels: Pick<AppState, 'knowledgeLabelSearchQuery' | 'knowledgeLabelSearchFilter' | 'pinnedKnowledgeLabelIds'>;
```

**Step 2: Capture in `captureCanonicalView`**

After `annotations: pick(s, ['annotations', 'labelStyle']),` (around line 347):

```typescript
    knowledgeLabels: pick(s, ['knowledgeLabelSearchQuery', 'knowledgeLabelSearchFilter', 'pinnedKnowledgeLabelIds']),
```

**Step 3: Restore in `applyCanonicalView`**

After `...(view.annotations ?? {}),` (around line 369):

```typescript
    ...(view.knowledgeLabels ?? {}),
```

**Verification:** Save a view with pinned labels, reload it, and the pins are restored.

---

## Task 7: Verify and open PR

**Step 1: Run lint and tests**

```bash
cd /home/alex/Dev/lupi-viewer
pnpm run lint
pnpm run test
```

**Step 2: Commit and push**

```bash
git checkout -b feat/round-c-search-filter-curation
git add -A
git commit -m "feat(round-c): search, filter and curation for knowledge labels

- Add search panel with text/nodeId/nodeKind/sphereId filters
- Highlight matching labels in amber, pinned labels in cyan
- Fly camera to first match on Enter
- Persist pinned labels in saved views
- URL round-trip for search query, filter, and pins

Closes #6"
git push -u origin HEAD
```

**Step 3: Open PR**

```bash
gh pr create --title "feat(round-c): search, filter and curation" --body "Closes #6"
```

**Verification:** CI passes; PR references #6.

---

## Acceptance Criteria

- [ ] Typing `hermes-agent` finds the repo node and focuses it.
- [ ] Search filters by node kind and sphere.
- [ ] Pinned labels reappear when a saved view is restored.

## Risks

- `activePanel` is used in many places; adding `'search'` to the union may require updates in toolbar components. Search for all occurrences before committing.
- `QuantumSection` may not be exported from `@lupine/ui` if this is a local package. Verify the import path or inline the section if needed.
- URL serialization adds `delta.kpl` as an array; ensure `decodeFromURL` correctly reconstructs a `Set`.
