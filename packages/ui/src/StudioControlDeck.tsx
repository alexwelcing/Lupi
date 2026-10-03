import { useState, useSyncExternalStore } from 'react';
import { useStore } from './store';
import { SCENE_LOOKS, currentSceneLook, sceneLookPatch } from './sceneLooks';
import { MOD_SECTIONS, SceneModControls, SceneToggle, StructureGuideMods, type ModSection } from './SceneModControls';
import { LupiActionButton } from './LupiActionButton';
import { withCameraGlide } from './camera/rigApi';
import { IconBack, IconControls, IconRecenter, IconRemix, IconTick, IconUndo } from './icons';
import {
  describeRemix,
  openRemixSheet,
  remixCodeStatus,
  remixHistoryDepth,
  rollRemix,
  subscribeRemixHistory,
  undoRemix,
} from './remix/actions';
import { FOIL_LABEL, FOIL_ODDS_TEXT } from './remix/code';
import { remixStore, useRemixStore } from './remix/remixStore';
export type StudioDeckMode = 'molecule' | 'scene';

// Remix history lives in remix/actions (per molecule, like before): it
// survives closing the panel without retaining an unloaded trajectory or
// undoing changes into a different molecule.

export function StudioControlDeck({ mode: _mode }: { mode: StudioDeckMode }) {
  const [adjusting, setAdjusting] = useState(false);
  const [section, setSection] = useState<ModSection>('Atoms');
  const includeMedia = useRemixStore(s => s.worlds);
  const lockColors = useRemixStore(s => s.keepColors);
  const includeColors = !lockColors;
  const [announcement, setAnnouncement] = useState('');
  const historyDepth = useSyncExternalStore(subscribeRemixHistory, remixHistoryDepth, () => 0);
  const applied = useRemixStore(s => s.applied);
  const codeStatus = useStore(s => remixCodeStatus(s, applied));
  const look = useStore(currentSceneLook);
  const remix = () => {
    const rolled = rollRemix('deck');
    setAnnouncement(`${describeRemix(rolled.code, rolled.foil)}${includeColors ? ' A decorative type palette is applied; molecular data is unchanged.' : ' Your structure and data colors are unchanged.'}`);
  };
  const undo = () => {
    if (undoRemix()) setAnnouncement('Previous look restored.');
  };
  return <div data-testid="studio-control-deck" className="scene-controls">
    <div className="scene-controls__intro"><p>Make a little wonder.</p>
      <span>{look ? `${SCENE_LOOKS.find(item => item.id === look)!.label} look` : 'Custom look'} · same science, more personality.</span></div>
    <div className="scene-remix-bar">
      <LupiActionButton className="scene-remix" onClick={remix} title={`Roll a new look (M). ${FOIL_ODDS_TEXT}.`}><IconRemix /> Remix scene</LupiActionButton>
      <button type="button" className="scene-controls__button" onClick={undo} disabled={historyDepth === 0} aria-label="Undo remix"><IconUndo /> Undo</button>
      <button type="button" className="scene-controls__button scene-remix-code" data-foil={applied?.foil ?? undefined}
        onClick={openRemixSheet} aria-label={applied ? `Remix code ${applied.code.text}${codeStatus === 'edited' ? ', edited' : ''}: copy, share or type a code` : 'Remix codes: type a code'}>
        {applied ? <>{applied.code.text}{applied.foil ? ` · ${FOIL_LABEL[applied.foil]}` : ''}{codeStatus === 'edited' ? ' · edited' : ''}</> : 'Code…'}
      </button>
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
        <SceneToggle label="Keep atom colors" checked={lockColors} onChange={value => remixStore.getState().setKeepColors(value)} />
        <SceneToggle label="Include worlds & motion in Remix" checked={includeMedia} onChange={value => remixStore.getState().setWorlds(value)} />
      </div>
      <p className="scene-controls__hint">{includeColors ? 'Each remix includes a new decorative atom palette. ' : 'Atom colors are kept. '}
        Remix changes finish, light, backdrop, and atmosphere—not molecular data or camera—and every look has a code you can share or type back in. {FOIL_ODDS_TEXT} (a cosmetic finish). Worlds and motion may load extra media.</p>
    </> : <div id="scene-adjustments" className="scene-controls__adjustments">
      <div className="scene-mod-nav" role="group" aria-label="Visual mod categories">
        {MOD_SECTIONS.map(item => <button key={item} type="button" aria-pressed={section === item} onClick={() => setSection(item)}>{item}</button>)}
      </div>
      <SceneModControls section={section} />
      {section === 'Atoms' && <StructureGuideMods />}
    </div>}
    <div className="scene-controls__actions">
      <button type="button" className="scene-controls__button" onClick={() => withCameraGlide(() => useStore.getState().fitCameraView())}><IconRecenter /> Recenter</button>
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
