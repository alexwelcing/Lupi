import { useMemo } from 'react';
import { hasCompleteElementMapping, resolveTypeLabel, resolveTypeColor, detectVectorFields, canInferCovalentBonds } from '@atlas/core';
import { MATERIAL_SCENES } from '@atlas/scene/materials';
import { MAX_TRANSMISSION_ATOMS } from '@atlas/scene';
import { useStore, type AppState } from './store';
import { BG_PRESETS, getBgMedia } from './backgroundPresets';
import { COLOR_SCHEMES, SCHEME_ORDER } from './coloring';
import { POSTPROCESS_PRESETS, PRESET_ORDER } from './postprocess/presets';
import { resolveEffects, type EffectOverrides } from './postprocess/controls';
import { getDeviceTier } from './deviceCapabilities';

export const MOD_SECTIONS = ['Atoms', 'Backdrop', 'Light', 'Sphere', 'Effects'] as const;
export type ModSection = typeof MOD_SECTIONS[number];
type KeysOf<T> = { [K in keyof AppState]: AppState[K] extends T ? K : never }[keyof AppState];
type Option = readonly [string, string];
const options = (...values: string[]): Option[] => values.map(value => [value, value[0].toUpperCase() + value.slice(1)]);

function Range({ field, label, min, max, step = .01 }: { field: KeysOf<number>; label: string; min: number; max: number; step?: number }) {
  const value = useStore(s => s[field]);
  return <label className="scene-controls__range"><span>{label}<output>{Number(value.toFixed(2))}</output></span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value}
      onChange={e => useStore.setState({ [field]: Number(e.target.value) })} /></label>;
}
function Select({ field, label, choices }: { field: KeysOf<string>; label: string; choices: readonly Option[] }) {
  const value = useStore(s => s[field]);
  return <label className="scene-mod-select"><span>{label}</span><select aria-label={label} value={value}
    onChange={e => useStore.setState({ [field]: e.target.value })}>
    {choices.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
  </select></label>;
}
function Color({ field, label }: { field: KeysOf<string>; label: string }) {
  const value = useStore(s => s[field]);
  return <label className="scene-mod-color"><span>{label}</span><input aria-label={label} type="color" value={value}
    onChange={e => useStore.setState({ [field]: e.target.value })} /></label>;
}
export function SceneToggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="scene-controls__toggle"><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled}
    onChange={e => onChange(e.target.checked)} /></label>;
}

