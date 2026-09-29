/**
 * RelayPlate — the sage plate a molecule opens on when no relay stage carries
 * it: the page's splash, the viewer's "Opening…" state for deep links, and
 * the cover over a canvas that has not drawn yet. Every one centres the same
 * flat preview at the same size with the lime ring under it, so the steps of
 * a deep link read as one still picture until the 3D cage takes over.
 */
import { useState, type CSSProperties } from 'react';
import { previewUrl } from './preview';
import './relay.css';

/** The lime mark: a hairline ring with one travelling arc (still under reduced motion). */
export function RelayRing() {
  return (
    <svg className="lupi-ring" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle className="lupi-ring__track" cx="12" cy="12" r="10" pathLength={100} />
      <circle className="lupi-ring__arc" cx="12" cy="12" r="10" pathLength={100} />
    </svg>
  );
}

export function RelayPlate({
  galleryId,
  copy,
  label = 'Opening molecule',
  inViewport = false,
  fading = false,
  style,
}: {
  /** Gallery id whose flat preview to centre (none when it has no preview art). */
  galleryId?: string | null;
  /** A short line under the ring, e.g. "Opening…". */
  copy?: string;
  label?: string;
  /** Absolute within the viewer viewport instead of fixed to the window. */
  inViewport?: boolean;
  fading?: boolean;
  style?: CSSProperties;
}) {
  const src = previewUrl(galleryId);
  const [broken, setBroken] = useState<string | null>(null);
  const showPreview = src !== null && broken !== src;
  return (
    <div
      className="lupi-plate"
      role="status"
      aria-label={label}
      data-in-viewport={inViewport || undefined}
      data-fading={fading || undefined}
      style={style}
    >
      {showPreview && (
        <img className="lupi-plate__preview" src={src} alt="" decoding="async" onError={() => setBroken(src)} />
      )}
      <div className="lupi-plate__foot">
        <RelayRing />
        {copy && <span>{copy}</span>}
      </div>
    </div>
  );
}
