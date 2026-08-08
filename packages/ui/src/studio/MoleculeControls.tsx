/**
 * MoleculeControls — the Molecule tab body: how the molecule itself looks
 * (grade, color, material recipe, bonds). Owns its own store wiring; the deck
 * shell just mounts it.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  canInferCovalentBonds,
  detectVectorFields,
  hasCompleteElementMapping,
  resolveTypeColor,
  resolveTypeLabel,
} from '@atlas/core';
import type { ColormapName } from '@atlas/core/types';
import { MATERIAL_SCENES, type MaterialScene } from '@atlas/scene/materials';
import { COLOR_SCHEMES, SCHEME_ORDER, type ColorSchemeId } from '../coloring';
import { POSTPROCESS_PRESETS } from '../postprocess/presets';
import { useStore } from '../store';
import {
  AdvancedSection,
  ControlGroup,
  SegmentButton,
  CompactSlider,
  CompactSelect,
  ColorPicker,
  ElementColorPicker,
  SwatchButton,
  paletteRailStyle,
  schemeHintStyle,
} from './primitives';

type ModelPresetId = 'balanced' | 'bonds' | 'space' | 'property';

const MODEL_PRESET_COPY: Record<ModelPresetId, { label: string; description: string; accent: string }> = {
  balanced: {
    label: 'Balanced',
    description: 'A clear default for exploring structure.',
    accent: '#1edce0',
  },
  bonds: {
    label: 'Bonds',
    description: 'Show distance-inferred connections between nearby atoms.',
    accent: '#7de9ff',
  },
  space: {
    label: 'Space-fill',
    description: 'Emphasize atomic volume and packing.',
    accent: '#f59e0b',
  },
  property: {
    label: 'Property',
    description: 'Color atoms using per-atom data.',
    accent: '#c084fc',
  },
};

const COLOR_LABELS: Record<ColorSchemeId, string> = {
  element: 'Element colors',
  colorway: 'Palette',
  property: 'Color by data',
  uniform: 'One color',
};

// Ordered flat → dramatic so the row reads as a spectrum: Diagram (no
// effects) on the left, Cinematic (full depth-of-field + bloom) on the right.
// The selected look's plain-language description shows below the row, so a
// grade is never a mystery.
const LOOK_OPTIONS = [
  { id: 'diagram', label: 'Schematic', accent: '#a7f3d0' },
  { id: 'paper', label: 'Journal', accent: '#e5e7eb' },
  { id: 'studio', label: 'Balanced', accent: '#1edce0' },
  { id: 'editorial', label: 'Presentation', accent: '#38bdf8' },
  { id: 'cinematic', label: 'Cinematic', accent: '#f59e0b' },
] as const;

const PALETTE_OPTIONS: Array<{ id: ColormapName; label: string; accent: string }> = [
  { id: 'viridis', label: 'Viridis', accent: '#35d07f' },
  { id: 'plasma', label: 'Plasma', accent: '#f97316' },
  { id: 'inferno', label: 'Inferno', accent: '#fb7185' },
  { id: 'coolwarm', label: 'Coolwarm', accent: '#60a5fa' },
  { id: 'turbo', label: 'Turbo', accent: '#facc15' },
  { id: 'neon', label: 'Neon', accent: '#22d3ee' },
  { id: 'cyberpunk', label: 'Cyber', accent: '#e879f9' },
  { id: 'grayscale', label: 'Gray', accent: '#cbd5e1' },
];

// Per-scheme accent for the scheme picker chips. One map instead of an inline
// ternary so adding a scheme is a one-line change.
const SCHEME_ACCENTS: Record<ColorSchemeId, string> = {
  element: '#1edce0',
  colorway: '#1edce0',
  property: '#1edce0',
  uniform: '#f59e0b',
};

const COLORMAP_PREVIEWS: Partial<Record<ColormapName, string>> = {
  viridis: 'linear-gradient(90deg, #440154, #21918c, #fde725)',
  plasma: 'linear-gradient(90deg, #0d0887, #cc4778, #f0f921)',
  inferno: 'linear-gradient(90deg, #000004, #bc3754, #fcffa4)',
  coolwarm: 'linear-gradient(90deg, #3b4cc0, #f7f7f7, #b40426)',
  turbo: 'linear-gradient(90deg, #30123b, #1ae4b6, #faba39, #7a0403)',
  neon: 'linear-gradient(90deg, #00f5ff, #ff00f5, #faff00)',
  cyberpunk: 'linear-gradient(90deg, #00e5ff, #7c3aed, #ff3b8d)',
  grayscale: 'linear-gradient(90deg, #111827, #94a3b8, #f8fafc)',
};

const FEATURED_SCENE_IDS = [
  'laboratory',
  'specimen',
  'blueprint',
  'forge',
  'crystallography',
  'prism',
  'deep_space',
  'holograph',
  'subsurface',
];

export function MoleculeControls() {
  const postprocessPreset = useStore(s => s.postprocessPreset);
  const setPostprocessPreset = useStore(s => s.setPostprocessPreset);
  const postprocessIntensity = useStore(s => s.postprocessIntensity);
  const setPostprocessIntensity = useStore(s => s.setPostprocessIntensity);
  const colorScheme = useStore(s => s.colorScheme);
  const setColorScheme = useStore(s => s.setColorScheme);
  const colorProperty = useStore(s => s.colorProperty);
  const setColorProperty = useStore(s => s.setColorProperty);
  const colormap = useStore(s => s.colormap);
  const setColormap = useStore(s => s.setColormap);
  const uniformAtomColor = useStore(s => s.uniformAtomColor);
  const setUniformAtomColor = useStore(s => s.setUniformAtomColor);
  const elementColorOverrides = useStore(s => s.elementColorOverrides);
  const setElementColorOverride = useStore(s => s.setElementColorOverride);
  const resetElementColorOverride = useStore(s => s.resetElementColorOverride);

  const materialScene = useStore(s => s.materialScene);
  const setMaterialScene = useStore(s => s.setMaterialScene);
  const setMaterialPreset = useStore(s => s.setMaterialPreset);
  const setEnvironmentPreset = useStore(s => s.setEnvironmentPreset);
  const setAmbientLightIntensity = useStore(s => s.setAmbientLightIntensity);
  const setDirLightIntensity = useStore(s => s.setDirLightIntensity);
  const setRimLightIntensity = useStore(s => s.setRimLightIntensity);
  const setAtomTexture = useStore(s => s.setAtomTexture);
  const atomScale = useStore(s => s.atomScale);
  const setAtomScale = useStore(s => s.setAtomScale);
  // setMaterialIntensity is still applied by recipes; the standalone Mix/Rough/
  // Polish/Coat sliders were retired in favor of recipe presets.
  const setMaterialIntensity = useStore(s => s.setMaterialIntensity);
  const showBonds = useStore(s => s.showBonds);
  const toggleBonds = useStore(s => s.toggleBonds);
  const bondTolerance = useStore(s => s.bondTolerance);
  const setBondTolerance = useStore(s => s.setBondTolerance);
  const bondColorMode = useStore(s => s.bondColorMode);
  const setBondColorMode = useStore(s => s.setBondColorMode);
  const file = useStore(s => s.file);
  const frame = useStore(s => s.frame);
  const [selectedType, setSelectedType] = useState<number | null>(null);
  const [focusedPreset, setFocusedPreset] = useState<ModelPresetId | null>(null);

  const materialScenes = useMemo(
    () => MATERIAL_SCENES.filter(scene => FEATURED_SCENE_IDS.includes(scene.id)),
    [],
  );
  const vectorField = useStore(s => s.vectorField);
  const setVectorField = useStore(s => s.setVectorField);
  const vectorScale = useStore(s => s.vectorScale);
  const setVectorScale = useStore(s => s.setVectorScale);
  const vectorDensity = useStore(s => s.vectorDensity);
  const setVectorDensity = useStore(s => s.setVectorDensity);

  // Streamed trajectories keep placeholder (undefined) frames until fetched —
  // fall back to frame 0 (always resident) so the controls don't flicker away
  // mid-scrub. Column sets don't change frame to frame in practice.
  const residentFrame = useMemo(
    () => file?.trajectory.frames[frame] ?? file?.trajectory.frames[0],
    [file, frame],
  );
  const vectorSpecs = useMemo(() => {
    const props = residentFrame?.properties;
    return props ? detectVectorFields(props.keys()) : [];
  }, [residentFrame]);
  const availableProperties = useMemo(() => {
    const props = residentFrame?.properties;
    const names = props ? Array.from(props.keys()) : [];
    // Derived vector magnitudes (|F|, |v|, ...) color like any scalar —
    // App ensures the arrays exist on demand when one is selected.
    for (const spec of vectorSpecs) {
      if (!names.includes(spec.magnitudeProperty)) names.push(spec.magnitudeProperty);
    }
    return names;
  }, [residentFrame, vectorSpecs]);
  const atomCount = residentFrame?.natoms ?? 0;
  const hasElementIdentity = residentFrame ? hasCompleteElementMapping(residentFrame) : false;
  const hasSourceBonds = Boolean(residentFrame?.bonds && residentFrame.bonds.length > 0);
  const canInferBonds = residentFrame ? canInferCovalentBonds(residentFrame) : false;
  const bondsAreSafe = atomCount > 0
    && atomCount < 25_000
    && (hasSourceBonds || canInferBonds);
  const requiresDiagram = atomCount >= 200_000;
  const validColorProperty = colorProperty && availableProperties.includes(colorProperty)
    ? colorProperty
    : (availableProperties[0] ?? null);
  const presentTypes = useMemo(() => {
    const types = residentFrame?.types;
    if (!types || !residentFrame) return [];
    const rawTypes = new Set<number>();
    for (let i = 0; i < residentFrame.natoms; i++) rawTypes.add(types[i]);
    return Array.from(rawTypes)
      .sort((a, b) => a - b)
      .map(rawType => ({
        rawType,
        label: resolveTypeLabel(residentFrame, rawType),
        color: resolveTypeColor(residentFrame, rawType),
      }));
  }, [residentFrame]);
  const activeType = presentTypes.find(type => type.rawType === selectedType) ?? presentTypes[0] ?? null;
  const activeTypeColor = activeType
    ? elementColorOverrides[activeType.rawType] ?? activeType.color
    : uniformAtomColor;
  const activeTypeHasOverride = activeType
    ? Boolean(elementColorOverrides[activeType.rawType])
    : false;
  useEffect(() => {
    if (presentTypes.length === 0) {
      if (selectedType !== null) setSelectedType(null);
      return;
    }
    if (!presentTypes.some(type => type.rawType === selectedType)) {
      setSelectedType(presentTypes[0].rawType);
    }
  }, [presentTypes, selectedType]);

  const applyMoleculeRecipe = (scene: MaterialScene) => {
    setMaterialScene(scene.id);
    setMaterialPreset(scene.materialPreset);
    setMaterialIntensity(scene.materialIntensity);
    setEnvironmentPreset(scene.environmentPreset);
    setAmbientLightIntensity(scene.ambientIntensity);
    setDirLightIntensity(scene.dirLightIntensity);
    setRimLightIntensity(scene.rimLightIntensity);
    setAtomTexture(scene.atomTexture);
  };

  const applyColorScheme = (scheme: ColorSchemeId) => {
    if (scheme === 'element' && !hasElementIdentity) return;
    if (scheme === 'property') {
      if (!validColorProperty) return;
      setColorProperty(validColorProperty);
    }
    setColorScheme(scheme);
  };

  const applyUniformAtomColor = (color: string) => {
    setUniformAtomColor(color);
    setColorScheme('uniform');
  };

  const applyElementColor = (rawType: number, color: string) => {
    setElementColorOverride(rawType, color);
    setColorScheme('element');
  };

  const applyColormap = (map: ColormapName) => {
    setColormap(map);
    if (colorScheme !== 'property') {
      setColorScheme('colorway');
    }
  };

  const activeRecipe = materialScenes.find(scene => scene.id === materialScene);

  const setBondsVisible = (visible: boolean) => {
    if (showBonds !== visible) toggleBonds();
  };

  const safePreset = (preferred: 'studio' | 'paper') => requiresDiagram ? 'diagram' : preferred;
  const balancedPreset = safePreset(atomCount >= 25_000 ? 'paper' : 'studio');
  const balancedIntensity = atomCount >= 25_000 && !requiresDiagram ? 0.85 : 1;
  const balancedAtomScale = requiresDiagram ? 0.72 : 1;
  const identityColorScheme: ColorSchemeId = hasElementIdentity ? 'element' : 'colorway';

  const applyModelPreset = (view: ModelPresetId) => {
    // Presets intentionally touch only the structure presentation. They
    // never change the selected background, environment, or lighting setup.
    setVectorField(null);

    if (view === 'balanced') {
      setPostprocessPreset(balancedPreset);
      setPostprocessIntensity(balancedIntensity);
      setColorScheme(identityColorScheme);
      setAtomScale(balancedAtomScale);
      setBondsVisible(bondsAreSafe);
      return;
    }

    if (view === 'bonds') {
      if (!bondsAreSafe) return;
      setPostprocessPreset(safePreset('studio'));
      setPostprocessIntensity(1);
      setColorScheme(identityColorScheme);
      setAtomScale(0.72);
      setBondColorMode('type');
      setBondsVisible(true);
      return;
    }

    if (view === 'space') {
      if (requiresDiagram) return;
      setPostprocessPreset(safePreset('studio'));
      setPostprocessIntensity(1);
      setColorScheme(identityColorScheme);
      setAtomScale(1.35);
      setBondsVisible(false);
      return;
    }

    if (!validColorProperty) return;
    setPostprocessPreset(safePreset('paper'));
    setPostprocessIntensity(requiresDiagram ? 1 : 0.9);
    setColorProperty(validColorProperty);
    setColorScheme('property');
    setColormap('viridis');
    setAtomScale(0.9);
    setBondsVisible(false);
  };

  const activeModelPreset: ModelPresetId | null = (() => {
    if (
      postprocessPreset === balancedPreset
      && postprocessIntensity === balancedIntensity
      && colorScheme === identityColorScheme
      && atomScale === balancedAtomScale
      && showBonds === bondsAreSafe
      && vectorField === null
    ) return 'balanced';
    if (
      bondsAreSafe
      && postprocessPreset === safePreset('studio')
      && postprocessIntensity === 1
      && colorScheme === identityColorScheme
      && atomScale === 0.72
      && showBonds
      && bondColorMode === 'type'
      && vectorField === null
    ) return 'bonds';
    if (
      postprocessPreset === safePreset('studio')
      && postprocessIntensity === 1
      && colorScheme === identityColorScheme
      && atomScale === 1.35
      && !showBonds
      && vectorField === null
    ) return 'space';
    if (
      validColorProperty
      && postprocessPreset === safePreset('paper')
      && postprocessIntensity === (requiresDiagram ? 1 : 0.9)
      && colorScheme === 'property'
      && colorProperty === validColorProperty
      && colormap === 'viridis'
      && atomScale === 0.9
      && !showBonds
      && vectorField === null
    ) return 'property';
    return null;
  })();

  const modelPresetUnavailableReason = (view: ModelPresetId): string | null => {
    if (view === 'bonds' && !bondsAreSafe) {
      return atomCount >= 25_000
        ? `Bonds are unavailable above 25,000 atoms for performance. Use Balanced or load a smaller structure; this one has ${atomCount.toLocaleString()} atoms.`
        : 'Bonds need source pairs or mapped elements with Ångström coordinates. Load a chemically mapped XYZ or LAMMPS source.';
    }
    if (view === 'space' && requiresDiagram) {
      return 'Space-fill is unavailable at 200,000 atoms and above to avoid overdraw. Use Balanced or load a smaller structure.';
    }
    if (view === 'property' && !validColorProperty) {
      return 'Property coloring needs per-atom data. Load a trajectory with charge, energy, force magnitude, or another scalar field.';
    }
    return null;
  };

  const focusedPresetMessage = focusedPreset
    ? modelPresetUnavailableReason(focusedPreset) ?? MODEL_PRESET_COPY[focusedPreset].description
    : null;
  const focusedPresetUnavailable = focusedPreset
    ? Boolean(modelPresetUnavailableReason(focusedPreset))
    : false;

  return (
    <div className="lupi-deck-grid">
      <ControlGroup title="Presets" wide>
        <div
          role="group"
          aria-label="Model display presets"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 5 }}
        >
          {(Object.keys(MODEL_PRESET_COPY) as ModelPresetId[]).map(view => {
            const disabledReason = modelPresetUnavailableReason(view);
            return (
              <ModelPresetButton
                key={view}
                view={view}
                active={activeModelPreset === view}
                disabledReason={disabledReason ?? undefined}
                describedBy={focusedPreset === view && focusedPresetMessage ? 'model-preset-help' : undefined}
                onFocus={() => setFocusedPreset(view)}
                onBlur={() => setFocusedPreset(current => current === view ? null : current)}
                onClick={() => {
                  setFocusedPreset(view);
                  if (!disabledReason) applyModelPreset(view);
                }}
              />
            );
          })}
        </div>
        {focusedPresetMessage && (
          <p
            id="model-preset-help"
            style={{ ...schemeHintStyle, color: focusedPresetUnavailable ? '#fbbf24' : schemeHintStyle.color }}
          >
            {focusedPresetMessage}
          </p>
        )}
        {requiresDiagram && (
          <p role="status" style={schemeHintStyle}>
            Diagram rendering stays on for this {atomCount.toLocaleString()}-atom structure to keep interaction responsive.
          </p>
        )}
      </ControlGroup>

      {/* Color stays on the easy path because identifying elements or mapping
          measured values is a primary scientific task, not an expert tweak. */}
      <ControlGroup title="Color by" wide>
        <div className="lupi-studio-segments">
          {SCHEME_ORDER.filter(schemeId => schemeId !== 'element' || hasElementIdentity).map(schemeId => {
            const scheme = COLOR_SCHEMES[schemeId];
            return (
              <SegmentButton
                key={scheme.id}
                label={COLOR_LABELS[scheme.id]}
                active={colorScheme === scheme.id}
                accent={SCHEME_ACCENTS[scheme.id]}
                onClick={() => applyColorScheme(scheme.id)}
              />
            );
          })}
        </div>

        <p style={schemeHintStyle}>{COLOR_SCHEMES[colorScheme].tagline}</p>

        {colorScheme === 'uniform' && (
          <ColorPicker
            label="Uniform"
            value={uniformAtomColor}
            active
            onChange={applyUniformAtomColor}
          />
        )}

        {colorScheme === 'element' && hasElementIdentity && activeType && (
          <ElementColorPicker
            active={colorScheme === 'element' || activeTypeHasOverride}
            rawType={activeType.rawType}
            value={activeTypeColor}
            options={presentTypes.map(type => ({
              value: type.rawType,
              label: `${type.label} / source type ${type.rawType}`,
            }))}
            overridden={activeTypeHasOverride}
            onSelect={setSelectedType}
            onChange={(color) => applyElementColor(activeType.rawType, color)}
            onReset={() => {
              resetElementColorOverride(activeType.rawType);
              setColorScheme('element');
            }}
          />
        )}

        {colorScheme === 'property' && (
          availableProperties.length > 0 ? (
            <CompactSelect
              label="Property"
              value={validColorProperty ?? ''}
              onChange={(value) => {
                setColorProperty(value || null);
                if (value) setColorScheme('property');
              }}
              options={availableProperties.slice(0, 12).map(property => ({ value: property, label: property }))}
              placeholder="Property"
            />
          ) : (
            <p style={schemeHintStyle}>No per-atom data is available in this structure.</p>
          )
        )}

        {(colorScheme === 'colorway' || colorScheme === 'property') && (
          <div style={{ display: 'grid', gap: 5 }}>
            <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 820, textTransform: 'uppercase', lineHeight: 1 }}>
              Palette
            </span>
            <div style={paletteRailStyle}>
              {PALETTE_OPTIONS.map(option => (
                <SwatchButton
                  key={option.id}
                  label={option.label}
                  active={colormap === option.id}
                  background={COLORMAP_PREVIEWS[option.id] ?? option.accent}
                  onClick={() => applyColormap(option.id)}
                />
              ))}
            </div>
          </div>
        )}
      </ControlGroup>

      {/* Vectors are only offered when the loaded data actually contains a
          complete force, velocity, or other vector triplet. */}
      {vectorSpecs.length > 0 && (
        <ControlGroup title="Data arrows" wide>
          <div className="lupi-studio-segments">
            <SegmentButton
              label="Off"
              active={vectorField === null}
              accent="#94a3b8"
              onClick={() => setVectorField(null)}
            />
            {vectorSpecs.slice(0, 3).map(spec => (
              <SegmentButton
                key={spec.id}
                label={spec.label}
                active={vectorField === spec.id}
                accent={spec.kind === 'force' ? '#fb7185' : '#7de9ff'}
                onClick={() => setVectorField(spec.id)}
              />
            ))}
          </div>
          {vectorField !== null && (
            <>
              <CompactSlider label="Length" value={vectorScale} min={0.2} max={4} step={0.1} onChange={setVectorScale} format={value => `${value.toFixed(1)}×`} />
              <CompactSlider label="Density" value={vectorDensity} min={0.01} max={1} step={0.01} onChange={setVectorDensity} format={value => `${Math.round(value * 100)}%`} />
              <p style={schemeHintStyle}>
                Arrows are colored by magnitude. Property map can paint atoms with the same scale.
              </p>
            </>
          )}
        </ControlGroup>
      )}

      <AdvancedSection title="Fine-tune structure">
        <ControlGroup title="Visual style">
        <div className="lupi-studio-segments">
          {LOOK_OPTIONS.map(option => (
            <SegmentButton
              key={option.id}
              label={option.label}
              active={postprocessPreset === option.id}
              accent={option.accent}
              onClick={() => setPostprocessPreset(option.id)}
            />
          ))}
        </div>
        <p style={schemeHintStyle}>{POSTPROCESS_PRESETS[postprocessPreset].tagline}</p>
        <CompactSlider
          label="Style strength"
          value={postprocessIntensity}
          min={0}
          max={2}
          step={0.05}
          onChange={setPostprocessIntensity}
          format={value => `${Math.round(value * 100)}%`}
        />
      </ControlGroup>

      {/* Material is a single clear choice — pick a recipe, read what it
          does. The recipe sets finish/lighting/texture together, so the
          old Mix/Rough/Polish/Coat sliders are gone; only atom size (a
          geometry control no recipe owns) stays exposed. */}
      <ControlGroup title="Atom appearance">
        <CompactSelect
          label="Appearance preset"
          value={materialScene}
          onChange={(value) => {
            const scene = materialScenes.find(item => item.id === value);
            if (scene) applyMoleculeRecipe(scene);
          }}
          options={materialScenes.map(scene => ({ value: scene.id, label: scene.label }))}
        />
        {activeRecipe && <p style={schemeHintStyle}>{activeRecipe.description}</p>}
        <CompactSlider label="Atom size" value={atomScale} min={0.1} max={2} step={0.05} onChange={setAtomScale} format={value => value.toFixed(2)} />
      </ControlGroup>

      <ControlGroup title="Bond detection">
        <p style={schemeHintStyle}>
          {hasSourceBonds
            ? 'This frame carries source bond pairs. Adjust presentation without changing their topology.'
            : canInferBonds
              ? 'Lupi can infer visual bonds because element identity and Ångström distance are known. Adjust sensitivity only when needed.'
              : 'Distance-inferred bonds require a complete element mapping and Ångström coordinates.'}
        </p>
        <div className="lupi-studio-segments">
          <SegmentButton label="Bonds" active={showBonds} accent="#1edce0" onClick={() => { if (bondsAreSafe) toggleBonds(); }} />
          <SegmentButton label={hasElementIdentity ? 'By element' : 'By type'} active={bondColorMode === 'type'} accent="#7de9ff" onClick={() => setBondColorMode('type')} />
          <SegmentButton label="By length" active={bondColorMode === 'length'} accent="#f59e0b" onClick={() => setBondColorMode('length')} />
        </div>
        {!bondsAreSafe && atomCount >= 25_000 && (
          <p style={schemeHintStyle}>Bond display is disabled at 25,000 atoms and above to protect interaction speed.</p>
        )}
        {!bondsAreSafe && atomCount > 0 && atomCount < 25_000 && !hasSourceBonds && !canInferBonds && (
          <p role="status" style={schemeHintStyle}>No source bonds are present, and this frame does not carry enough chemistry/unit provenance for covalent inference.</p>
        )}
        <CompactSlider label="Bond sensitivity" value={bondTolerance} min={0} max={1.2} step={0.02} onChange={setBondTolerance} format={value => value.toFixed(2)} />
      </ControlGroup>
      </AdvancedSection>
    </div>
  );
}

