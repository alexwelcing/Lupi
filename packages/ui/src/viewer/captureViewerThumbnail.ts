import type { SavedViewThumbnail } from '../savedViews';

export const THUMBNAIL_WIDTH = 320;
export const THUMBNAIL_HEIGHT = 200;
/** Firestore documents are capped at 1 MB and inline molecules already use
 *  some of it, so keep the preview small. */
const MAX_DATA_URL_LENGTH = 60_000;

/**
 * Snapshot the live viewer canvas as a small cover-cropped JPEG for saved-view
 * cards. The viewer renderer keeps its drawing buffer, so a plain 2D drawImage
 * of the WebGL canvas is enough. Returns null when nothing usable is on screen
 * (no canvas, zero size, tainted or lost context) so saving never depends on it.
 */
export function captureViewerThumbnail(
  source: HTMLCanvasElement | null = findViewerCanvas(),
): SavedViewThumbnail | null {
  if (!source || source.width === 0 || source.height === 0) return null;
  const target = document.createElement('canvas');
  target.width = THUMBNAIL_WIDTH;
  target.height = THUMBNAIL_HEIGHT;
  const context = target.getContext('2d');
  if (!context) return null;

  const crop = coverCrop(source.width, source.height, THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT);
  try {
    context.fillStyle = '#060808';
    context.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    for (const quality of [0.72, 0.55, 0.4]) {
      const dataUrl = target.toDataURL('image/jpeg', quality);
      if (!dataUrl.startsWith('data:image/jpeg')) return null;
      if (dataUrl.length <= MAX_DATA_URL_LENGTH) {
        return { dataUrl, width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT };
      }
    }
  } catch {
    // Tainted canvas or lost context: the view still saves, just without a card image.
  }
  return null;
}

/** Largest centered region of a `width`x`height` source with the given aspect. */
export function coverCrop(width: number, height: number, aspect: number) {
  const sourceAspect = width / height;
  if (sourceAspect > aspect) {
    const cropWidth = Math.round(height * aspect);
    return { x: Math.round((width - cropWidth) / 2), y: 0, width: cropWidth, height };
  }
  const cropHeight = Math.round(width / aspect);
  return { x: 0, y: Math.round((height - cropHeight) / 2), width, height: cropHeight };
}

function findViewerCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLCanvasElement>('#lupi-viewer-canvas canvas')
    ?? document.querySelector<HTMLCanvasElement>('.lupine-main-viewport canvas');
}
