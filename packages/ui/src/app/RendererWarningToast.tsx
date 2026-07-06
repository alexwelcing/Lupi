import { useState } from 'react';
import { useStore } from '../store';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { IconClose } from '../icons';

function RendererWarningToastInner({
  rendererWarning,
  isCompact,
}: {
  rendererWarning: string;
  isCompact: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isCpuFallback = /GPU bond acceleration|CPU path/i.test(rendererWarning);
  const severity = isCpuFallback ? 'notice' : 'warning';
  const isNotice = severity === 'notice';
  const isQuietNotice = isCompact && severity === 'notice';
  const isExpanded = !isQuietNotice || detailsOpen;
  const visibleWarning = isQuietNotice && !isExpanded ? 'CPU bond path active' : rendererWarning;
  const announceWarning = isQuietNotice ? rendererWarning : undefined;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={announceWarning}
      title={isQuietNotice ? rendererWarning : undefined}
      className="lupine-glass-panel"
      style={{
        position: 'absolute',
        top: isCompact ? 10 : 16,
        right: isCompact ? 10 : 16,
        maxWidth: isCompact ? (isExpanded ? 'min(280px, calc(100vw - 20px))' : 'min(188px, calc(100vw - 20px))') : 280,
        display: 'flex',
        alignItems: isExpanded ? 'flex-start' : 'center',
        gap: isCompact ? 6 : 8,
        padding: isCompact ? '6px 8px' : '10px 12px',
        background: isQuietNotice
          ? (isExpanded ? 'rgba(12,16,24,0.86)' : 'rgba(12,16,24,0.58)')
          : 'rgba(20,24,33,0.92)',
        border: isNotice
          ? '1px solid rgba(148,163,184,0.14)'
          : '1px solid rgba(245,158,11,0.22)',
        borderRadius: isQuietNotice && !isExpanded ? 999 : 'var(--radius-sm, 8px)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        fontSize: isCompact ? 11 : 12,
        lineHeight: 1.35,
        color: isNotice && isCompact ? 'rgba(226,232,240,0.78)' : 'var(--text-muted, #9aa7bd)',
        zIndex: 160,
      }}
    >
      {isQuietNotice ? (
        <button
          type="button"
          onClick={() => setDetailsOpen(open => !open)}
          aria-expanded={detailsOpen}
          aria-label={detailsOpen ? 'Collapse renderer warning details' : `Expand renderer warning details: ${rendererWarning}`}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: isExpanded ? 'normal' : 'nowrap',
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            font: 'inherit',
            lineHeight: 'inherit',
            padding: 0,
            textAlign: 'left',
          }}
        >
          {visibleWarning}
        </button>
      ) : (
        <span style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: isCompact && isNotice ? 'nowrap' : 'normal',
        }}>
          {visibleWarning}
        </span>
      )}
      <button
        type="button"
        onClick={() => useStore.getState().setRendererWarning(null)}
        aria-label="Dismiss warning"
        title="Dismiss"
        style={{
          flexShrink: 0,
          width: isCompact ? 20 : 18,
          height: isCompact ? 20 : 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-dim, #6b7688)',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <IconClose />
      </button>
    </div>
  );
}

/** Non-blocking, dismissible toast for renderer warnings (WebGPU accelerator
 *  unavailable/timed out → CPU fallback). role="status" so it's announced
 *  politely without stealing focus. The scene keeps rendering underneath. */
export function RendererWarningToast() {
  const rendererWarning = useStore(s => s.rendererWarning);
  const isCompact = useMediaQuery('(max-width: 640px)');
  if (!rendererWarning) return null;
  // Remount (and collapse details) whenever the warning or viewport compactness
  // changes — this is a render-driven reset instead of a useEffect reset.
  return (
    <RendererWarningToastInner
      key={`${rendererWarning}-${isCompact}`}
      rendererWarning={rendererWarning}
      isCompact={isCompact}
    />
  );
}
