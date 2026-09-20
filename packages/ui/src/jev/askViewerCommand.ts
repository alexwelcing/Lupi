import { VIEWER_COMMAND_LABELS, type ViewerCommand, type ViewerCommandAction } from '@atlas/core';

/**
 * Ask the edge (and through it, Jev) to turn free text from the command
 * palette into one code-owned viewer command. The palette only asks after
 * its own action list has no match, and it executes the answer only when the
 * user selects it. A non-2xx or non-JSON reply means "no suggestion". After
 * the edge reports `configured: false` once, the session stops asking.
 */
export const VIEWER_COMMAND_PATH = '/v1/viewer/command';
const ASK_TIMEOUT_MS = 2_500;
export const MIN_ASK_CHARS = 3;

export interface ViewerCommandSuggestion {
  action: ViewerCommandAction;
  label: string;
  command: ViewerCommand;
  confidence: number;
  /** `local` is an exact literal the edge matched in code; `jev` is inference. */
  source: 'local' | 'jev';
  model?: string;
}

let unavailable = false;

export function resetAskAvailability(): void {
  unavailable = false;
}

interface ViewerCommandReply {
  configured?: boolean;
  model?: string;
  decision?: { action: ViewerCommandAction | null; command?: ViewerCommand; confidence?: number; source?: 'local' | 'jev' };
}

export async function askViewerCommand(text: string, signal?: AbortSignal): Promise<ViewerCommandSuggestion | null> {
  const trimmed = text.trim();
  if (unavailable || typeof fetch !== 'function' || trimmed.length < MIN_ASK_CHARS || trimmed.length > 600) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(VIEWER_COMMAND_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ text: trimmed }),
    });
    if (!response.ok) return null;
    const reply = (await response.json()) as ViewerCommandReply;
    if (reply.configured === false && !reply.decision) {
      unavailable = true;
      return null;
    }
    const decision = reply.decision;
    if (!decision || !decision.action || !decision.command || !(decision.action in VIEWER_COMMAND_LABELS)) return null;
    return {
      action: decision.action,
      label: VIEWER_COMMAND_LABELS[decision.action],
      command: decision.command,
      confidence: typeof decision.confidence === 'number' ? decision.confidence : 0,
      source: decision.source === 'local' ? 'local' : 'jev',
      model: reply.model,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