function AtomMods() {
  const file = useStore(s => s.file);
  const frameIndex = useStore(s => s.frame);
  const frame = file?.trajectory.frames[frameIndex] ?? file?.trajectory.frames[0];
  const scheme = useStore(s => s.colorScheme);
  const property = useStore(s => s.colorProperty);
  const material = useStore(s => s.materialPreset);
  const sceneId = useStore(s => s.materialScene);
  const mix = useStore(s => s.materialIntensity);
  const environment = useStore(s => s.environmentPreset);
  const texture = useStore(s => s.atomTexture);
  const vectorField = useStore(s => s.vectorField);
  const matchingRecipe = MATERIAL_SCENES.find(scene => scene.id === sceneId && scene.materialPreset === material
    && scene.materialIntensity === mix && scene.environmentPreset === environment && scene.atomTexture === texture);
  const overrides = useStore(s => s.elementColorOverrides);
  const properties = frame ? [...frame.properties.keys()] : [];
  const vectors = useMemo(() => frame ? detectVectorFields(frame.properties.keys()) : [], [frame]);
  const identified = !!frame && hasCompleteElementMapping(frame);
  const types = useMemo(() => frame ? [...new Set(frame.types)] : [], [frame]);
  return <>
    <label className="scene-mod-select"><span>Material recipe</span><select aria-label="Material recipe" value={matchingRecipe?.id ?? ''}
      onChange={e => {
        const recipe = MATERIAL_SCENES.find(scene => scene.id === e.target.value)!;
        useStore.setState({ materialScene: recipe.id, materialPreset: recipe.materialPreset, materialIntensity: recipe.materialIntensity,
          environmentPreset: recipe.environmentPreset, atomTexture: recipe.atomTexture });
      }}>
      <option value="" disabled>Custom finish</option>
      {MATERIAL_SCENES.map(scene => <option key={scene.id} value={scene.id}>{scene.label}</option>)}
    </select></label>
    <Select field="materialPreset" label="Atom finish" choices={[
      ['default', 'Element-specific'], ['matte', 'Matte'], ['plastic', 'Polished plastic'], ['metallic', 'Metal'], ['glass', 'Glass (fast)'], ['transmission', 'Refractive glass'],
    ]} />
    {material === 'transmission' && <p className="scene-controls__hint">{(frame?.natoms ?? 0) > MAX_TRANSMISSION_ATOMS
      ? 'This scene exceeds the refraction budget; fast glass is used instead.'
      : 'Real refraction uses more GPU power. Try Glass (fast) for smoother interaction.'}</p>}
    <Range field="materialIntensity" label="Finish mix" min={0} max={1} />
    <Range field="surfaceRoughness" label="Roughness adjustment" min={-1} max={1} />
    {(material !== 'transmission' || (frame?.natoms ?? 0) > MAX_TRANSMISSION_ATOMS) && <Range field="surfacePolish" label="Polish adjustment" min={-1} max={1} />}
    <Range field="surfaceClearcoat" label="Clear coat" min={0} max={1} />
    <Select field="atomTexture" label="Surface texture" choices={options('none', 'scratched', 'noise')} />
    <Range field="atomScale" label="Atom size" min={.3} max={2} />
    <h3>Color with intent</h3>
    <label className="scene-mod-select"><span>Color by</span><select aria-label="Color by" value={scheme} onChange={e => {
      const next = e.target.value as AppState['colorScheme'];
      if (next === 'property') useStore.getState().setColorProperty(property && properties.includes(property) ? property : properties[0]);
      useStore.getState().setColorScheme(next);
    }}>
      {SCHEME_ORDER.map(id => <option key={id} value={id} disabled={(id === 'element' && !identified) || (id === 'property' && !properties.length)}>{COLOR_SCHEMES[id].label}</option>)}
    </select></label>
    {!identified && <p className="scene-controls__hint">Element colors need identified elements. Type colors remain available.</p>}
    {!properties.length && <p className="scene-controls__hint">No scalar properties are loaded; property coloring is unavailable.</p>}
    {(scheme === 'colorway' || scheme === 'property') && <Select field="colormap" label="Color palette" choices={options('viridis', 'plasma', 'inferno', 'coolwarm', 'turbo', 'neon', 'cyberpunk', 'grayscale')} />}
    {scheme === 'uniform' && <Color field="uniformAtomColor" label="Atom color" />}
    {scheme === 'property' && <>
      <label className="scene-mod-select"><span>Loaded property</span><select aria-label="Loaded property" value={property ?? ''} onChange={e => useStore.getState().setColorProperty(e.target.value)}>
        {properties.map(name => <option key={name}>{name}</option>)}
      </select></label>
      {material !== 'transmission' && <Range field="propertyEmissionStrength" label="Property emission" min={0} max={1} />}
    </>}
    {scheme === 'element' && identified && <details className="scene-mod-details"><summary>Customize element colors</summary>
      {types.map(type => <label className="scene-mod-color" key={type}><span>{resolveTypeLabel(frame!, type)}</span><input type="color"
        aria-label={`${resolveTypeLabel(frame!, type)} color`} value={overrides[type] ?? resolveTypeColor(frame!, type)}
        onChange={e => useStore.getState().setElementColorOverride(type, e.target.value)} /></label>)}
      <button type="button" className="scene-controls__button" onClick={() => useStore.getState().resetElementColorOverrides()}>Reset element colors</button>
    </details>}
    {vectors.length > 0 && <details className="scene-mod-details"><summary>Data arrows</summary>
      <label className="scene-mod-select"><span>Loaded vector field</span><select aria-label="Loaded vector field" value={vectorField ?? ''}
        onChange={e => useStore.getState().setVectorField(e.target.value || null)}>
        <option value="">None</option>{vectors.map(spec => <option key={spec.id} value={spec.id}>{spec.label}</option>)}
      </select></label>
      {vectorField && <><Range field="vectorScale" label="Arrow length" min={.1} max={10} step={.1} />
        <Range field="vectorDensity" label="Arrow density" min={.01} max={1} /></>}
      <p className="scene-controls__hint">Arrows show loaded data, not a decorative force field.</p>
    </details>}
  </>;
}

