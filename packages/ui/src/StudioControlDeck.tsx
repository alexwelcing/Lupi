/**
 * StudioControlDeck — the shell for the Molecule / Scene control surfaces.
 *
 * Always renders inside the Controls drawer (the desktop dock and the mobile
 * sheet both mount it via ViewerControlsDrawer). It owns only the chrome: the
 * shared <style> block both bodies' CSS classes resolve against, and a compact
 * live-status line. The bodies themselves are composed in — MoleculeControls
 * and SceneControls each own their own store wiring.
 *
 * The mode name isn't repeated here: the drawer's mode tabs sit directly above
 * and already show which surface is active, so the status line carries the
 * live detail (grade · color, or the active world) instead.
 */
import { useStore } from './store';
import { BG_PRESETS } from './backgroundPresets';
import { MoleculeControls } from './studio/MoleculeControls';
import { SceneControls } from './studio/SceneControls';

export type StudioDeckMode = 'molecule' | 'scene';

export function StudioControlDeck({ mode }: { mode: StudioDeckMode }) {
  const postprocessPreset = useStore(s => s.postprocessPreset);
  const colorScheme = useStore(s => s.colorScheme);
  const backgroundPreset = useStore(s => s.backgroundPreset);
  const activeBackgroundPreset = BG_PRESETS[backgroundPreset];

  const status = mode === 'molecule'
    ? `${postprocessPreset} grade · ${colorScheme} color`
    : (activeBackgroundPreset?.label ?? backgroundPreset);

  return (
    <div
      data-testid="studio-control-deck"
      className="lupi-studio-deck"
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarWidth: 'none',
        padding: '6px 6px 10px',
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
          grid-template-columns: 1fr;
          gap: 7px;
          align-items: stretch;
        }
        .lupi-studio-segments {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
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
        @media (max-width: 768px) {
          .lupi-studio-slider-grid {
            grid-template-columns: 1fr;
            gap: 7px;
          }
        }
      `}</style>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
        padding: '0 2px 1px',
        minWidth: 0,
      }}>
        <div style={{
          width: 4,
          height: 18,
          borderRadius: 3,
          background: 'linear-gradient(180deg, #1edce0, #f59e0b)',
          boxShadow: '0 0 16px rgba(30,220,224,0.28)',
          flexShrink: 0,
        }} />
        <div style={{
          minWidth: 0,
          color: '#94a3b8',
          fontSize: 10,
          fontWeight: 760,
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: 0.3,
          lineHeight: 1.25,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {status}
        </div>
      </div>

      {mode === 'molecule' ? <MoleculeControls /> : <SceneControls />}
    </div>
  );
}
