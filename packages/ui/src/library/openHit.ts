import { createContext, useContext } from 'react';
import type { MoleculeHit } from '../molecules/types';

/**
 * The Library shell mounts without the 3D viewer. Most hits load through the
 * store, and the shell hands off to the viewer the moment `store.file` is
 * set. Hits that need the viewer's multi-input resolver (procedural crystals
 * and templates) must mount the viewer first and then execute through the
 * in-page MCP bridge; saved views navigate to their canonical route.
 */
export interface LibraryHandoff {
  enterViewer: () => void;
}

export const LibraryHandoffContext = createContext<LibraryHandoff | null>(null);

export function useLibraryHandoff(): LibraryHandoff | null {
  return useContext(LibraryHandoffContext);
}

interface ViewerMcpLike {
  ready?: boolean;
  execute?: (request: { id: string; tool: string; arguments: unknown }) => Promise<unknown>;
}

function currentBridge(): ViewerMcpLike | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { __lupiViewerMcp?: ViewerMcpLike }).__lupiViewerMcp;
}

export async function waitForViewerBridge(timeoutMs = 20_000, intervalMs = 100): Promise<ViewerMcpLike> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const bridge = currentBridge();
    if (bridge?.ready && typeof bridge.execute === 'function') return bridge;
    if (Date.now() >= deadline) throw new Error('The viewer did not become ready in time.');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function openLibraryHit(hit: MoleculeHit, handoff: LibraryHandoff | null): Promise<void> {
  const spec = hit.load;
  if (spec.kind === 'savedView') {
    if (typeof window !== 'undefined') window.location.assign(`/#/view/${encodeURIComponent(spec.slug)}`);
    return;
  }
  if (spec.kind === 'generate' && spec.inputType !== 'name') {
    if (!currentBridge()?.ready) handoff?.enterViewer();
    const bridge = await waitForViewerBridge();
    const response = (await bridge.execute!({
      id: `library-${hit.source}-${hit.id}`,
      tool: 'lupi.generate_molecule',
      arguments: spec,
    })) as { ok?: boolean; error?: { error?: string } } | undefined;
    if (response && response.ok === false) {
      throw new Error(response.error?.error ?? `Could not open ${hit.title}.`);
    }
    return;
  }
  // Code-split: the load path pulls in the streaming loader, which the Library
  // chunk must not pay for until a pick happens.
  const { loadMoleculeHit } = await import('../molecules/load');
  await loadMoleculeHit(hit);
}
