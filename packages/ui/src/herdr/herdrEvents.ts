/**
 * HERDR event bridge for Lupi viewer knowledge graph.
 *
 * Emits CustomEvents when users interact with knowledge labels,
 * so a host page or a local agent listening on `window` can pick up task
 * creation requests. This module sends nothing over the network.
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
