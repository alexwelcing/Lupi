// Thin lab wrapper: the actions, criteria, gate and literal table are owned by
// `@atlas/core/jev/viewerCommand`, shared with the edge route
// `POST /v1/viewer/command`. This file keeps the lab's call shapes and receipt
// hashes (`{ model, state, questions }`) stable.
import { MODEL } from './client.mjs';
import {
  VIEWER_COMMAND_ACTIONS,
  VIEWER_COMMAND_CRITERIA,
  buildViewerCommandRequest,
  localViewerAction,
  resolveViewerCommandDecision,
  viewerCommandFor,
} from '../../packages/core/src/jev/index.ts';

export const ACTIONS = VIEWER_COMMAND_ACTIONS;
export const CRITERIA = VIEWER_COMMAND_CRITERIA;

export function localAction(text) {
  return localViewerAction(text);
}

export function buildRequest(text) {
  return { model: MODEL, ...buildViewerCommandRequest(text) };
}

export function resolveDecision(response) {
  return resolveViewerCommandDecision(response, MODEL);
}

export async function interpret(text, evaluate) {
  const request = buildRequest(text); // Validate even on the local route.
  const local = localAction(text);
  if (local) return { action: local, command: viewerCommandFor(local), source: 'local', elapsedMs: 0 };
  const result = await evaluate(request);
  if (!result.response) return { ...result, action: null };
  const decision = resolveDecision(result.response);
  return { ...result, ...decision };
}
