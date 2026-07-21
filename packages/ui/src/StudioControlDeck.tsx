/**
 * StudioControlDeck — the shell for the Molecule / Scene control surfaces.
 *
 * Renders inside the edge-docked command panel. It owns the shared styles used
 * by both bodies; MoleculeControls and SceneControls own their store wiring.
 */
import { MoleculeControls } from './studio/MoleculeControls';
import { SceneControls } from './studio/SceneControls';
import { useStore } from './store';

export type StudioDeckMode = 'molecule' | 'scene';

export function StudioControlDeck({ mode }: { mode: StudioDeckMode }) {
  const setStudioDeck = useStore(s => s.setStudioDeck);

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
        .lupi-visuals-switcher {
          position: sticky;
          top: -8px;
          z-index: 3;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 5px;
          margin: -8px -8px 8px;
          padding: 8px;
          background: #081019;
          border-bottom: 1px solid #22303d;
        }
        .lupi-visuals-switcher button {
          min-height: 34px;
          color: #8192a3;
          background: #0b141e;
          border: 1px solid #263746;
          border-radius: 5px;
          font-size: 10px;
          font-weight: 760;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          cursor: pointer;
        }
        .lupi-visuals-switcher button:hover {
          color: #d8e3ed;
          border-color: #385064;
        }
        .lupi-visuals-switcher button[aria-pressed='true'] {
          color: #dffeff;
          background: rgba(34, 211, 215, 0.1);
          border-color: rgba(34, 211, 215, 0.46);
          box-shadow: inset 0 -2px 0 #22d3d7;
        }
        .lupi-visuals-switcher button:focus-visible {
          outline: 2px solid rgba(34, 211, 215, 0.82);
          outline-offset: -2px;
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

      <div className="lupi-visuals-switcher" role="group" aria-label="Visual controls">
        <button
          type="button"
          aria-label="Structure controls"
          aria-pressed={mode === 'molecule'}
          onClick={() => setStudioDeck('molecule')}
        >
          Structure
        </button>
        <button
          type="button"
          aria-label="Scene controls"
          aria-pressed={mode === 'scene'}
          onClick={() => setStudioDeck('scene')}
        >
          Scene
        </button>
      </div>

      {mode === 'molecule' ? <MoleculeControls /> : <SceneControls />}
    </div>
  );
}
