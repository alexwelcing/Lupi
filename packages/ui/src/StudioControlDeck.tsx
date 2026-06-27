import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { getElementSpec } from '@atlas/core';
import type { ColormapName, RenderStyle } from '@atlas/core/types';
import { MATERIAL_SCENES, type MaterialScene } from '@atlas/scene/materials';
import { COLOR_SCHEMES, SCHEME_ORDER, type ColorSchemeId } from './coloring';
import { useStore, type BackgroundBackdropPattern, type BackgroundBackdropShape, type FilterShellPreset, type FilterShellShape } from './store';
import {
  BG_PRESETS,
  BG_GRADIENT_PRESETS,
  BG_TEXTURE_CATEGORIES,
  BG_VIDEO_PRESETS,
  getBgBadge,
  getBgPoster,
  type BgPresetWithId,
} from './backgroundPresets';
import { getBackdropRadiusLimit } from './viewer/useViewerSceneModel';
import {
  clamp,
  AdvancedSection,
  ControlGroup,
  SegmentButton,
  CompactSlider,
  RiveKnob,
  CompactSelect,
  ColorPicker,
  ElementColorPicker,
  SwatchButton,
  IconClose,
  paletteRailStyle,
  schemeHintStyle,
} from './studio/primitives';

export type StudioDeckMode = 'molecule' | 'scene';

const LOOK_OPTIONS = [
  { id: 'paper', label: 'Paper', code: 'FIG', accent: '#e5e7eb' },
  { id: 'studio', label: 'Studio', code: 'STD', accent: '#1edce0' },
  { id: 'editorial', label: 'Editorial', code: 'EDT', accent: '#38bdf8' },
  { id: 'cinematic', label: 'Cinematic', code: 'CIN', accent: '#f59e0b' },
  { id: 'diagram', label: 'Diagram', code: 'DGM', accent: '#a7f3d0' },
] as const;

const RENDER_OPTIONS: Array<{ id: RenderStyle; label: string; code: string; accent: string }> = [
  { id: 'standard', label: 'Standard', code: 'STD', accent: '#1edce0' },
  { id: 'toon', label: 'Toon', code: 'INK', accent: '#facc15' },
  { id: 'botanical', label: 'Botanical', code: 'BOT', accent: '#69f0ae' },
];

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
  property: '#1edce0',
  family: '#1edce0',
  botanical: '#69f0ae',
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

function categoryPresets(label: string): BgPresetWithId[] {
  return BG_TEXTURE_CATEGORIES.find(category => category.label === label)?.presets ?? [];
}

