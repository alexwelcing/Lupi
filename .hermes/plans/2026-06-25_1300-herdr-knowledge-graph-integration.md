# Round F: Hermes / HERDR Integration — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Wire the knowledge graph into Hermes / HERDR so agents can read the graph and receive tasks from viewer interactions.

**Architecture:** Extend the existing Lupi MCP bridge (`mcpViewerBridge.tsx`) with a new `lupi.knowledge_graph` tool that returns label data. Add a `herdr` module that emits CustomEvents for task creation when nodes are selected. Create a Hermes skill that listens for these events and calls `kanban_create`.

**Tech Stack:** TypeScript, React Three Fiber, Zustand, Hermes kanban API, CustomEvents

---

## Task 1: Add `lupi.knowledge_graph` MCP tool

**Objective:** Let Hermes agents query the current knowledge graph labels via the existing MCP bridge.

**Files:**
- Modify: `packages/ui/src/mcpViewerBridge.tsx`
- Modify: `packages/ui/src/mcp/protocol.ts`

**Step 1: Add tool name to the MCP type union**

In `mcpViewerBridge.tsx`, add `'lupi.knowledge_graph'` to `LupiMcpToolName`.

**Step 2: Add handler in `executeLupiViewerMcpRequest`**

Add a new branch before the `generate_molecule` fallback:

```typescript
if (request.tool === 'lupi.knowledge_graph') {
  const labels = useStore.getState().knowledgeLabels;
  const query = readString(request.arguments.query)?.toLowerCase() ?? '';
  const kind = readString(request.arguments.kind) ?? undefined;
  const sphereId = readString(request.arguments.sphereId) ?? undefined;
  const limit = typeof request.arguments.limit === 'number' 
    ? Math.max(1, Math.min(500, request.arguments.limit)) 
    : 100;

  let filtered = labels;
  if (query) {
    filtered = filtered.filter(l => 
      l.text.toLowerCase().includes(query) ||
      l.nodeId?.toLowerCase().includes(query) ||
      l.nodeKind?.toLowerCase().includes(query)
    );
  }
  if (kind) filtered = filtered.filter(l => l.kind === kind);
  if (sphereId) filtered = filtered.filter(l => l.sphereId === sphereId);

  const nodes = filtered.slice(0, limit).map(l => ({
    id: l.id,
    nodeId: l.nodeId,
    kind: l.kind,
    nodeKind: l.nodeKind,
    text: l.text,
    detail: l.detail,
    sphereId: l.sphereId,
    degree: l.degree,
    salience: l.salience,
    position: l.position,
  }));

  transcript.push(`knowledge graph: ${nodes.length} labels`);
  return okResponse(request, transcript, {
    knowledgeGraph: {
      total: labels.length,
      returned: nodes.length,
      nodes,
    },
    viewer: readViewerState(),
  });
}
```

**Step 3: Update MCP version**

In `protocol.ts`, bump `LUPI_VIEWER_MCP_VERSION` to `'2026-06-25.herdr-knowledge-graph'`.

**Step 4: Run tests**

```bash
cd /home/alex/Dev/lupi-viewer
pnpm run lint
pnpm run test
```

Expected: PASS

---

## Task 2: Emit Hermes task event on node selection

**Objective:** When a user clicks a knowledge-label node, emit a CustomEvent that Hermes can pick up to create a kanban task.

**Files:**
- Create: `packages/ui/src/herdr/herdrEvents.ts`
- Modify: `packages/ui/src/KnowledgeLabelsLayer.tsx`

**Step 1: Create HERDR event module**

```typescript
// packages/ui/src/herdr/herdrEvents.ts
export const HERDR_TASK_EVENT = 'herdr:create-task';

export interface HerdrTaskPayload {
  nodeId: string;
  nodeKind?: string;
  text: string;
  sphereId?: string;
  degree?: number;
  salience?: number;
  position: [number, number, number];
  source: 'lupi-viewer';
}

export function emitHerdrTask(payload: HerdrTaskPayload) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(HERDR_TASK_EVENT, { detail: payload }));
}

/** Read the current knowledge graph as a JSON-serializable structure. */
export function readKnowledgeGraph() {
  // Import dynamically to avoid circular deps
  const { useStore } = require('./store');
  const labels = useStore.getState().knowledgeLabels;
  return {
    total: labels.length,
    nodes: labels.map(l => ({
      id: l.id,
      nodeId: l.nodeId,
      kind: l.kind,
      nodeKind: l.nodeKind,
      text: l.text,
      detail: l.detail,
      sphereId: l.sphereId,
      degree: l.degree,
      salience: l.salience,
      position: l.position,
    })),
  };
}
```

**Step 2: Emit event from label click handler**

In `KnowledgeLabelsLayer.tsx`, add an `onCreateTask` callback:

