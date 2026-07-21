export type ViewerLoadGuard = () => boolean;

let activeViewerLoadGeneration = 0;

/** Start a mutually-exclusive viewer load. Starting another load invalidates
 * every older guard before either request can commit molecule state. */
export function beginViewerLoad(): ViewerLoadGuard {
  const generation = ++activeViewerLoadGeneration;
  return () => generation === activeViewerLoadGeneration;
}

/** Invalidate an in-flight load when navigation returns to a non-viewer route. */
export function cancelViewerLoad(): void {
  activeViewerLoadGeneration += 1;
}

export function viewerLoadIsCurrent(guard?: ViewerLoadGuard): boolean {
  return guard?.() ?? true;
}

export class ViewerLoadSupersededError extends Error {
  constructor() {
    super('Viewer load was superseded by newer navigation.');
    this.name = 'ViewerLoadSupersededError';
  }
}

export function assertViewerLoadCurrent(
  guard?: ViewerLoadGuard,
  dispose?: () => void,
): void {
  if (viewerLoadIsCurrent(guard)) return;
  dispose?.();
  throw new ViewerLoadSupersededError();
}
