import { useStore } from '../store';
import { FlexRow } from '../primitives/AppShell';
import { IconClose } from '../icons';
import { SavedViewButton } from '../SavedViewButton';
import { LupiAgentDock } from '../LupiAgentDock';
import { LupiAuthCallout } from '../LupiAuthCallout';
import { openRandomOmol25Molecule } from '../molecules/randomOmol';

export function AppHeader({
  isMobile,
  clearLoadedFile,
}: {
  isMobile: boolean;
  clearLoadedFile: () => void;
}) {
  const file = useStore(s => s.file);
  const mobileLoadedHeader = isMobile && !!file;

  return (
    <>
      <header
        className={file ? 'lupine-glass' : ''}
        style={{
          height: 'var(--app-header-height)',
          minHeight: 'var(--app-header-height)',
          flexShrink: 0,
          display: mobileLoadedHeader ? 'grid' : 'flex',
          alignItems: 'center',
          justifyContent: mobileLoadedHeader ? undefined : 'space-between',
          gridTemplateColumns: mobileLoadedHeader ? 'auto minmax(0, 1fr) auto' : undefined,
          gridTemplateRows: mobileLoadedHeader ? '38px 28px' : undefined,
          columnGap: mobileLoadedHeader ? 8 : undefined,
          rowGap: mobileLoadedHeader ? 2 : undefined,
          padding: mobileLoadedHeader ? 'calc(env(safe-area-inset-top) + 10px) 10px 6px' : (isMobile ? 'env(safe-area-inset-top) 8px 0' : '0 16px'),
          margin: file ? (isMobile ? '0 8px 0' : '14px 16px 0') : 0,
          borderRadius: file ? 8 : 0,
          borderBottom: file ? 'none' : '1px solid var(--border-subtle)',
          background: file ? undefined : 'var(--bg-glass)',
          backdropFilter: file ? undefined : 'blur(12px)',
          WebkitBackdropFilter: file ? undefined : 'blur(12px)',
          boxShadow: file ? '0 18px 48px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.08)' : undefined,
          zIndex: 200,
        }}
      >
        <FlexRow
          gap={isMobile ? 6 : 12}
          className="lupine-truncate"
          style={{
            gridColumn: mobileLoadedHeader ? '1 / 2' : undefined,
            gridRow: mobileLoadedHeader ? '1' : undefined,
          }}
        >
          <button
            onClick={() => { if (file) clearLoadedFile(); }}
            aria-label={file ? 'Return to Lupi home' : 'Lupi home'}
            className="lupine-btn icon-only"
            style={{
              background: 'transparent',
              borderColor: 'transparent',
              boxShadow: 'none',
              padding: isMobile ? '0 2px' : 6,
              gap: 4,
              cursor: file ? 'pointer' : 'default',
              height: isMobile ? 34 : undefined,
              minHeight: isMobile ? 34 : undefined,
              aspectRatio: isMobile ? 'auto' : undefined,
              flexShrink: 0,
            }}
          >
            <span style={{
              fontSize: isMobile ? 19 : 21, fontWeight: 750, color: 'var(--text-primary)',
              letterSpacing: 0
            }}>
              Lupi
            </span>
          </button>

          {file && !isMobile && (
            <>
              <div className="lupine-divider" />
              <span style={{ display: 'grid', gap: 1, minWidth: 0, maxWidth: 300 }}>
                <span style={{
                  fontSize: 10,
                  color: 'rgba(203,213,225,0.48)',
                  fontWeight: 760,
                  lineHeight: 1,
                  textTransform: 'uppercase',
                  letterSpacing: 0,
                }}>
                  Loaded
                </span>
                <span
                  className="lupine-truncate"
                  style={{
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    fontWeight: 650,
                    lineHeight: 1.2,
                  }}
                  title={file.name}
                >
                  {file.name}
                </span>
              </span>
              <button
                onClick={clearLoadedFile}
                title="Close"
                aria-label="Close dataset"
                className="lupine-icon-btn"
                style={{ width: 28, height: 28 }}
              >
                <IconClose />
              </button>
            </>
          )}
        </FlexRow>

        {file && isMobile && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
              gridColumn: '1 / -1',
              gridRow: '2',
              padding: '0 1px',
            }}
          >
            <span style={{
              flexShrink: 0,
              fontSize: 9,
              color: 'rgba(203,213,225,0.48)',
              fontWeight: 760,
              lineHeight: 1,
              textTransform: 'uppercase',
              letterSpacing: 0,
            }}>
              Loaded
            </span>
            <span
              title={file.name}
              className="lupine-truncate"
              style={{
                flex: '1 1 auto',
                fontSize: 12,
                color: 'var(--text-primary)',
                fontWeight: 650,
                lineHeight: 1.15,
              }}
            >
              {file.name}
            </span>
            <button
              onClick={clearLoadedFile}
              title="Close"
              aria-label="Close dataset"
              className="lupine-icon-btn"
              style={{ width: 28, height: 28, flexShrink: 0 }}
            >
              <IconClose />
            </button>
          </div>
        )}

        <FlexRow
          gap={isMobile ? 4 : 10}
          style={{
            justifyContent: 'flex-end',
            minWidth: 0,
            gridColumn: mobileLoadedHeader ? '2 / 4' : undefined,
            gridRow: mobileLoadedHeader ? '1' : undefined,
            justifySelf: mobileLoadedHeader ? 'end' : undefined,
          }}
        >
          {!file && (
            <>
              <a
                href="#gallery"
                onClick={(e) => {
                  const el = document.getElementById('gallery');
                  if (el) {
                    e.preventDefault();
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
                className="lupine-btn"
                style={{
                  padding: isMobile ? '7px 9px' : '8px 12px',
                  fontSize: isMobile ? 12 : 13,
                  minHeight: isMobile ? 34 : undefined,
                }}
              >
                Gallery
              </a>
              <button
                onClick={() => void openRandomOmol25Molecule()}
                className="lupine-btn primary"
                style={{
                  padding: isMobile ? '7px 10px' : '8px 14px',
                  fontSize: isMobile ? 12 : 14,
                  minHeight: isMobile ? 34 : undefined,
                }}
              >
                {isMobile ? 'View' : 'View a molecule'}
              </button>
            </>
          )}
          {file && <SavedViewButton compact={isMobile} />}
          <LupiAgentDock compact={isMobile} />
        </FlexRow>
      </header>
      <LupiAuthCallout compact={isMobile} />
    </>
  );
}
