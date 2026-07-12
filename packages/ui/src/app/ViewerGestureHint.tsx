import { useEffect, useState } from 'react';

const SESSION_KEY = 'lupi:viewer-gesture-hint-seen';

export function ViewerGestureHint({ isMobile }: { isMobile: boolean }) {
  const [visible, setVisible] = useState(() => {
    try {
      return window.sessionStorage.getItem(SESSION_KEY) !== '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!visible) return;

    const dismissAfterCanvasInteraction = (event: Event) => {
      if (!(event.target instanceof HTMLCanvasElement)) return;
      setVisible(false);
      try {
        window.sessionStorage.setItem(SESSION_KEY, '1');
      } catch {
        // Storage may be unavailable in strict privacy contexts.
      }
    };

    window.addEventListener('pointerdown', dismissAfterCanvasInteraction, true);
    window.addEventListener('wheel', dismissAfterCanvasInteraction, true);
    window.addEventListener('touchstart', dismissAfterCanvasInteraction, true);
    return () => {
      window.removeEventListener('pointerdown', dismissAfterCanvasInteraction, true);
      window.removeEventListener('wheel', dismissAfterCanvasInteraction, true);
      window.removeEventListener('touchstart', dismissAfterCanvasInteraction, true);
    };
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // The hint can safely return next session when storage is unavailable.
    }
  };

  return (
    <div
      role="status"
      aria-label="Viewer controls"
      data-testid="viewer-gesture-hint"
      style={{
        position: 'absolute',
        top: isMobile ? 132 : 140,
        left: '50%',
        zIndex: 148,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        maxWidth: isMobile ? 'calc(100vw - 32px)' : 'min(620px, calc(100vw - 420px))',
        minWidth: 0,
        padding: '8px 9px 8px 12px',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 999,
        background: 'rgba(7,11,19,0.82)',
        color: '#e2e8f0',
        boxShadow: '0 12px 36px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.06)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        pointerEvents: 'none',
      }}
    >
      <span aria-hidden="true" style={{ color: '#1edce0', fontSize: 14, flexShrink: 0 }}>◎</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: isMobile ? 10 : 11, fontWeight: 650 }}>
        {isMobile ? 'Drag to rotate · Pinch to zoom · Tap an atom' : 'Drag to rotate · Scroll to zoom · Select an atom to inspect'}
      </span>
      <button
        type="button"
        aria-label="Dismiss viewer guidance"
        onClick={dismiss}
        style={{
          width: 28,
          height: 28,
          flexShrink: 0,
          border: 0,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.07)',
          color: '#cbd5e1',
          cursor: 'pointer',
          pointerEvents: 'auto',
        }}
      >
        ×
      </button>
    </div>
  );
}