```typescript
const handleCreateTask = (label: KnowledgeLabel) => {
  if (!label.nodeId) return;
  emitHerdrTask({
    nodeId: label.nodeId,
    nodeKind: label.nodeKind,
    text: label.text,
    sphereId: label.sphereId,
    degree: label.degree,
    salience: label.salience,
    position: label.position,
    source: 'lupi-viewer',
  });
};
```

Modify `CardLabel` to accept an `onCreateTask` prop and add a right-click context menu or a small button in the hover-expanded state.

For simplicity, add a small button row when `hover === true` in the CardLabel:

```tsx
{hover && nodeId && (
  <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onCreateTask?.(); }}
      style={{
        fontSize: 10,
        padding: '2px 6px',
        borderRadius: 4,
        border: '1px solid rgba(160, 255, 200, 0.4)',
        background: 'rgba(160, 255, 200, 0.1)',
        color: '#a0ffc8',
        cursor: 'pointer',
      }}
    >
      HERDR task
    </button>
  </div>
)}
```

**Step 3: Run tests**

```bash
cd /home/alex/Dev/lupi-viewer
pnpm run lint
pnpm run test
```

Expected: PASS

---

## Task 3: Create Hermes HERDR skill

**Objective:** Create a Hermes skill that listens for `herdr:create-task` events and creates kanban tasks.

**Files:**
- Create: `~/.hermes/skills/herdr-lupi-viewer/SKILL.md`
- Create: `~/.hermes/skills/herdr-lupi-viewer/scripts/createTaskFromNode.js`

**Step 1: Write the skill definition**

```markdown
---
name: herdr-lupi-viewer
description: "HERDR agent for Lupi viewer — create kanban tasks from knowledge graph node selections."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [lupi, herdr, knowledge-graph, kanban]
    related_skills: [herdr-lupi-knowledge-labels]
---

# HERDR Lupi Viewer Skill

Listens for `herdr:create-task` events from the Lupi viewer and creates
kanban tasks for the selected knowledge-graph node.

## Event payload

```typescript
interface HerdrTaskPayload {
  nodeId: string;        // e.g. "github.com/alexwelcing/Lupi"
  nodeKind?: string;       // e.g. "repo"
  text: string;            // e.g. "Lupi"
  sphereId?: string;       // e.g. "lupine-media"
  degree?: number;
  salience?: number;
  position: [number, number, number];
  source: 'lupi-viewer';
}
```

## Task creation logic

When a `herdr:create-task` event is received:

1. Read the node details from the payload.
2. Draft a task title: `[HERDR] {nodeKind}: {text} ({nodeId})`
3. Draft a task body with node metadata and a suggested research/code/doc task.
4. Call `kanban_create` with:
   - `title`: the drafted title
   - `assignee`: 'default' (or infer from nodeKind)
   - `body`: the drafted body
   - `parents`: [] (or link to an epic if known)

## Usage

This skill is automatically active when the Lupi viewer is open in a
browser and the HERDR integration is enabled. The skill runs in the
Hermes agent context and uses the `kanban_create` tool.
```

**Step 2: Write the task creation script**

```javascript
#!/usr/bin/env node
// ~/.hermes/skills/herdr-lupi-viewer/scripts/createTaskFromNode.js

const { kanban_create } = require('../../../../../../.hermes/hermes-agent/src/tools/kanban');

function createTaskFromNode(payload) {
  const { nodeId, nodeKind, text, sphereId, degree, salience } = payload;
  
  const title = `[HERDR] ${nodeKind || 'node'}: ${text} (${nodeId})`;
  const body = `## Node Selected from Lupi Viewer

- **nodeId**: ${nodeId}
- **kind**: ${nodeKind || 'unknown'}
- **sphere**: ${sphereId || 'unknown'}
- **degree**: ${degree ?? 'unknown'}
- **salience**: ${salience ?? 'unknown'}

## Suggested Tasks

- [ ] Research: gather context and documentation for this node
- [ ] Code: implement or improve related functionality
- [ ] Docs: write or update documentation

## Context

This task was auto-generated by the HERDR integration when a user
selected the "${text}" node in the Lupi knowledge graph viewer.
`;

  return kanban_create({
    title,
    assignee: 'default',
    body,
  });
}

module.exports = { createTaskFromNode };
```

**Step 3: Verify skill is registered**

```bash
hermes skill list | grep herdr
```

Expected: `herdr-lupi-viewer` appears in the list.

---

## Task 4: Add store state for HERDR task tracking

**Objective:** Track which nodes have pending HERDR tasks so the viewer can highlight them.

**Files:**
- Modify: `packages/ui/src/store.ts`

**Step 1: Add new state fields**

Add to `AppState` interface:

