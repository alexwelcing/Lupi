/**
 * MoleculeControls — the Molecule tab body: how the molecule itself looks
 * (grade, color, material recipe, bonds). Owns its own store wiring; the deck
 * shell just mounts it.
 */
import { useEffect, useMemo, useState } from 'react';
import { getElementSpec, detectVectorFields } from '@atlas/core';
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

type QuickViewId = 'balanced' | 'bonds' | 'space' | 'property';

const QUICK_VIEW_COPY: Record<QuickViewId, { label: string; description: string; accent: string }> = {
  balanced: {
    label: 'Balanced',
    description: 'A clear default for exploring structure.',
    accent: '#1edce0',
  },
  bonds: {
    label: 'Inferred bonds',
    description: 'Show distance-inferred connections between nearby atoms.',
    accent: '#7de9ff',
  },
  space: {
    label: 'Occupied space',
    description: 'Emphasize atomic volume and packing.',
    accent: '#f59e0b',
  },
  property: {
    label: 'Property map',
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
  const [selectedAtomicNumber, setSelectedAtomicNumber] = useState<number | null>(null);

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
  const bondsAreSafe = atomCount > 0 && atomCount < 25_000;
  const requiresDiagram = atomCount >= 200_000;
  const validColorProperty = colorProperty && availableProperties.includes(colorProperty)
    ? colorProperty
    : (availableProperties[0] ?? null);
  const presentElements = useMemo(() => {
    const types = residentFrame?.types;
    if (!types) return [];
    const atomicNumbers = new Set<number>();
    for (let i = 0; i < types.length; i++) atomicNumbers.add(types[i]);
    return Array.from(atomicNumbers)
      .sort((a, b) => a - b)
      .map(atomicNumber => ({ atomicNumber, spec: getElementSpec(atomicNumber) }));
  }, [residentFrame]);
  const activeElement = presentElements.find(element => element.atomicNumber === selectedAtomicNumber) ?? presentElements[0] ?? null;
  const activeElementColor = activeElement
    ? elementColorOverrides[activeElement.atomicNumber] ?? activeElement.spec.color
    : uniformAtomColor;
  const activeElementHasOverride = activeElement
    ? Boolean(elementColorOverrides[activeElement.atomicNumber])
    : false;
  useEffect(() => {
    if (presentElements.length === 0) {
      if (selectedAtomicNumber !== null) setSelectedAtomicNumber(null);
      return;
    }
    if (!presentElements.some(element => element.atomicNumber === selectedAtomicNumber)) {
      setSelectedAtomicNumber(presentElements[0].atomicNumber);
    }
  }, [presentElements, selectedAtomicNumber]);

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

  const applyElementColor = (atomicNumber: number, color: string) => {
    setElementColorOverride(atomicNumber, color);
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

  const applyQuickView = (view: QuickViewId) => {
    // Quick views intentionally touch only the structure presentation. They
    // never change the selected background, environment, or lighting setup.
    setVectorField(null);

    if (view === 'balanced') {
      setPostprocessPreset(balancedPreset);
      setPostprocessIntensity(balancedIntensity);
      setColorScheme('element');
      setAtomScale(balancedAtomScale);
      setBondsVisible(bondsAreSafe);
      return;
    }

    if (view === 'bonds') {
      if (!bondsAreSafe) return;
      setPostprocessPreset(safePreset('studio'));
      setPostprocessIntensity(1);
      setColorScheme('element');
      setAtomScale(0.72);
      setBondColorMode('type');
      setBondsVisible(true);
      return;
    }

    if (view === 'space') {
      if (requiresDiagram) return;
      setPostprocessPreset(safePreset('studio'));
      setPostprocessIntensity(1);
      setColorScheme('element');
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

  const activeQuickView: QuickViewId | null = (() => {
    if (
      postprocessPreset === balancedPreset
      && postprocessIntensity === balancedIntensity
      && colorScheme === 'element'
      && atomScale === balancedAtomScale
      && showBonds === bondsAreSafe
      && vectorField === null
    ) return 'balanced';
    if (
      bondsAreSafe
      && postprocessPreset === safePreset('studio')
      && postprocessIntensity === 1
      && colorScheme === 'element'
      && atomScale === 0.72
      && showBonds
      && bondColorMode === 'type'
      && vectorField === null
    ) return 'bonds';
    if (
      postprocessPreset === safePreset('studio')
      && postprocessIntensity === 1
      && colorScheme === 'element'
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

  return (
    <div className="lupi-deck-grid">
      <ControlGroup title="Quick views" wide>
        <p style={schemeHintStyle}>Start with the result you want. Switch views at any time.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
          {(Object.keys(QUICK_VIEW_COPY) as QuickViewId[]).map(view => {
            const disabled = (view === 'bonds' && !bondsAreSafe)
              || (view === 'property' && !validColorProperty)
              || (view === 'space' && requiresDiagram);
            const disabledReason = view === 'bonds'
              ? `Bond inference is available below 25,000 atoms. This structure has ${atomCount.toLocaleString()}.`
              : view === 'space'
                ? 'Occupied space is unavailable at 200,000 atoms and above to avoid excessive overdraw.'
                : 'This structure has no per-atom data.';
            return (
              <QuickViewButton
                key={view}
                view={view}
                active={activeQuickView === view}
                disabled={disabled}
                disabledReason={disabled ? disabledReason : undefined}
                onClick={() => applyQuickView(view)}
              />
            );
          })}
        </div>
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
          {SCHEME_ORDER.map(schemeId => {
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

        {colorScheme === 'element' && activeElement && (
          <ElementColorPicker
            active={colorScheme === 'element' || activeElementHasOverride}
            atomicNumber={activeElement.atomicNumber}
            value={activeElementColor}
            options={presentElements.map(element => ({
              value: element.atomicNumber,
              label: `${element.spec.symbol} ${element.atomicNumber}`,
            }))}
            overridden={activeElementHasOverride}
            onSelect={setSelectedAtomicNumber}
            onChange={(color) => applyElementColor(activeElement.atomicNumber, color)}
            onReset={() => {
              resetElementColorOverride(activeElement.atomicNumber);
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
              <CompactSlider label="Density" value={vectorDensity} min={0.05} max={1} step={0.05} onChange={setVectorDensity} format={value => `${Math.round(value * 100)}%`} />
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
        <p style={schemeHintStyle}>Lupi can infer visual bonds from distance. Adjust sensitivity only when the default misses or adds connections.</p>
        <div className="lupi-studio-segments">
          <SegmentButton label="Bonds" active={showBonds} accent="#1edce0" onClick={() => { if (bondsAreSafe) toggleBonds(); }} />
          <SegmentButton label="By element" active={bondColorMode === 'type'} accent="#7de9ff" onClick={() => setBondColorMode('type')} />
          <SegmentButton label="By length" active={bondColorMode === 'length'} accent="#f59e0b" onClick={() => setBondColorMode('length')} />
        </div>
        {!bondsAreSafe && (
          <p style={schemeHintStyle}>Bond inference is disabled at 25,000 atoms and above to protect interaction speed.</p>
        )}
        <CompactSlider label="Bond sensitivity" value={bondTolerance} min={0} max={1.2} step={0.02} onChange={setBondTolerance} format={value => value.toFixed(2)} />
      </ControlGroup>
      </AdvancedSection>
    </div>
  );
}

function QuickViewButton({
  view,
  active,
  disabled,
  disabledReason,
  onClick,
}: {
  view: QuickViewId;
  active: boolean;
  disabled: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  const option = QUICK_VIEW_COPY[view];
  return (
    <button
      type="button"
      data-testid={`quick-view-${view}`}
      aria-pressed={active}
      disabled={disabled}
      title={disabledReason ?? option.description}
      onClick={onClick}
      style={{
        minWidth: 0,
        minHeight: 68,
        display: 'grid',
        gap: 4,
        alignContent: 'center',
        padding: '10px 11px',
        textAlign: 'left',
        borderRadius: 8,
        border: active ? `1px solid ${option.accent}` : '1px solid rgba(148,163,184,0.18)',
        background: active
          ? `linear-gradient(135deg, ${option.accent}2b, rgba(9,14,22,0.92))`
          : 'linear-gradient(135deg, rgba(15,23,42,0.74), rgba(3,7,18,0.62))',
        color: disabled ? '#64748b' : '#f8fafc',
        opacity: disabled ? 0.62 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        touchAction: 'manipulation',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 840, lineHeight: 1.15 }}>{option.label}</span>
      <span style={{ color: disabled ? '#64748b' : '#94a3b8', fontSize: 9, fontWeight: 650, lineHeight: 1.3 }}>
        {disabledReason ?? option.description}
      </span>
    </button>
  );
}
