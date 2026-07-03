/**
 * XREntryButton — DOM (non-R3F) AR/VR session entry buttons.
 *
 * Probes `navigator.xr.isSessionSupported` once on mount and renders a
 * "View in AR" / "Enter VR" button per supported immersive mode, wired to
 * the passed-in xrStore's enterAR/enterVR. Renders nothing when WebXR (or
 * both immersive modes) is unavailable so the 2D HUD stays clean on
 * desktop. Mounted by the app shell next to the canvas — this module only
 * exports the component.
 */

import React, { useEffect, useState } from 'react';

/** Structural subset of @react-three/xr's XRStore — keeps this component mockable. */
export interface XREntryStore {
  enterAR: () => unknown;
  enterVR: () => unknown;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '8px',
  border: '1px solid rgba(255, 255, 255, 0.25)',
  background: 'rgba(20, 22, 28, 0.85)',
  color: '#e8eaf0',
  font: '600 13px/1 system-ui, sans-serif',
  letterSpacing: '0.02em',
  cursor: 'pointer',
};

export function XREntryButton({ store }: { store: XREntryStore }) {
  const [supported, setSupported] = useState({ ar: false, vr: false });

  useEffect(() => {
    let cancelled = false;
    const xr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
    if (!xr?.isSessionSupported) return;
    Promise.all([
      xr.isSessionSupported('immersive-ar').catch(() => false),
      xr.isSessionSupported('immersive-vr').catch(() => false),
    ]).then(([ar, vr]) => {
      if (!cancelled) setSupported({ ar: !!ar, vr: !!vr });
    });
    return () => { cancelled = true; };
  }, []);

  if (!supported.ar && !supported.vr) return null;

  return (
    <div style={containerStyle}>
      {supported.ar && (
        <button type="button" style={buttonStyle} onClick={() => store.enterAR()}>
          View in AR
        </button>
      )}
      {supported.vr && (
        <button type="button" style={buttonStyle} onClick={() => store.enterVR()}>
          Enter VR
        </button>
      )}
    </div>
  );
}