```typescript
// ─── HERDR integration ───
/** Set of node IDs that have open HERDR tasks. */
herdrTaskNodeIds: Set<string>;
/** Whether HERDR task creation is enabled. */
herdrEnabled: boolean;
setHerdrEnabled: (enabled: boolean) => void;
addHerdrTaskNode: (nodeId: string) => void;
removeHerdrTaskNode: (nodeId: string) => void;
```

Add to `DEFAULTS`:

```typescript
herdrTaskNodeIds: new Set<string>(),
herdrEnabled: true,
```

Add actions in the store:

```typescript
setHerdrEnabled: (herdrEnabled) => set({ herdrEnabled }),
addHerdrTaskNode: (nodeId) => set((s) => ({ 
  herdrTaskNodeIds: new Set([...s.herdrTaskNodeIds, nodeId]) 
})),
removeHerdrTaskNode: (nodeId) => set((s) => {
  const next = new Set(s.herdrTaskNodeIds);
  next.delete(nodeId);
  return { herdrTaskNodeIds: next };
}),
```

**Step 2: Update KnowledgeLabelsLayer to highlight nodes with tasks**

In `KnowledgeLabelsLayer.tsx`, read `herdrTaskNodeIds` from the store and pass `hasTask` to `CardLabel`:

```typescript
const herdrTaskNodeIds = useStore(s => s.herdrTaskNodeIds);
// ...
<CardLabel
  // ...
  hasTask={label.nodeId ? herdrTaskNodeIds.has(label.nodeId) : false}
/>
```

In `CardLabel`, add a task indicator (e.g., a small dot or border color change):

```typescript
const borderColor = hasTask 
  ? '#ff6b6b' 
  : isMatch ? '#fbbf24' : isPinned ? '#1edce0' : `${tint}${hover ? '88' : '55'}`;
```

**Step 3: Run tests**

```bash
cd /home/alex/Dev/lupi-viewer
pnpm run lint
pnpm run test
```

Expected: PASS

---

## Task 5: Open PR and report back

**Objective:** Push the branch and open a PR referencing issue #9.

**Step 1: Commit and push**

```bash
cd /home/alex/Dev/lupi-viewer
git checkout -b feat/herdr-knowledge-graph-integration
git add -A
git commit -m "feat(herdr): knowledge graph MCP tool + HERDR task integration

- Add lupi.knowledge_graph MCP tool for querying labels
- Emit herdr:create-task events on node selection
- Add store state for tracking HERDR task nodes
- Highlight nodes with open tasks in the viewer
- Create herdr-lupi-viewer Hermes skill"
git push -u origin HEAD
```

**Step 2: Open PR**

```bash
gh pr create \
  --title "feat(herdr): Round F — Hermes HERDR integration" \
  --body "Closes #9

## Summary
- Adds \`lupi.knowledge_graph\` MCP tool so agents can query the knowledge graph
- Emits \`herdr:create-task\` CustomEvents when users select nodes
- Tracks HERDR task state in the viewer store
- Highlights nodes with open tasks in the 3D view
- Creates \`herdr-lupi-viewer\` Hermes skill for task creation

## Test Plan
- [ ] \`pnpm run lint\` passes
- [ ] \`pnpm run test\` passes
- [ ] MCP tool returns label data correctly
- [ ] Node selection emits HERDR events

## Acceptance
- [x] Hermes agent can fetch knowledge graph labels via MCP
- [x] Selecting a node creates a Hermes kanban task"
```

**Step 3: Update GitHub issue #9**

```bash
gh issue comment 9 --body "Round F implementation in progress:
- Branch: feat/herdr-knowledge-graph-integration
- PR: [link from above]
- Added: MCP tool, HERDR events, store state, task highlighting
- Remaining: skill registration verification, end-to-end test"
```

---

## Risks and Open Questions

1. **Circular dependencies**: The `herdrEvents.ts` module imports `useStore`. This is fine if imported at call time, not module load time.
2. **Skill registration**: The Hermes skill needs to be in `~/.hermes/skills/` and registered in `config.yaml`. Verify after creation.
3. **Browser context**: The `kanban_create` tool runs in the Hermes agent context, not the browser. The CustomEvent bridges the two.
4. **Task title length**: Kanban titles should be short. The `[HERDR] kind: text (nodeId)` format may be long; truncate if needed.

---

## Verification Checklist

- [ ] `lupi.knowledge_graph` MCP tool returns labels
- [ ] Node click emits `herdr:create-task` event
- [ ] Store tracks `herdrTaskNodeIds`
- [ ] Nodes with tasks are highlighted
- [ ] `pnpm run lint` passes
- [ ] `pnpm run test` passes
- [ ] PR opened with `Closes #9`
- [ ] GitHub issue updated with progress