function BackdropMods() {
  const preset = useStore(s => s.backgroundPreset);
  const shape = useStore(s => s.backgroundBackdropShape);
  const pattern = useStore(s => s.backgroundBackdropPattern);
  const paused = useStore(s => s.backgroundMotionPaused);
  const bg = BG_PRESETS[preset] ?? BG_PRESETS.deep;
  const media = getBgMedia(bg);
  const mesh = media.kind !== 'gradient' || shape !== 'dome' || pattern !== 'image';
  const groups = [...new Set(Object.values(BG_PRESETS).map(item => item.category ?? 'Gradients'))];
  return <>
    <label className="scene-mod-select"><span>Background library</span><select aria-label="Background library" value={preset}
      onChange={e => {
        useStore.getState().setBackgroundPreset(e.target.value);
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) useStore.getState().setBackgroundMotionPaused(true);
      }}>
      {groups.map(group => <optgroup key={group} label={group}>
        {Object.entries(BG_PRESETS).filter(([, item]) => (item.category ?? 'Gradients') === group).map(([id, item]) =>
          <option key={id} value={id}>{item.label}{getBgMedia(item).kind === 'video' ? ' · motion' : item.procedural ? ' · generative' : ''}</option>)}
      </optgroup>)}
    </select></label>
    <p className="scene-controls__hint">{media.kind === 'gradient' ? 'Generated on your device.' : 'Worlds and motion load media on selection and may use more data.'} Backdrops are decorative, not a physical environment.</p>
    {!bg.procedural && media.kind === 'gradient' && <Select field="backgroundStyle" label="Gradient shape" choices={options('radial', 'spotlight', 'linear')} />}
    {!bg.procedural && <>
    <Select field="backgroundBackdropShape" label="Backdrop projection" choices={options('dome', 'sphere', 'cube')} />
    <Select field="backgroundBackdropPattern" label="Backdrop pattern" choices={options('image', 'plain', 'grid')} />
    {mesh && shape !== 'dome' && <Range field="backgroundBackdropRadius" label="Backdrop size" min={.25} max={5} step={.05} />}
    <Range field="backgroundOpacity" label="Background visibility" min={.15} max={1} />
    <Range field="backgroundBrightness" label="Brightness" min={.35} max={1.8} />
    <Range field="backgroundSaturation" label="Saturation" min={0} max={2} />
    <Range field="backgroundContrast" label="Contrast" min={.5} max={1.8} />
    <Range field="backgroundYawDegrees" label="Background rotation" min={-180} max={180} step={5} />
    <Range field="backgroundPitchDegrees" label="Background tilt" min={-45} max={45} step={1} />
    </>}
    {(media.kind === 'video' || bg.procedural) && <>
      <SceneToggle label="Animate background" checked={!paused} onChange={value => useStore.getState().setBackgroundMotionPaused(!value)} />
      <Range field="backgroundMotionSpeed" label="Motion speed" min={.05} max={2} />
    </>}
  </>;
}

