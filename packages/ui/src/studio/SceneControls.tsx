/**
 * SceneControls — the Scene tab body: the space around the molecule (world
 * backdrop, presence/brightness, lighting direction, framing guides, motion
 * loop) with the finicky controls behind an Advanced disclosure. Owns its own
 * store wiring; the deck shell just mounts it.
 */
import { useMemo } from 'react';
import { useStore, type BackgroundBackdropPattern, type BackgroundBackdropShape, type FilterShellPreset, type FilterShellShape } from '../store';
import {
  BG_PRESETS,
  BG_GRADIENT_PRESETS,
  BG_TEXTURE_CATEGORIES,
  BG_VIDEO_PRESETS,
  type BgPresetWithId,
} from '../backgroundPresets';
import {
  AdvancedSection,
  ControlGroup,
  SegmentButton,
  CompactSlider,
  RiveKnob,
  schemeHintStyle,
} from './primitives';
import { WorldBackdropBrowser } from './WorldBackdropBrowser';

const FILTER_SHELL_SHAPES: Array<{ id: FilterShellShape; label: string; code: string; accent: string }> = [
  { id: 'off', label: 'Off', code: 'OFF', accent: '#64748b' },
  { id: 'sphere', label: 'Sphere', code: 'SPH', accent: '#7de9ff' },
  { id: 'cube', label: 'Cube', code: 'CUB', accent: '#f59e0b' },
];

const BACKDROP_SHAPES: Array<{ id: BackgroundBackdropShape; label: string; code: string; accent: string }> = [
  { id: 'dome', label: 'Dome', code: 'SKY', accent: '#1edce0' },
  { id: 'sphere', label: 'Sphere', code: 'SPH', accent: '#7de9ff' },
  { id: 'cube', label: 'Cube', code: 'CUB', accent: '#f59e0b' },
];

const BACKDROP_PATTERNS: Array<{ id: BackgroundBackdropPattern; label: string; code: string; accent: string }> = [
  { id: 'image', label: 'Image', code: 'IMG', accent: '#c084fc' },
  { id: 'plain', label: 'Plain', code: 'PLN', accent: '#e5e7eb' },
  { id: 'grid', label: 'Grid', code: 'GRD', accent: '#34d399' },
];

const FILTER_SHELL_PRESETS: Array<{ id: FilterShellPreset; label: string; code: string; accent: string }> = [
  { id: 'haze', label: 'Haze', code: 'HAZ', accent: '#d9f7ff' },
  { id: 'cryo', label: 'Cryo', code: 'CRY', accent: '#84c9ff' },
  { id: 'prism', label: 'Prism', code: 'PRI', accent: '#ff7ab6' },
  { id: 'graphite', label: 'Graphite', code: 'GRF', accent: '#d1d5db' },
];

function categoryPresets(label: string): BgPresetWithId[] {
  return BG_TEXTURE_CATEGORIES.find(category => category.label === label)?.presets ?? [];
}

