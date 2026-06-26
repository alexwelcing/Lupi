/**
 * HERDR event bridge for Lupi viewer knowledge graph.
 *
 * Emits CustomEvents when users interact with knowledge labels,
 * allowing Hermes agents to pick up task creation requests.
 */

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

/** Read the current knowledge graph as a JSON-serializable structure.
 *  Callers should pass labels from useStore.getState().knowledgeLabels
 *  to avoid circular dependencies. */
export function readKnowledgeGraph(labels: any[]) {
  return {
    total: labels.length,
    nodes: labels.map((l: any) => ({
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