function LightMods() {
  return <>
    <Select field="environmentPreset" label="Reflection environment" choices={options('softbox', 'studio', 'city', 'dawn', 'night', 'warehouse', 'forest', 'park', 'none')} />
    <p className="scene-controls__hint">Softbox is generated locally. Other environments load an HDR light map.</p>
    <Range field="ambientLightIntensity" label="Ambient light" min={0} max={4} />
    <h3>Key light</h3>
    <Range field="dirLightIntensity" label="Key intensity" min={0} max={4} />
    <Range field="keyLightAzimuth" label="Light direction" min={-180} max={180} step={5} />
    <Range field="keyLightElevation" label="Key elevation" min={5} max={89} step={1} />
    <h3>Fill light</h3>
    <Color field="fillLightColor" label="Fill color" />
    <Range field="fillLightAzimuth" label="Fill direction" min={-180} max={180} step={5} />
    <Range field="fillLightElevation" label="Fill elevation" min={-89} max={89} step={1} />
    <h3>Rim light</h3>
    <Range field="rimLightIntensity" label="Rim intensity" min={0} max={2} />
    <Color field="rimLightColor" label="Rim color" />
    <Range field="rimLightAzimuth" label="Rim direction" min={-180} max={180} step={5} />
    <Range field="rimLightElevation" label="Rim elevation" min={-89} max={89} step={1} />
  </>;
}

function SphereMods() {
  const shape = useStore(s => s.filterShellShape);
  return <>
    <p className="scene-controls__hint">A soft, view-responsive halo around your model. This is a visual frame—not an electron cloud or a simulation boundary.</p>
    <Select field="filterShellShape" label="Atmosphere shape" choices={[['off', 'None'], ['sphere', 'Iridescent sphere'], ['cube', 'Framed cube']]} />
    {shape !== 'off' && <>
      <Select field="filterShellPreset" label="Atmosphere palette" choices={options('prism', 'cryo', 'haze', 'graphite')} />
      <Range field="filterShellOpacity" label="Atmosphere visibility" min={0} max={.65} step={.01} />
      <Range field="filterShellRadius" label="Atmosphere size" min={.75} max={4} step={.01} />
      <p className="scene-controls__hint">Recenter fits the whole atmosphere. Pinch to compose it your way.</p>
    </>}
  </>;
}

