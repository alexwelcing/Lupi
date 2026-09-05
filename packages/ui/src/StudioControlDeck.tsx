import { useState } from 'react';
import { useStore } from './store';
import { SCENE_LOOKS, currentSceneLook, sceneLookPatch } from './sceneLooks';
import { MOD_SECTIONS, SceneModControls, SceneToggle, StructureGuideMods, type ModSection } from './SceneModControls';
import { remixScene, snapshotRemix, type RemixSnapshot } from './sceneRemix';
import { LupiActionButton } from './LupiActionButton';
import { IconBack, IconControls, IconRecenter, IconRemix, IconTick, IconUndo } from './icons';
export type StudioDeckMode = 'molecule' | 'scene';

// Presentation-only history survives closing the panel without retaining an
// unloaded trajectory or undoing changes into a different molecule.
const histories = new WeakMap<object, RemixSnapshot[]>();
const emptyScene = {};

export function StudioControlDeck({ mode: _mode }: { mode: StudioDeckMode }) {
  const [adjusting, setAdjusting] = useState(false);
  const [section, setSection] = useState<ModSection>('Atoms');
  const [includeMedia, setIncludeMedia] = useState(false);
  const [lockColors, setLockColors] = useState(false);
  const includeColors = !lockColors;
  const [announcement, setAnnouncement] = useState('');
  const [, refreshHistory] = useState(0);
  const file = useStore(s => s.file);
  const source = file ?? emptyScene;
  const history = histories.get(source) ?? [];
  const look = useStore(currentSceneLook);
  const remix = () => {
    const state = useStore.getState();
    histories.set(source, [...history.slice(-7), snapshotRemix(state, includeColors)]);
    const patch = remixScene(state, includeMedia, Math.random, includeColors);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) patch.backgroundMotionPaused = true;
    useStore.setState(patch);
    refreshHistory(value => value + 1);
    setAnnouncement(includeColors ? 'New remix and decorative type palette applied. Molecular data is unchanged.' : 'New remix applied. Your structure and data colors are unchanged.');
  };
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    histories.set(source, history.slice(0, -1));
    useStore.setState(previous);
    refreshHistory(value => value + 1);
    setAnnouncement('Previous look restored.');
  };
  return <div data-testid="studio-control-deck" className="scene-controls">
    <div className="scene-controls__intro"><p>Make a little wonder.</p>
      <span>{look ? `${SCENE_LOOKS.find(item => item.id === look)!.label} look` : 'Custom look'} · same science, more personality.</span></div>
    <div className="scene-remix-bar">
      <LupiActionButton className="scene-remix" onClick={remix}><IconRemix /> Remix scene</LupiActionButton>
      <button type="button" className="scene-controls__button" onClick={undo} disabled={!history.length} aria-label="Undo remix"><IconUndo /> Undo</button>
    </div>
    <span className="scene-controls__announcement" role="status">{announcement}</span>
    {!adjusting ? <>
      <div className="scene-controls__looks" role="group" aria-label="Scene looks">
        {SCENE_LOOKS.map(item => <button key={item.id} type="button" className="scene-look" data-look={item.id}
          aria-label={`${item.label} look`} aria-pressed={look === item.id}
          onClick={() => useStore.setState(sceneLookPatch(item.id, useStore.getState().file?.trajectory.frames[0]?.natoms ?? 0))}>
          <span className="scene-look__sample" aria-hidden="true"><i /><i /><i /></span>
          <strong>{item.label}{look === item.id && <IconTick />}</strong>
          <small>{item.description}</small>
        </button>)}
      </div>
      <div className="scene-remix-options">
        <SceneToggle label="Keep atom colors" checked={lockColors} onChange={setLockColors} />
        <SceneToggle label="Include worlds & motion in Remix" checked={includeMedia} onChange={setIncludeMedia} />
      </div>
      <p className="scene-controls__hint">{includeColors ? 'Each remix includes a new decorative atom palette. ' : 'Atom colors are locked. '}
        Remix changes finish, light, backdrop, and atmosphere—not molecular data or camera. Worlds and motion may load extra media.</p>
    </> : <div id="scene-adjustments" className="scene-controls__adjustments">
      <div className="scene-mod-nav" role="group" aria-label="Visual mod categories">
        {MOD_SECTIONS.map(item => <button key={item} type="button" aria-pressed={section === item} onClick={() => setSection(item)}>{item}</button>)}
      </div>
      <SceneModControls section={section} />
      {section === 'Atoms' && <StructureGuideMods />}
    </div>}
    <div className="scene-controls__actions">
      <button type="button" className="scene-controls__button" onClick={() => useStore.getState().fitCameraView()}><IconRecenter /> Recenter</button>
      <LupiActionButton className="scene-controls__button scene-controls__button--primary"
        aria-expanded={adjusting} aria-controls={adjusting ? 'scene-adjustments' : undefined} onClick={event => {
          setAdjusting(value => !value);
          event.currentTarget.closest('.lupine-command-panel__body')?.scrollTo({ top: 0 });
        }}>
        {adjusting ? <IconBack /> : <IconControls />}{adjusting ? 'Back to looks' : 'All visual mods'}
      </LupiActionButton>
    </div>
  </div>;
}
