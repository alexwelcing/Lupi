/**
 * StudioControlDeck — the shell for the Molecule / Scene control surfaces.
 *
 * Renders inside the edge-docked command panel. It owns the shared styles used
 * by both bodies; MoleculeControls and SceneControls own their store wiring.
 */
import { MoleculeControls } from './studio/MoleculeControls';
import { SceneControls } from './studio/SceneControls';

export type StudioDeckMode = 'molecule' | 'scene';

export function StudioControlDeck({ mode }: { mode: StudioDeckMode }) {
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
        padding: '8px 8px 14px',
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
          gap: 0;
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

      {mode === 'molecule' ? <MoleculeControls /> : <SceneControls />}
    </div>
  );
}
