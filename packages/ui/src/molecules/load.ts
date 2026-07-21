import { useStore } from '../store';
import { openMolecule } from '../viewer/openMolecule';
import type { MoleculeHit } from './types';

interface ViewerMcp {
  execute?: (request: { id: string; tool: string; arguments: unknown }) => Promise<unknown>;
}

/** Load a search hit into the viewer, mapping its load spec to the right loader. */
export async function loadMoleculeHit(hit: MoleculeHit): Promise<void> {
  const spec = hit.load;
  switch (spec.kind) {
    case 'url':
      {
        useStore.getState().setRendererWarning(null);
        const result = await openMolecule({ kind: 'url', url: spec.url, title: hit.title, history: 'push' });
        if (!result.ok) throw new Error(result.message);
        if (spec.atomTypeMap) applySourceTypeMap(spec.atomTypeMap);
        if (hit.notice) useStore.getState().setRendererWarning(hit.notice);
      }
      if (hit.source === 'social') {
        const store = useStore.getState();
        store.setCameraPreset('top');
        store.setAtomScale(1.15);
        useStore.setState({ showBonds: true, backgroundPreset: 'white', showAxes: false, showCell: false });
      }
      return;
    case 'savedView':
      if (typeof window !== 'undefined') window.location.hash = `#/view/${spec.slug}`;
      return;
    case 'generate': {
      // Reuse the viewer's multi-input resolver via the MCP bridge.
      const mcp =
        typeof window !== 'undefined'
          ? (window as unknown as { __lupiViewerMcp?: ViewerMcp }).__lupiViewerMcp
          : undefined;
      if (mcp?.execute) {
        await mcp.execute({ id: `ui-load-${hit.id}`, tool: 'lupi.generate_molecule', arguments: spec });
      }
      return;
    }
  }
}

function applySourceTypeMap(elementMap: Record<number, number>): void {
  const store = useStore.getState();
  const file = store.file;
  if (!file) return;
  let changed = false;
  const frames = file.trajectory.frames.map((frame) => {
    if (!frame || frame.typeSemantics?.kind !== 'opaque') return frame;
    changed = true;
    return {
      ...frame,
      typeSemantics: {
        kind: 'explicit-element-map' as const,
        provenance: 'catalog-element-map' as const,
        elementMap,
      },
    };
  });
  if (!changed) return;
  useStore.setState({
    file: {
      ...file,
      trajectory: { ...file.trajectory, frames },
    },
  });
}
