import { useEffect, useRef } from 'react';

export function RemoteMoleculeLoadError({ onRetry }: { onRetry?: () => void }) {
  const alertRef = useRef<HTMLElement>(null);
  useEffect(() => { alertRef.current?.focus(); }, []);

  return (
    <section
      ref={alertRef}
      role="alert"
      tabIndex={-1}
      aria-labelledby="remote-molecule-error-title"
      style={{
        width: 'min(560px, calc(100% - 40px))',
        margin: 'clamp(96px, 18vh, 180px) auto 48px',
        padding: 32,
        color: '#f8fafc',
        background: 'rgba(10, 12, 18, 0.94)',
        border: '1px solid rgba(248, 113, 113, 0.35)',
        borderRadius: 16,
      }}
    >
      <p style={{ margin: '0 0 10px', color: '#fda4af', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        Remote molecule
      </p>
      <h1 id="remote-molecule-error-title" style={{ margin: 0, fontSize: 'clamp(28px, 5vw, 42px)' }}>
        This molecule link could not be opened
      </h1>
      <p style={{ margin: '16px 0 0', color: '#cbd5e1', fontSize: 16, lineHeight: 1.6 }}>
        Lupi only opens automatic links from reviewed gallery and catalog sources. You can retry a temporary failure or choose a trusted example.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
        <button
          type="button"
          onClick={onRetry ?? (() => window.location.reload())}
          style={{ border: 0, borderRadius: 8, padding: '10px 18px', background: '#fb7185', color: '#4c0519', fontWeight: 700, cursor: 'pointer' }}
        >
          Retry
        </button>
        <a href="/#gallery" style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 8, padding: '10px 18px', border: '1px solid #475569', color: '#e2e8f0', textDecoration: 'none', fontWeight: 600 }}>
          Explore trusted examples
        </a>
      </div>
    </section>
  );
}
