import { SeoEducationPage, type SeoEducationKind } from './SeoEducationPage';

/** Lightweight shell for static learning/data routes. It intentionally avoids
 * the Three/R3F viewer graph; a viewer chunk is requested only after a visitor
 * follows one of the molecule or scene actions on the page. */
export function SeoEducationShell({ kind }: { kind: SeoEducationKind }) {
  return (
    <div style={{ minHeight: '100vh', background: '#020204' }}>
      <header style={{
        height: 56,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 clamp(16px, 4vw, 40px)',
        borderBottom: '1px solid rgba(255,255,255,0.09)',
        background: 'rgba(2,2,4,0.92)',
      }}>
        <a href="/" aria-label="Lupi home" style={{
          color: '#eef2f8',
          fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
          fontSize: 24,
          textDecoration: 'none',
        }}>
          Lupi
        </a>
        <a href="/#gallery" style={{
          color: 'rgba(226,232,240,0.76)',
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          fontSize: 12,
          textDecoration: 'none',
        }}>
          Explore structures
        </a>
      </header>
      <SeoEducationPage kind={kind} />
    </div>
  );
}

export default SeoEducationShell;
