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

/** The WebGPURenderer backend the viewer runs on (plan-final §5.1). */
export type LupiMcpRendererBackend = 'webgpu' | 'webgl2';

/**
 * Renderer fields of status(), state() and the `lupi.status` tool. All are
 * null until the viewer canvas has created its renderer. `webGPUSupported`
 * mirrors fiber's `state.webGPUSupported`: true on the WebGPU backend, false
 * on the WebGL2 backend (a missing adapter or `?renderer=webgl2`).
 * `rendererExecutionClass` is the export execution class the backend implies
 * (exportProfileV2.ts): artifacts from the two classes never share a key.
 */
export interface LupiMcpRendererStatus {
  rendererBackend: LupiMcpRendererBackend | null;
  webGPUSupported: boolean | null;
  rendererExecutionClass: 'browser-webgpu-main-thread' | 'browser-webgpu-webgl2-main-thread' | null;
}

export interface LupiMcpStatus extends LupiMcpRendererStatus {
  ready: true;
  version: string;
  toolCount: number;
  moleculeLoaded: boolean;
  atomCount: number;
  frame: number;
  playing: boolean;
  /** Covalent plus coordination bonds drawn (ionic contacts are not bonds). */
  bondCount: number;
  bondSource: 'cpu' | 'gpu' | 'none';
  bondTopology: 'source' | 'inferred' | 'unavailable';
  showBondsEffective: boolean;
  /** The rule the current frame gets (store bondProfile): 'source', a recipe id, or null. */
  bondRecipe: 'lupi-bonds.molecular.v1' | 'lupi-bonds.distance.v1' | 'source' | null;
  /** bondTolerance differs from the default 0.45 Å. */
  bondToleranceAdjusted: boolean;
  /** Drawn bonds by kind (zeros while bonds are hidden). */
  bondKinds: { covalent: number; coordination: number; ionicContact: number };
  /** The recipe's evidence for the frame; null for source bonds or frames above 2,000 atoms. */
  bondEvidence: { long: number; removed: number; nearMiss: number; clashes: number } | null;
  /** Declared charge and spin (Frame.chemistry), or null. */
  chemistry: { totalCharge: number | null; spinMultiplicity: number | null; source: string; domain: string | null } | null;
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