function ModelPresetButton({
  view,
  active,
  disabledReason,
  describedBy,
  onFocus,
  onBlur,
  onClick,
}: {
  view: ModelPresetId;
  active: boolean;
  disabledReason?: string;
  describedBy?: string;
  onFocus: () => void;
  onBlur: () => void;
  onClick: () => void;
}) {
  const option = MODEL_PRESET_COPY[view];
  const unavailable = Boolean(disabledReason);
  const description = disabledReason ?? option.description;
  return (
    <button
      type="button"
      data-testid={`model-preset-${view}`}
      aria-pressed={active}
      aria-disabled={unavailable}
      aria-label={`${option.label} preset. ${unavailable ? `Unavailable. ${description}` : description}`}
      aria-describedby={describedBy}
      title={description}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={onClick}
      style={{
        position: 'relative',
        minWidth: 0,
        minHeight: 40,
        display: 'grid',
        placeItems: 'center',
        padding: '6px 4px',
        textAlign: 'center',
        borderRadius: 5,
        border: active ? `1px solid ${option.accent}` : '1px solid rgba(148,163,184,0.18)',
        background: active
          ? `linear-gradient(90deg, ${option.accent}22, rgba(9,14,22,0.96))`
          : '#0a1119',
        color: unavailable ? '#64748b' : '#f8fafc',
        opacity: unavailable ? 0.68 : 1,
        cursor: unavailable ? 'help' : 'pointer',
        touchAction: 'manipulation',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 840, lineHeight: 1.1 }}>{option.label}</span>
      {unavailable && (
        <span
          aria-hidden="true"
          style={{ position: 'absolute', top: 3, right: 4, color: '#fbbf24', fontSize: 8, fontWeight: 900, lineHeight: 1 }}
        >
          !
        </span>
      )}
    </button>
  );
}
