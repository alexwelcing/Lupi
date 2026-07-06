/**
 * Shared types for the Lupi MCP browser bridge.
 */

export type LupiMcpToolName = string;

export interface LupiMcpRequest {
  id: string;
  tool: LupiMcpToolName;
  arguments: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface LupiMcpResponseResult {
  [key: string]: unknown;
}

export interface LupiMcpErrorResult {
  error: string;
}

export interface LupiMcpToolDefinition {
  name: LupiMcpToolName;
  description: string;
  parameters?: unknown; // JSON Schema object (optional; formalized in schemas.ts)
  handler: (request: LupiMcpRequest) => Promise<LupiMcpResponseResult>;
}

export interface LupiMcpResponse {
  id: string;
  requestId: string;
  tool: string;
  result?: LupiMcpResponseResult;
  error?: LupiMcpErrorResult;
  timestamp: string;
}
