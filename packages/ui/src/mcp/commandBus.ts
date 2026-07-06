/**
 * MCP command bus — observable request/response lifecycle.
 *
 * Wraps every MCP request in a consistent dispatch loop and broadcasts
 * CustomEvents on `window` so external AI clients can await results and
 * subscribe to progress without polling.
 */

import {
  MCP_ERROR_EVENT,
  MCP_PROGRESS_EVENT,
  MCP_REQUEST_EVENT,
  MCP_SUCCESS_EVENT,
} from './protocol';
import type { LupiMcpRequest, LupiMcpResponseResult } from './types';

export function emitMcpEvent(name: string, detail: unknown) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function emitMcpProgress(requestId: string, message: string, percent?: number) {
  emitMcpEvent(MCP_PROGRESS_EVENT, { requestId, message, percent });
}

export interface McpCommandBusContext {
  readState: () => Record<string, unknown>;
}

export function createMcpCommandBus(ctx: McpCommandBusContext) {
  async function dispatch(
    handler: (request: LupiMcpRequest) => Promise<LupiMcpResponseResult>,
    request: LupiMcpRequest,
  ): Promise<LupiMcpResponseResult> {
    emitMcpEvent(MCP_REQUEST_EVENT, { request, state: ctx.readState() });

    try {
      const result = await handler(request);
      emitMcpEvent(MCP_SUCCESS_EVENT, { request, result, state: ctx.readState() });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitMcpEvent(MCP_ERROR_EVENT, { request, error: message, state: ctx.readState() });
      throw error;
    }
  }

  return { dispatch, emitProgress: emitMcpProgress };
}
