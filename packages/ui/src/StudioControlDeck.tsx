/**
 * StudioControlDeck — the shell for the Molecule / Scene control surfaces.
 *
 * Owns only the chrome: positioning (overlay vs drawer), the shared <style>
 * block that both bodies' CSS classes resolve against, and the header with the
 * live title/subtitle. The bodies themselves are composed in — MoleculeControls
 * and SceneControls each own their own store wiring.
 */
import { useStore } from './store';
import { BG_PRESETS } from './backgroundPresets';
import { IconClose } from './icons';
import { MoleculeControls } from './studio/MoleculeControls';
import { SceneControls } from './studio/SceneControls';

export type StudioDeckMode = 'molecule' | 'scene';

export function StudioControlDeck({
  mode,
  onClose,
  bottomOffset = 0,
  maxHeight = 'none',
  variant = 'overlay',
  showCloseButton = true,
}: {
  mode: StudioDeckMode;
  onClose: () => void;
  bottomOffset?: number;
  maxHeight?: string;
  variant?: 'overlay' | 'drawer';
  showCloseButton?: boolean;
}) {
  const isDrawer = variant === 'drawer';
  const postprocessPreset = useStore(s => s.postprocessPreset);
  const colorScheme = useStore(s => s.colorScheme);
  const backgroundPreset = useStore(s => s.backgroundPreset);
  const activeBackgroundPreset = BG_PRESETS[backgroundPreset];

  const title = mode === 'molecule' ? 'Molecule' : 'Scene';
  const subtitle = mode === 'molecule'
    ? `${postprocessPreset} grade · ${colorScheme} color`
    : (activeBackgroundPreset?.label ?? backgroundPreset);

  return (
    <div
      data-testid="studio-control-deck"
      style={{
        position: isDrawer ? 'relative' : 'absolute',
        left: isDrawer ? undefined : 0,
        right: isDrawer ? undefined : 0,
        bottom: isDrawer ? undefined : bottomOffset,
        display: 'flex',
        justifyContent: isDrawer ? 'stretch' : 'center',
        pointerEvents: isDrawer ? 'auto' : 'none',
        zIndex: isDrawer ? undefined : 148,
        padding: isDrawer ? 0 : '0 12px',
        minHeight: 0,
        height: isDrawer ? '100%' : undefined,
      }}
    >
      <style>{`
        @keyframes lupi-rive-snap {
          0% { transform: scale(1); box-shadow: 0 0 16px rgba(30, 220, 224, 0.42); }
          38% { transform: scale(0.97); }
          100% { transform: scale(1); }
        }
        @keyframes lupi-rive-flash {
          0% { opacity: 0.78; transform: scale(0.96); }
          100% { opacity: 0; transform: scale(1.06); }
        }
        .lupi-rive-snap {
          animation: lupi-rive-snap 240ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .lupi-rive-flash {
          animation: lupi-rive-flash 150ms ease-out forwards;
        }
        .lupi-rive-dial:focus-visible {
          outline: 2px solid rgba(30, 220, 224, 0.85);
          outline-offset: 2px;
        }
        .lupi-deck-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          align-items: stretch;
        }
        .lupi-studio-segments {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
          gap: 6px;
        }
        .lupi-studio-slider-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 7px;
        }
        .lupi-world-rail {
          display: flex;
          gap: 7px;
          overflow-x: auto;
          overflow-y: hidden;
          padding: 1px;
          scroll-snap-type: x proximity;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .lupi-world-rail::-webkit-scrollbar {
          display: none;
          width: 0;
          height: 0;
        }
        .lupi-native-color::-webkit-color-swatch-wrapper {
          padding: 0;
        }
        .lupi-native-color::-webkit-color-swatch {
          border: 0;
          border-radius: 5px;
        }
        .lupi-studio-deck-drawer .lupi-deck-grid {
          grid-template-columns: 1fr;
          gap: 7px;
        }
        .lupi-studio-deck-drawer .lupi-studio-segments {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        @media (max-width: 768px) {
          .lupi-deck-grid {
            gap: 8px;
          }
          .lupi-studio-slider-grid {
            grid-template-columns: 1fr;
            gap: 7px;
          }
        }
      `}</style>
      <div
        className={isDrawer ? 'lupi-studio-deck lupi-studio-deck-drawer' : 'lupi-studio-deck'}
        style={{
          pointerEvents: 'auto',
          width: isDrawer ? '100%' : 'min(940px, calc(100vw - 24px))',
          height: isDrawer ? '100%' : undefined,
          maxHeight: isDrawer ? 'none' : maxHeight,
          overflowY: isDrawer ? 'auto' : 'hidden',
          overflowX: 'hidden',
          scrollbarWidth: 'none',
          border: isDrawer ? 'none' : '1px solid rgba(255,255,255,0.12)',
          borderRadius: isDrawer ? 0 : 8,
          background: isDrawer ? 'transparent' : 'linear-gradient(180deg, rgba(4,9,17,0.88), rgba(0,0,0,0.78))',
          boxShadow: isDrawer ? 'none' : '0 24px 80px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.08)',
          backdropFilter: isDrawer ? 'none' : 'blur(18px)',
          WebkitBackdropFilter: isDrawer ? 'none' : 'blur(18px)',
          padding: isDrawer ? '6px 6px 10px' : 8,
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: isDrawer ? 6 : 8,
          padding: isDrawer ? '0 0 1px' : '2px 2px 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{
              width: isDrawer ? 5 : 6,
              height: isDrawer ? 26 : 30,
              borderRadius: 3,
              background: 'linear-gradient(180deg, #1edce0, #f59e0b)',
              boxShadow: '0 0 16px rgba(30,220,224,0.28)',
              flexShrink: 0,
            }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#f8fafc', fontSize: isDrawer ? 12 : 13, fontWeight: 820, lineHeight: 1.1 }}>{title}</div>
              <div style={{
                color: '#94a3b8',
                fontSize: isDrawer ? 9 : 10,
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                lineHeight: 1.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {subtitle}
              </div>
            </div>
          </div>
          {showCloseButton && (
            <button
              type="button"
              aria-label={`Close ${title} controls`}
              onClick={onClose}
              title="Close"
              className="lupine-icon-btn"
              style={{ width: 28, height: 28 }}
            >
              <IconClose />
            </button>
          )}
        </div>

        {mode === 'molecule' ? <MoleculeControls /> : <SceneControls />}
      </div>
    </div>
  );
}
