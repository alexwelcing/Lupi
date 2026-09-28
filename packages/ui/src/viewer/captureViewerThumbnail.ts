import type { SavedViewThumbnail } from '../savedViews';
import { requestViewerThumbnail } from '../export/renderTargetReadback';

export { THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH } from '../export/renderTargetReadback';

/** Saving never waits longer than this for the card image. */
export const THUMBNAIL_TIMEOUT_MS = 3_000;

/**
 * A small cover-cropped JPEG of the live viewer for saved-view cards. The
 * WebGPU canvas keeps no drawing buffer, so the view is re-rendered into a
 * 320×200 render target in the next frame's capture phase and read back
 * (requestViewerThumbnail). Resolves null when no viewer is mounted, the
 * capture fails or takes longer than `timeoutMs`, so saving never depends on it.
 */
export async function captureViewerThumbnail(
  timeoutMs: number = THUMBNAIL_TIMEOUT_MS,
): Promise<SavedViewThumbnail | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      requestViewerThumbnail().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
