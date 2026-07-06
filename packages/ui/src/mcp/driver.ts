/**
 * Pure browser-bridge driver facade for the Lupi viewer MCP API.
 *
 * Viewer-specific execution remains in `mcpViewerBridge.tsx`; this module
 * owns the stable driver surface that agents consume from
 * `window.__lupiViewerMcp`.
 */

import type { LupiMcpRequest, LupiMcpResponse } from './types';

export type { LupiMcpRequest, LupiMcpResponse } from './types';

export interface LupiMcpPublicToolDefinition {
  name: string;
  description: string;
  parameters?: unknown;
}

export interface LupiMcpStatus {
  ready: true;
  version: string;
  toolCount: number;
  moleculeLoaded: boolean;
  atomCount: number;
  frame: number;
  playing: boolean;
}

export interface LupiMcpDriver<State = unknown> {
  ready: true;
  version: string;
  execute: (request: LupiMcpRequest) => Promise<LupiMcpResponse>;
  executeBatch: (requests: LupiMcpRequest[]) => Promise<LupiMcpResponse[]>;
  parseCommand: (command: string) => LupiMcpRequest[];
  state: () => State;
  status: () => LupiMcpStatus;
  tools: () => LupiMcpPublicToolDefinition[];
}

export interface CreateLupiMcpDriverOptions<State = unknown> {
  version: string;
  execute: (request: LupiMcpRequest) => Promise<LupiMcpResponse>;
  executeBatch: (requests: LupiMcpRequest[]) => Promise<LupiMcpResponse[]>;
  parseCommand: (command: string) => LupiMcpRequest[];
  state: () => State;
  status: () => LupiMcpStatus;
  tools: () => LupiMcpPublicToolDefinition[];
}

export function createLupiMcpDriver<State = unknown>(
  options: CreateLupiMcpDriverOptions<State>,
): LupiMcpDriver<State> {
  return {
    ready: true,
    version: options.version,
    execute: options.execute,
    executeBatch: options.executeBatch,
    parseCommand: options.parseCommand,
    state: options.state,
    status: options.status,
    tools: options.tools,
  };
}