export function SceneControls() {
  const backgroundPreset = useStore(s => s.backgroundPreset);
  const setBackgroundPreset = useStore(s => s.setBackgroundPreset);
  const backgroundMotionPaused = useStore(s => s.backgroundMotionPaused);
  const setBackgroundMotionPaused = useStore(s => s.setBackgroundMotionPaused);
  const backgroundMotionSpeed = useStore(s => s.backgroundMotionSpeed);
  const setBackgroundMotionSpeed = useStore(s => s.setBackgroundMotionSpeed);
  const backgroundOpacity = useStore(s => s.backgroundOpacity);
  const setBackgroundOpacity = useStore(s => s.setBackgroundOpacity);
  const backgroundBrightness = useStore(s => s.backgroundBrightness);
  const setBackgroundBrightness = useStore(s => s.setBackgroundBrightness);
  const backgroundSaturation = useStore(s => s.backgroundSaturation);
  const setBackgroundSaturation = useStore(s => s.setBackgroundSaturation);
  const backgroundContrast = useStore(s => s.backgroundContrast);
  const setBackgroundContrast = useStore(s => s.setBackgroundContrast);
  const backgroundYawDegrees = useStore(s => s.backgroundYawDegrees);
  const setBackgroundYawDegrees = useStore(s => s.setBackgroundYawDegrees);
  const backgroundPitchDegrees = useStore(s => s.backgroundPitchDegrees);
  const setBackgroundPitchDegrees = useStore(s => s.setBackgroundPitchDegrees);
  const backgroundBackdropShape = useStore(s => s.backgroundBackdropShape);
  const setBackgroundBackdropShape = useStore(s => s.setBackgroundBackdropShape);
  const backgroundBackdropPattern = useStore(s => s.backgroundBackdropPattern);
  const setBackgroundBackdropPattern = useStore(s => s.setBackgroundBackdropPattern);
  const resetBackgroundAdjustments = useStore(s => s.resetBackgroundAdjustments);
  const filterShellShape = useStore(s => s.filterShellShape);
  const setFilterShellShape = useStore(s => s.setFilterShellShape);
  const filterShellPreset = useStore(s => s.filterShellPreset);
  const setFilterShellPreset = useStore(s => s.setFilterShellPreset);
  const filterShellOpacity = useStore(s => s.filterShellOpacity);
  const setFilterShellOpacity = useStore(s => s.setFilterShellOpacity);
  const filterShellRadius = useStore(s => s.filterShellRadius);
  const setFilterShellRadius = useStore(s => s.setFilterShellRadius);
  const showAxes = useStore(s => s.showAxes);
  const toggleAxes = useStore(s => s.toggleAxes);
  const showCell = useStore(s => s.showCell);
  const toggleCell = useStore(s => s.toggleCell);
  // Lighting controls — the key light's azimuth/elevation drive its world
  // position live in SceneLighting, so spinning these knobs moves the light
  // around the molecule in real time.
  const ambientLightIntensity = useStore(s => s.ambientLightIntensity);
  const dirLightIntensity = useStore(s => s.dirLightIntensity);
  const setAmbientLightIntensity = useStore(s => s.setAmbientLightIntensity);
  const setDirLightIntensity = useStore(s => s.setDirLightIntensity);
  const keyLightAzimuth = useStore(s => s.keyLightAzimuth);
  const setKeyLightAzimuth = useStore(s => s.setKeyLightAzimuth);
  const keyLightElevation = useStore(s => s.keyLightElevation);
  const setKeyLightElevation = useStore(s => s.setKeyLightElevation);

  const mathPresets = useMemo(() => categoryPresets('Mathematical Fields'), []);
  const worldPresets = useMemo(() => categoryPresets('360 Worlds'), []);
  const publicationPresets = useMemo(() => categoryPresets('Publication Contexts'), []);
  const signaturePresets = useMemo(() => categoryPresets('Signature Stills'), []);
  const gradientPresets = useMemo(
    () => BG_GRADIENT_PRESETS.filter(preset => ['white', 'deep', 'void', 'fog', 'blueprint', 'warm'].includes(preset.id)),
    [],
  );
  const worldLibraryGroups = useMemo(() => [
    { label: '360 Worlds', presets: worldPresets },
    { label: 'Motion Loops', presets: BG_VIDEO_PRESETS },
    { label: 'Publication', presets: publicationPresets },
    { label: 'Math Fields', presets: mathPresets },
    { label: 'Signature', presets: signaturePresets },
    { label: 'Base', presets: gradientPresets },
  ], [gradientPresets, mathPresets, publicationPresets, signaturePresets, worldPresets]);
  const activeBackgroundPreset = BG_PRESETS[backgroundPreset];
  const activeBackgroundPresetWithId = activeBackgroundPreset ? { id: backgroundPreset, ...activeBackgroundPreset } : undefined;
  const activeBackgroundIsVideo = useMemo(
    () => BG_VIDEO_PRESETS.some(preset => preset.id === backgroundPreset),
    [backgroundPreset],
  );

  const handleRandomVideo = () => {
    if (BG_VIDEO_PRESETS.length === 0) return;
    const next = BG_VIDEO_PRESETS[Math.floor(Math.random() * BG_VIDEO_PRESETS.length)];
    setBackgroundPreset(next.id);
  };

  const handleRandomWorld = () => {
    if (worldPresets.length === 0) return;
    // Avoid re-picking the current world so the user always sees a different
    // background load. Fall back to the current one only if there's a single world.
    const candidates = worldPresets.length > 1
      ? worldPresets.filter(p => p.id !== backgroundPreset)
      : worldPresets;
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    setBackgroundPreset(next.id);
  };

  return (
    <div className="lupi-deck-grid">
      {/* Easy path: pick a world, set how present it is, toggle framing
          guides, control any motion loop. Everything finicky lives under
          "Advanced" below so the common path stays clear. */}
      <ControlGroup title="World" wide>
        <p style={schemeHintStyle}>The space around your molecule — backdrop, lighting, and framing.</p>
        <WorldBackdropBrowser
          value={backgroundPreset}
          activePreset={activeBackgroundPresetWithId}
          groups={worldLibraryGroups}
          onChange={setBackgroundPreset}
          onRandomWorld={handleRandomWorld}
          onRandomLoop={handleRandomVideo}
        />
      </ControlGroup>

      <ControlGroup title="Adjust">
        <CompactSlider
          label="Presence"
          value={backgroundOpacity}
          min={0.15}
          max={1}
          step={0.01}
          onChange={setBackgroundOpacity}
          format={value => `${Math.round(value * 100)}%`}
        />
        <CompactSlider
          label="Brightness"
          value={backgroundBrightness}
          min={0.35}
          max={1.8}
          step={0.01}
          onChange={setBackgroundBrightness}
          format={value => value.toFixed(2)}
        />
        <SegmentButton label="Reset" active={false} accent="#94a3b8" onClick={resetBackgroundAdjustments} />
      </ControlGroup>

      <ControlGroup title="Lighting">
        <p style={schemeHintStyle}>Spin the dials to move the key light around the molecule.</p>
        <div className="lupi-studio-slider-grid">
          <RiveKnob label="Angle" value={keyLightAzimuth} min={-180} max={180} step={5} onChange={setKeyLightAzimuth} format={value => `${Math.round(value)}°`} />
          <RiveKnob label="Height" value={keyLightElevation} min={5} max={89} step={1} onChange={setKeyLightElevation} format={value => `${Math.round(value)}°`} />
        </div>
        <CompactSlider label="Key light" value={dirLightIntensity} min={0} max={4} step={0.1} onChange={setDirLightIntensity} format={value => value.toFixed(1)} />
        <CompactSlider label="Ambient" value={ambientLightIntensity} min={0} max={2} step={0.05} onChange={setAmbientLightIntensity} format={value => `${Math.round(value * 100)}%`} />
      </ControlGroup>

      <ControlGroup title="Guides">
        <div className="lupi-studio-segments">
          <SegmentButton label={showCell ? 'Cell on' : 'Cell off'} active={showCell} accent="#7de9ff" onClick={toggleCell} />
          <SegmentButton label={showAxes ? 'Axes on' : 'Axes off'} active={showAxes} accent="#a7f3d0" onClick={toggleAxes} />
        </div>
      </ControlGroup>

      {activeBackgroundIsVideo && (
        <ControlGroup title="Motion loop">
          <div className="lupi-studio-segments">
            <SegmentButton
              label={backgroundMotionPaused ? 'Play' : 'Pause'}
              active={!backgroundMotionPaused}
              accent="#1edce0"
              onClick={() => setBackgroundMotionPaused(!backgroundMotionPaused)}
            />
            <SegmentButton label="Shuffle" active={false} accent="#f59e0b" onClick={handleRandomVideo} />
          </div>
          <CompactSlider
            label="Speed"
            value={backgroundMotionSpeed}
            min={0.05}
            max={2}
            step={0.05}
            onChange={setBackgroundMotionSpeed}
            format={value => `${value.toFixed(2)}x`}
          />
        </ControlGroup>
      )}

      <AdvancedSection title="Advanced scene">
        <ControlGroup title="Backdrop geometry">
          <div className="lupi-studio-segments">
            {BACKDROP_SHAPES.map(option => (
              <SegmentButton
                key={option.id}
                label={option.label}
                meta={option.code}
                active={backgroundBackdropShape === option.id}
                accent={option.accent}
                onClick={() => setBackgroundBackdropShape(option.id)}
              />
            ))}
          </div>
          <div className="lupi-studio-segments">
            {BACKDROP_PATTERNS.map(option => (
              <SegmentButton
                key={option.id}
                label={option.label}
                meta={option.code}
                active={backgroundBackdropPattern === option.id}
                accent={option.accent}
                onClick={() => setBackgroundBackdropPattern(option.id)}
              />
            ))}
          </div>
        </ControlGroup>

        <ControlGroup title="Orientation & grade">
          <CompactSlider label="Yaw" value={backgroundYawDegrees} min={-180} max={180} step={1} onChange={setBackgroundYawDegrees} format={value => `${Math.round(value)} deg`} />
          <CompactSlider label="Pitch" value={backgroundPitchDegrees} min={-45} max={45} step={1} onChange={setBackgroundPitchDegrees} format={value => `${Math.round(value)} deg`} />
          <CompactSlider label="Saturate" value={backgroundSaturation} min={0} max={2} step={0.01} onChange={setBackgroundSaturation} format={value => value.toFixed(2)} />
          <CompactSlider label="Contrast" value={backgroundContrast} min={0.5} max={1.8} step={0.01} onChange={setBackgroundContrast} format={value => value.toFixed(2)} />
        </ControlGroup>

        <ControlGroup title="Filter shell">
          <div className="lupi-studio-segments">
            {FILTER_SHELL_SHAPES.map(option => (
              <SegmentButton
                key={option.id}
                label={option.label}
                meta={option.code}
                active={filterShellShape === option.id}
                accent={option.accent}
                onClick={() => setFilterShellShape(option.id)}
              />
            ))}
          </div>
          <div className="lupi-studio-segments">
            {FILTER_SHELL_PRESETS.map(option => (
              <SegmentButton
                key={option.id}
                label={option.label}
                meta={option.code}
                active={filterShellPreset === option.id}
                accent={option.accent}
                onClick={() => setFilterShellPreset(option.id)}
              />
            ))}
          </div>
          <div className="lupi-studio-slider-grid">
            <RiveKnob label="Tint" value={filterShellOpacity} min={0} max={0.65} step={0.01} onChange={setFilterShellOpacity} format={value => `${Math.round(value * 100)}%`} />
            <RiveKnob label="Size" value={filterShellRadius} min={0.75} max={4} step={0.05} onChange={setFilterShellRadius} format={value => `${value.toFixed(2)}×`} />
          </div>
        </ControlGroup>
      </AdvancedSection>
    </div>
  );
}