export function StudioControlDeck({
  mode,
  onClose,
  bottomOffset = 0,
  maxHeight = 'none',
  variant = 'overlay',
  showCloseButton = true,
}: {
  mode: StudioDeckMode;
  onClose: () => void;
  bottomOffset?: number;
  maxHeight?: string;
  variant?: 'overlay' | 'drawer';
  showCloseButton?: boolean;
}) {
  const isDrawer = variant === 'drawer';
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
  const renderStyle = useStore(s => s.renderStyle);
  const setRenderStyle = useStore(s => s.setRenderStyle);

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
  const backgroundBackdropRadius = useStore(s => s.backgroundBackdropRadius);
  const setBackgroundBackdropRadius = useStore(s => s.setBackgroundBackdropRadius);
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
  const encodeToURL = useStore(s => s.encodeToURL);
  const file = useStore(s => s.file);
  const frame = useStore(s => s.frame);
  const [selectedAtomicNumber, setSelectedAtomicNumber] = useState<number | null>(null);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const shareTimerRef = useRef<number | null>(null);

  const materialScenes = useMemo(
    () => MATERIAL_SCENES.filter(scene => FEATURED_SCENE_IDS.includes(scene.id)),
    [],
  );
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
  const backgroundBackdropRadiusMax = useMemo(() => getBackdropRadiusLimit(file), [file]);
  const safeBackgroundBackdropRadius = clamp(backgroundBackdropRadius, 0.25, backgroundBackdropRadiusMax);
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

  useEffect(() => () => {
    if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current);
  }, []);

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
      setColorScheme('family');
    }
  };

  const copyLookLink = async () => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('s', encodeToURL());
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareStatus('copied');
    } catch {
      setShareStatus('failed');
    }
    if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current);
    shareTimerRef.current = window.setTimeout(() => setShareStatus('idle'), 1800);
  };

  const activeRecipe = materialScenes.find(scene => scene.id === materialScene);
  const title = mode === 'molecule' ? 'Molecule' : 'Scene';
  const subtitle = mode === 'molecule'
    ? `${postprocessPreset} grade · ${colorScheme} color`
    : (activeBackgroundPreset?.label ?? backgroundPreset);

  return (
    <div
      data-testid="studio-control-deck"
      style={{
        position: isDrawer ? 'relative' : 'absolute',
        left: isDrawer ? undefined : 0,
        right: isDrawer ? undefined : 0,
        bottom: isDrawer ? undefined : bottomOffset,
        display: 'flex',
        justifyContent: isDrawer ? 'stretch' : 'center',
        pointerEvents: isDrawer ? 'auto' : 'none',
        zIndex: isDrawer ? undefined : 148,
        padding: isDrawer ? 0 : '0 12px',
        minHeight: 0,
        height: isDrawer ? '100%' : undefined,
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
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          align-items: stretch;
        }
        .lupi-studio-segments {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
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
        .lupi-studio-deck-drawer .lupi-deck-grid {
          grid-template-columns: 1fr;
          gap: 7px;
        }
        .lupi-studio-deck-drawer .lupi-studio-segments {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        @media (max-width: 768px) {
          .lupi-deck-grid {
            gap: 8px;
          }
          .lupi-studio-slider-grid {
            grid-template-columns: 1fr;
            gap: 7px;
          }
        }
      `}</style>
      <div
        className={isDrawer ? 'lupi-studio-deck lupi-studio-deck-drawer' : 'lupi-studio-deck'}
        style={{
          pointerEvents: 'auto',
          width: isDrawer ? '100%' : 'min(940px, calc(100vw - 24px))',
          height: isDrawer ? '100%' : undefined,
          maxHeight: isDrawer ? 'none' : maxHeight,
          overflowY: isDrawer ? 'auto' : 'hidden',
          overflowX: 'hidden',
          scrollbarWidth: 'none',
          border: isDrawer ? 'none' : '1px solid rgba(255,255,255,0.12)',
          borderRadius: isDrawer ? 0 : 8,
          background: isDrawer ? 'transparent' : 'linear-gradient(180deg, rgba(4,9,17,0.88), rgba(0,0,0,0.78))',
          boxShadow: isDrawer ? 'none' : '0 24px 80px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.08)',
          backdropFilter: isDrawer ? 'none' : 'blur(18px)',
          WebkitBackdropFilter: isDrawer ? 'none' : 'blur(18px)',
          padding: isDrawer ? '6px 6px 10px' : 8,
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: isDrawer ? 6 : 8,
          padding: isDrawer ? '0 0 1px' : '2px 2px 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{
              width: isDrawer ? 5 : 6,
              height: isDrawer ? 26 : 30,
              borderRadius: 3,
              background: 'linear-gradient(180deg, #1edce0, #f59e0b)',
              boxShadow: '0 0 16px rgba(30,220,224,0.28)',
              flexShrink: 0,
            }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#f8fafc', fontSize: isDrawer ? 12 : 13, fontWeight: 820, lineHeight: 1.1 }}>{title}</div>
              <div style={{
                color: '#94a3b8',
                fontSize: isDrawer ? 9 : 10,
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                lineHeight: 1.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {subtitle}
              </div>
            </div>
          </div>
          {showCloseButton && (
            <button
              type="button"
              aria-label={`Close ${title} controls`}
              onClick={onClose}
              title="Close"
              className="lupine-icon-btn"
              style={{ width: 28, height: 28 }}
            >
              <IconClose />
            </button>
          )}
        </div>

        {mode === 'molecule' && (
          <div className="lupi-deck-grid">
            <ControlGroup title="Grade">
              <div className="lupi-studio-segments">
                {LOOK_OPTIONS.map(option => (
                  <SegmentButton
                    key={option.id}
                    label={option.label}
                    meta={option.code}
                    active={postprocessPreset === option.id}
                    accent={option.accent}
                    onClick={() => setPostprocessPreset(option.id)}
                  />
                ))}
              </div>
              <CompactSlider
                label="Effect"
                value={postprocessIntensity}
                min={0}
                max={2}
                step={0.05}
                onChange={setPostprocessIntensity}
                format={value => `${Math.round(value * 100)}%`}
              />
              <button
                type="button"
                onClick={copyLookLink}
                style={{
                  minHeight: 40,
                  borderRadius: 8,
                  border: '1px solid rgba(167,243,208,0.34)',
                  background: shareStatus === 'copied' ? 'rgba(16,185,129,0.16)' : 'rgba(15,23,42,0.28)',
                  color: shareStatus === 'failed' ? '#fecaca' : '#cbd5e1',
                  fontSize: 11,
                  fontWeight: 760,
                  textAlign: 'left',
                  padding: '0 12px',
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                }}
              >
                {shareStatus === 'copied' ? 'Copied look link' : shareStatus === 'failed' ? 'Copy failed' : 'Copy look link'}
              </button>
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

              {(colorScheme === 'property' || colorScheme === 'family') && (
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
              )}
            </ControlGroup>

            <ControlGroup title="Shape">
              <div className="lupi-studio-segments">
                {RENDER_OPTIONS.map(option => (
                  <SegmentButton
                    key={option.id}
                    label={option.label}
                    meta={option.code}
                    active={renderStyle === option.id}
                    accent={option.accent}
                    onClick={() => setRenderStyle(option.id)}
                  />
                ))}
              </div>
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
        )}

        {mode === 'scene' && (
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
                {backgroundBackdropShape !== 'dome' && (
                  <CompactSlider
                    label="Radius"
                    value={safeBackgroundBackdropRadius}
                    min={0.25}
                    max={backgroundBackdropRadiusMax}
                    step={0.05}
                    onChange={setBackgroundBackdropRadius}
                    format={value => value.toFixed(2)}
                  />
                )}
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
                  <RiveKnob label="Radius" value={filterShellRadius} min={0.75} max={1.6} step={0.01} onChange={setFilterShellRadius} format={value => value.toFixed(2)} />
                </div>
              </ControlGroup>
            </AdvancedSection>
          </div>
        )}
      </div>
    </div>
  );
}

function WorldBackdropBrowser({
  value,
  activePreset,
  groups,
  onChange,
  onRandomWorld,
  onRandomLoop,
}: {
  value: string;
  activePreset?: BgPresetWithId;
  groups: Array<{ label: string; presets: BgPresetWithId[] }>;
  onChange: (value: string) => void;
  onRandomWorld: () => void;
  onRandomLoop: () => void;
}) {
  const badge = activePreset ? getBgBadge(activePreset) : undefined;
  return (
    <div style={{ display: 'grid', gap: 9, minWidth: 0 }}>
      <div style={{
        minHeight: 118,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 9,
        alignItems: 'stretch',
      }}>
        <div style={{
          position: 'relative',
          minHeight: 118,
          overflow: 'hidden',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.12)',
          ...backgroundPreviewStyle(activePreset),
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 26px rgba(0,0,0,0.22)',
        }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, rgba(2,6,23,0.72), rgba(2,6,23,0.18) 56%, rgba(2,6,23,0.5))',
          }} />
          <div style={{
            position: 'relative',
            minHeight: 118,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 12,
            padding: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
              <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
                <div style={{
                  color: '#f8fafc',
                  fontSize: 18,
                  fontWeight: 860,
                  lineHeight: 1.05,
                  textShadow: '0 2px 12px rgba(0,0,0,0.45)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {activePreset?.label ?? 'Select World'}
                </div>
                <div style={{
                  maxWidth: 520,
                  color: '#cbd5e1',
                  fontSize: 11,
                  fontWeight: 650,
                  lineHeight: 1.35,
                  textShadow: '0 1px 8px rgba(0,0,0,0.5)',
                }}>
                  {activePreset?.context ?? 'Choose a 360 environment for the molecular scene.'}
                </div>
              </div>
              {badge && (
                <span style={{
                  flexShrink: 0,
                  padding: '4px 6px',
                  borderRadius: 6,
                  border: '1px solid rgba(30,220,224,0.45)',
                  background: 'rgba(2,6,23,0.54)',
                  color: '#7de9ff',
                  fontSize: 10,
                  fontWeight: 860,
                  fontFamily: 'var(--font-mono)',
                  lineHeight: 1,
                }}>
                  {badge}
                </span>
              )}
            </div>
            <div className="lupi-studio-segments" style={{ maxWidth: 360 }}>
              <SegmentButton label="Surprise world" active={false} accent="#7de9ff" onClick={onRandomWorld} />
              <SegmentButton label="Surprise loop" active={false} accent="#f59e0b" onClick={onRandomLoop} />
            </div>
          </div>
        </div>
        <div style={{
          minWidth: 0,
          display: 'grid',
          gap: 7,
          alignContent: 'start',
          padding: 8,
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.09)',
          background: 'linear-gradient(180deg, rgba(15,23,42,0.54), rgba(3,7,18,0.34))',
        }}>
          <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 820, textTransform: 'uppercase', lineHeight: 1 }}>
            Active Asset
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <MetricPill label="Preset" value={value.replace(/^world-/, '')} />
            <MetricPill label="Type" value={badge ?? 'BASE'} />
            <MetricPill label="Tone" value={activePreset?.intensity ?? 'balanced'} />
            <MetricPill label="Mode" value={getBgPoster(activePreset ?? BG_PRESETS.deep) ? 'ERP' : 'SKY'} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
        {groups.map(group => (
          <BackdropRail
            key={group.label}
            title={group.label}
            presets={group.presets}
            value={value}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      minWidth: 0,
      display: 'grid',
      gap: 4,
      padding: '7px 8px',
      borderRadius: 7,
      border: '1px solid rgba(148,163,184,0.16)',
      background: 'rgba(2,6,23,0.38)',
    }}>
      <span style={{ color: '#64748b', fontSize: 9, fontWeight: 820, textTransform: 'uppercase', lineHeight: 1 }}>{label}</span>
      <span style={{
        minWidth: 0,
        color: '#e2e8f0',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 820,
        lineHeight: 1.15,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textTransform: 'uppercase',
      }}>
        {value}
      </span>
    </div>
  );
}

function BackdropRail({
  title,
  presets,
  value,
  onChange,
}: {
  title: string;
  presets: BgPresetWithId[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (presets.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 5, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 820, textTransform: 'uppercase', lineHeight: 1 }}>{title}</div>
        <div style={{ color: '#64748b', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 820, lineHeight: 1 }}>
          {presets.length}
        </div>
      </div>
      <div className="lupi-world-rail">
        {presets.map(preset => (
          <BackdropTile
            key={preset.id}
            preset={preset}
            active={preset.id === value}
            onClick={() => onChange(preset.id)}
          />
        ))}
      </div>
    </div>
  );
}

function BackdropTile({
  preset,
  active,
  onClick,
}: {
  preset: BgPresetWithId;
  active: boolean;
  onClick: () => void;
}) {
  const badge = getBgBadge(preset);
  return (
    <button
      type="button"
      title={preset.context ? `${preset.label}: ${preset.context}` : preset.label}
      aria-label={`Use ${preset.label} background`}
      aria-pressed={active}
      onClick={onClick}
      style={{
        position: 'relative',
        flex: '0 0 136px',
        width: 136,
        height: 76,
        overflow: 'hidden',
        scrollSnapAlign: 'start',
        borderRadius: 8,
        border: active ? '1px solid #1edce0' : '1px solid rgba(148,163,184,0.18)',
        ...backgroundPreviewStyle(preset),
        boxShadow: active
          ? '0 0 18px rgba(30,220,224,0.28), inset 0 1px 0 rgba(255,255,255,0.12)'
          : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 5px 14px rgba(0,0,0,0.18)',
        cursor: 'pointer',
        padding: 0,
        touchAction: 'manipulation',
      }}
    >
      <span style={{
        position: 'absolute',
        inset: 0,
        background: active
          ? 'linear-gradient(180deg, rgba(2,6,23,0.12), rgba(2,6,23,0.72))'
          : 'linear-gradient(180deg, rgba(2,6,23,0.04), rgba(2,6,23,0.78))',
      }} />
      {badge && (
        <span style={{
          position: 'absolute',
          top: 5,
          right: 5,
          maxWidth: 54,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          padding: '3px 4px',
          borderRadius: 5,
          background: active ? 'rgba(30,220,224,0.22)' : 'rgba(2,6,23,0.62)',
          border: active ? '1px solid rgba(125,233,255,0.45)' : '1px solid rgba(255,255,255,0.12)',
          color: active ? '#baf8ff' : '#cbd5e1',
          fontSize: 8,
          fontWeight: 860,
          fontFamily: 'var(--font-mono)',
          lineHeight: 1,
        }}>
          {badge}
        </span>
      )}
      <span style={{
        position: 'absolute',
        left: 7,
        right: 7,
        bottom: 7,
        minWidth: 0,
        color: active ? '#f8fafc' : '#e2e8f0',
        fontSize: 10,
        fontWeight: 820,
        lineHeight: 1.12,
        textAlign: 'left',
        textShadow: '0 1px 7px rgba(0,0,0,0.65)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {preset.label}
      </span>
    </button>
  );
}

function backgroundPreviewStyle(preset?: BgPresetWithId): CSSProperties {
  if (!preset) {
    return {
      background: 'linear-gradient(135deg, #111827, #020617)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  const poster = getBgPoster(preset);
  if (poster) {
    return {
      backgroundImage: `url("${poster}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return {
    background: preset.preview ?? `linear-gradient(135deg, ${preset.top}, ${preset.bottom})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
}