function EffectMods() {
  const id = useStore(s => s.postprocessPreset);
  const overrides = useStore(s => s.effectOverrides);
  const full = useStore(s => s.fullSceneEffects);
  const deviceTier = useMemo(getDeviceTier, []);
  const limited = !full && (deviceTier === 'mobile' || deviceTier === 'low');
  const active = resolveEffects(id, overrides);
  const update = (patch: Partial<EffectOverrides>) => useStore.setState({ effectOverrides: { ...(overrides?.preset === id ? overrides : {}), preset: id, ...patch } });
  const slider = (key: 'shadowStrength' | 'glowStrength' | 'focusDistance' | 'vignetteStrength', label: string, value: number, max: number) =>
    <label className="scene-controls__range"><span>{label}<output>{Number(value.toFixed(2))}</output></span><input aria-label={label} type="range" min={0} max={Math.max(max, value)} step={key === 'focusDistance' ? 1 : .05}
      value={value} onChange={e => update({ [key]: Number(e.target.value) })} /></label>;
  return <>
    <label className="scene-mod-select"><span>Effect recipe</span><select aria-label="Effect recipe" value={id}
      onChange={e => useStore.getState().setPostprocessPreset(e.target.value as AppState['postprocessPreset'])}>
      {PRESET_ORDER.map(key => <option key={key} value={key}>{POSTPROCESS_PRESETS[key].label}</option>)}
    </select></label>
    <Range field="postprocessIntensity" label="Overall effect strength" min={0} max={2} />
    {(deviceTier === 'mobile' || deviceTier === 'low') && <SceneToggle label="Full effects on this device" checked={full} onChange={fullSceneEffects => useStore.setState({ fullSceneEffects })} />}
    <p className="scene-controls__hint" role="status">{limited ? 'Battery-friendly mode: shadows, glow, and focus are paused. Enable full effects to preview them. Saved settings are preserved.' : 'Effects are live. Glow, shadows, and focus can use more GPU power.'}</p>
    <fieldset className="scene-mod-fieldset" disabled={limited}>
      <legend>Depth & glow</legend>
      <SceneToggle label="Contact shadows" checked={active.ssao.enabled} onChange={shadows => update({ shadows, shadowStrength: active.ssao.intensity || 1 })} />
      {active.ssao.enabled && slider('shadowStrength', 'Shadow strength', active.ssao.intensity, 4)}
      <SceneToggle label="Glow" checked={active.bloom.enabled} onChange={glow => update({ glow, glowStrength: active.bloom.intensity || .4 })} />
      {active.bloom.enabled && slider('glowStrength', 'Glow strength', active.bloom.intensity, 4)}
      <SceneToggle label="Depth of field" checked={active.dof.enabled} onChange={focus => update({ focus, autofocus: true })} />
      {active.dof.enabled && <>
        <SceneToggle label="Focus on molecule" checked={active.dof.auto} onChange={autofocus => update({ autofocus })} />
        {!active.dof.auto && slider('focusDistance', 'Focus distance', active.dof.focusDistance, 200)}
      </>}
    </fieldset>
    <SceneToggle label="Vignette" checked={active.vignette.enabled} onChange={vignette => update({ vignette })} />
    {active.vignette.enabled && slider('vignetteStrength', 'Vignette strength', active.vignette.darkness, 1)}
    <label className="scene-mod-select"><span>Tone mapping</span><select aria-label="Tone mapping" value={active.toneMapping}
      onChange={e => update({ toneMapping: e.target.value as EffectOverrides['toneMapping'] })}>
      <option value="aces">Filmic (ACES)</option><option value="reinhard">Soft (Reinhard)</option><option value="none">None</option>
    </select></label>
    <button className="scene-controls__button" type="button" onClick={() => useStore.setState({ effectOverrides: null })}>Reset effect recipe</button>
  </>;
}

export function SceneModControls({ section }: { section: ModSection }) {
  return <div className="scene-mod-fields" role="region" aria-label={`${section} visual settings`}>
    {section === 'Atoms' ? <AtomMods /> : section === 'Backdrop' ? <BackdropMods /> : section === 'Light' ? <LightMods /> : section === 'Sphere' ? <SphereMods /> : <EffectMods />}
  </div>;
}

export function StructureGuideMods() {
  const file = useStore(s => s.file);
  const index = useStore(s => s.frame);
  const frame = file?.trajectory.frames[index] ?? file?.trajectory.frames[0];
  const showBonds = useStore(s => s.showBonds);
  const showAxes = useStore(s => s.showAxes);
  const showCell = useStore(s => s.showCell);
  const sourceBonds = !!frame?.bonds.length;
  const inference = !!frame && canInferCovalentBonds(frame);
  const available = sourceBonds || inference;
  return <details className="scene-mod-details"><summary>Structure guides</summary>
    <SceneToggle label="Bond guides" checked={showBonds} disabled={!available && !showBonds} onChange={() => useStore.getState().toggleBonds()} />
    <p className="scene-controls__hint">{sourceBonds ? 'Source bond pairs are preserved.' : inference
      ? 'Connections are inferred from distance; they do not specify bond order.'
      : 'Bond guides need source pairs, or identified elements with known distance units.'}</p>
    {showBonds && available && <>
      <Select field="bondColorMode" label="Bond color" choices={[[ 'type', 'By atom type' ], [ 'length', 'By length' ]]} />
      {!sourceBonds && inference && <Range field="bondTolerance" label="Bond sensitivity" min={0} max={1.2} step={.02} />}
    </>}
    <SceneToggle label="Coordinate axes" checked={showAxes} onChange={() => useStore.getState().toggleAxes()} />
    <SceneToggle label="Cell / bounding box" checked={showCell} onChange={() => useStore.getState().toggleCell()} />
  </details>;
}
