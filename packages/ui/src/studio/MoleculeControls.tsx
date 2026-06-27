/**
 * MoleculeControls — the Molecule tab body: how the molecule itself looks
 * (grade, color, material recipe, bonds). Owns its own store wiring; the deck
 * shell just mounts it.
 */
import { useEffect, useMemo, useState } from 'react';
import { getElementSpec } from '@atlas/core';
import type { ColormapName } from '@atlas/core/types';
import { MATERIAL_SCENES, type MaterialScene } from '@atlas/scene/materials';
import { COLOR_SCHEMES, SCHEME_ORDER, type ColorSchemeId } from '../coloring';
import { POSTPROCESS_PRESETS } from '../postprocess/presets';
import { useStore } from '../store';
import {
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

// Ordered flat → dramatic so the row reads as a spectrum: Diagram (no
// effects) on the left, Cinematic (full depth-of-field + bloom) on the right.
// The selected look's plain-language description shows below the row, so a
// grade is never a mystery.
const LOOK_OPTIONS = [
  { id: 'diagram', label: 'Diagram', accent: '#a7f3d0' },
  { id: 'paper', label: 'Paper', accent: '#e5e7eb' },
  { id: 'studio', label: 'Studio', accent: '#1edce0' },
  { id: 'editorial', label: 'Editorial', accent: '#38bdf8' },
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
  const availableProperties = useMemo(() => {
    const props = file?.trajectory.frames[frame]?.properties;
    return props ? Array.from(props.keys()) : [];
  }, [file, frame]);
  const presentElements = useMemo(() => {
    const types = file?.trajectory.frames[frame]?.types;
    if (!types) return [];
    const atomicNumbers = new Set<number>();
    for (let i = 0; i < types.length; i++) atomicNumbers.add(types[i]);
    return Array.from(atomicNumbers)
      .sort((a, b) => a - b)
      .map(atomicNumber => ({ atomicNumber, spec: getElementSpec(atomicNumber) }));
  }, [file, frame]);
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
    setColorScheme(scheme);
    if (scheme === 'property' && !colorProperty && availableProperties.length > 0) {
      setColorProperty(availableProperties[0]);
    }
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

  return (
    <div className="lupi-deck-grid">
      <ControlGroup title="Grade">
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
          label="Effect"
          value={postprocessIntensity}
          min={0}
          max={2}
          step={0.05}
          onChange={setPostprocessIntensity}
          format={value => `${Math.round(value * 100)}%`}
        />
      </ControlGroup>

      {/* Color — one group. Pick a scheme, then tune the single control
          that scheme actually uses. The scheme decides everything else
          (atom color mode + palette source) via setColorScheme, so there
          is no second "Elements/Color/Palette" group to keep in sync and
          no colormap rail shown for schemes that ignore the colormap. */}
      <ControlGroup title="Color">
        <div className="lupi-studio-segments">
          {SCHEME_ORDER.map(schemeId => {
            const scheme = COLOR_SCHEMES[schemeId];
            return (
              <SegmentButton
                key={scheme.id}
                label={scheme.label}
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
              value={colorProperty ?? ''}
              onChange={(value) => {
                setColorProperty(value || null);
                if (value) setColorScheme('property');
              }}
              options={availableProperties.slice(0, 12).map(property => ({ value: property, label: property }))}
              placeholder="Property"
            />
          ) : (
            <p style={schemeHintStyle}>No per-atom properties in this dataset.</p>
          )
        )}

        {(colorScheme === 'colorway' || colorScheme === 'property') && (
          <div style={{ display: 'grid', gap: 5 }}>
            <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 820, textTransform: 'uppercase', lineHeight: 1 }}>
              Colorway
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

      {/* Material is a single clear choice — pick a recipe, read what it
          does. The recipe sets finish/lighting/texture together, so the
          old Mix/Rough/Polish/Coat sliders are gone; only atom size (a
          geometry control no recipe owns) stays exposed. */}
      <ControlGroup title="Material">
        <CompactSelect
          label="Recipe"
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

      <ControlGroup title="Bonds">
        <div className="lupi-studio-segments">
          <SegmentButton label={showBonds ? 'Bonds on' : 'Bonds off'} active={showBonds} accent="#1edce0" onClick={toggleBonds} />
          <SegmentButton label="By type" active={bondColorMode === 'type'} accent="#7de9ff" onClick={() => setBondColorMode('type')} />
          <SegmentButton label="By length" active={bondColorMode === 'length'} accent="#f59e0b" onClick={() => setBondColorMode('length')} />
        </div>
        <CompactSlider label="Tolerance" value={bondTolerance} min={0} max={1.2} step={0.02} onChange={setBondTolerance} format={value => value.toFixed(2)} />
      </ControlGroup>
    </div>
  );
}
