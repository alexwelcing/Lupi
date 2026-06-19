import { useMemo, type CSSProperties } from 'react';
import { getBackgroundFromColormap } from '@atlas/scene';
import type { ColormapName } from '@atlas/core/types';
import {
  BG_PRESETS,
  BG_TEXTURE_CATEGORIES,
  getBgBadge,
  getBgMedia,
  getBgPoster,
  type BgMedia,
  type BgPreset,
  type BgPresetWithId,
} from '../backgroundPresets';
import { useStore, type AppState } from '../store';

const NEUTRAL_BACKGROUND_IDS = [
  'neutral-atrium',
  'graphite-orbit',
  'cryo-haze',
  'spectrum-quiet',
  'slate',
  'deep',
  'fog',
] as const;

export function WorldHomeBackground() {
  const backgroundPreset = useStore((s) => s.backgroundPreset);
  const backgroundStyle = useStore((s) => s.backgroundStyle);
  const colormap = useStore((s) => s.colormap);
  const setBackgroundPreset = useStore((s) => s.setBackgroundPreset);

  const resolved = useMemo(
    () => resolveHomeBackground(backgroundPreset, colormap),
    [backgroundPreset, colormap],
  );
  const groups = useMemo(
    () => buildHomeBackgroundGroups(backgroundPreset, resolved.preset),
    [backgroundPreset, resolved.preset],
  );
  const swatchStyle = useMemo(() => backgroundSwatchStyle(resolved.preset), [resolved.preset]);
  const badge = getBgBadge(resolved.preset) ?? (resolved.media.kind === 'video' ? 'LOOP' : resolved.preset.category?.toUpperCase());

  return (
    <>
      <style>{WORLD_HOME_CSS}</style>
      <WorldHomeBackdrop
        presetId={backgroundPreset}
        preset={resolved.preset}
        media={resolved.media}
        styleMode={backgroundStyle}
      />
      <div
        className="lupi-world-home-picker"
        data-testid="home-world-background-picker"
        style={{ '--world-swatch': swatchStyle } as CSSProperties}
      >
        <div className="lupi-world-home-swatch" aria-hidden="true" />
        <label className="lupi-world-home-select">
          <span>World</span>
          <select
            value={backgroundPreset}
            onChange={(event) => setBackgroundPreset(event.currentTarget.value)}
            data-testid="home-world-background-select"
            aria-label="World background"
          >
            {groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {badge && <span className="lupi-world-home-badge">{badge}</span>}
      </div>
    </>
  );
}

function WorldHomeBackdrop({
  presetId,
  preset,
  media,
  styleMode,
}: {
  presetId: string;
  preset: BgPreset;
  media: BgMedia;
  styleMode: AppState['backgroundStyle'];
}) {
  const baseBackground = backgroundGradient(preset.top, preset.bottom, styleMode);

  return (
    <div
      className="lupi-world-home-backdrop"
      data-world-background={presetId}
      data-world-media={media.kind}
      data-world-projection={media.projection}
      data-world-style={styleMode}
      aria-hidden="true"
    >
      <div className="lupi-world-home-base" style={{ background: baseBackground }} />
      {preset.procedural && preset.preview && (
        <div className="lupi-world-home-procedural" style={{ background: preset.preview }} />
      )}
      {media.kind === 'image' && (
        <div
          className="lupi-world-home-media lupi-world-home-image"
          style={{ backgroundImage: imageBackground(media.src) }}
        />
      )}
      {media.kind === 'video' && (
        <video
          key={presetId}
          className="lupi-world-home-media lupi-world-home-video"
          autoPlay
          loop={media.loop ?? true}
          muted={media.muted ?? true}
          playsInline
          poster={media.poster}
          preload={media.preload ?? 'metadata'}
        >
          {media.sources.map((source) => (
            <source key={`${source.src}-${source.type ?? 'video'}`} src={source.src} type={source.type} />
          ))}
        </video>
      )}
      <div className="lupi-world-home-vignette" />
    </div>
  );
}

function resolveHomeBackground(backgroundPreset: string, colormap: ColormapName): { preset: BgPreset; media: BgMedia } {
  if (backgroundPreset.startsWith('palette:')) {
    const [, palette] = backgroundPreset.split(':');
    const colors = getBackgroundFromColormap((palette || colormap) as ColormapName);
    const preset: BgPreset = {
      ...colors,
      label: `${palette || colormap} palette`,
      category: 'gradient',
    };
    return { preset, media: { kind: 'gradient', projection: 'equirectangular' } };
  }
  const preset = BG_PRESETS[backgroundPreset] ?? BG_PRESETS.slate ?? BG_PRESETS.deep;
  return { preset, media: getBgMedia(preset) };
}

function buildHomeBackgroundGroups(activeId: string, activePreset: BgPreset): Array<{ label: string; presets: BgPresetWithId[] }> {
  const neutralPresets = NEUTRAL_BACKGROUND_IDS
    .map((id) => BG_PRESETS[id] ? ({ id, ...BG_PRESETS[id] }) : null)
    .filter(Boolean) as BgPresetWithId[];
  const textureGroups = BG_TEXTURE_CATEGORIES.filter((group) => group.label !== 'Neutral Worlds');
  const groups = [
    { label: 'Neutral', presets: neutralPresets },
    ...textureGroups,
  ].filter((group) => group.presets.length > 0);

  if (!activeId || groups.some((group) => group.presets.some((preset) => preset.id === activeId))) {
    return groups;
  }

  return [{ label: 'Current', presets: [{ id: activeId, ...activePreset }] }, ...groups];
}

function backgroundGradient(top: string, bottom: string, styleMode: AppState['backgroundStyle']): string {
  if (styleMode === 'linear') {
    return `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;
  }
  if (styleMode === 'spotlight') {
    return [
      `radial-gradient(circle at 55% 26%, ${top} 0%, transparent 34%)`,
      'radial-gradient(circle at 78% 24%, rgba(30, 220, 224, 0.18) 0%, transparent 28%)',
      'radial-gradient(circle at 26% 72%, rgba(251, 191, 36, 0.11) 0%, transparent 32%)',
      `linear-gradient(180deg, ${bottom} 0%, #020204 100%)`,
    ].join(', ');
  }
  return [
    `radial-gradient(circle at 50% 24%, ${top} 0%, transparent 48%)`,
    `linear-gradient(180deg, ${top} 0%, ${bottom} 82%, #020204 100%)`,
  ].join(', ');
}

function backgroundSwatchStyle(preset: BgPreset): string {
  if (preset.preview) return preset.preview;
  const poster = getBgPoster(preset);
  if (poster) {
    return `linear-gradient(180deg, rgba(2,6,23,0.08), rgba(2,6,23,0.46)), ${imageBackground(poster)}`;
  }
  return `linear-gradient(135deg, ${preset.top}, ${preset.bottom})`;
}

function imageBackground(src: string): string {
  return `url("${src.replace(/"/g, '\\"')}")`;
}

const WORLD_HOME_CSS = `
.lupi-world-home {
  position: relative;
  min-height: 100vh;
  overflow-x: clip;
  isolation: isolate;
  background: #020204;
  color: #f8fafc;
}
.lupi-world-home-content {
  position: relative;
  z-index: 1;
}
.lupi-world-home-backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background: #020204;
}
.lupi-world-home-base,
.lupi-world-home-procedural,
.lupi-world-home-media,
.lupi-world-home-vignette {
  position: absolute;
  inset: 0;
}
.lupi-world-home-base {
  opacity: 1;
}
.lupi-world-home-procedural {
  opacity: 0.36;
  background-size: cover;
  filter: saturate(0.88) contrast(1.04) brightness(0.8);
  mix-blend-mode: screen;
}
.lupi-world-home-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
  opacity: 0.54;
  filter: saturate(0.9) contrast(1.05) brightness(0.68);
  transform: scale(1.018);
}
.lupi-world-home-image {
  background-size: cover;
  background-position: center center;
}
.lupi-world-home-vignette {
  background:
    linear-gradient(90deg, rgba(2,2,4,0.76) 0%, rgba(2,2,4,0.24) 42%, rgba(2,2,4,0.66) 100%),
    radial-gradient(circle at 50% 24%, transparent 0%, rgba(2,2,4,0.18) 38%, rgba(2,2,4,0.78) 100%),
    linear-gradient(180deg, rgba(2,2,4,0.24) 0%, rgba(2,2,4,0.58) 48%, rgba(2,2,4,0.88) 100%);
}
.lupi-world-home-picker {
  position: absolute;
  top: 18px;
  right: 20px;
  z-index: 5;
  display: grid;
  grid-template-columns: 42px minmax(180px, 250px) auto;
  gap: 8px;
  align-items: center;
  box-sizing: border-box;
  padding: 8px;
  max-width: calc(100vw - 32px);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(9,14,22,0.72), rgba(2,6,14,0.52));
  box-shadow: 0 18px 48px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.lupi-world-home-swatch {
  width: 42px;
  height: 42px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.16);
  background: var(--world-swatch);
  background-size: cover;
  background-position: center;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.18);
}
.lupi-world-home-select {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.lupi-world-home-select span {
  color: rgba(226,232,240,0.58);
  font-size: 10px;
  font-weight: 820;
  text-transform: uppercase;
  line-height: 1;
  letter-spacing: 0;
}
.lupi-world-home-select select {
  width: 100%;
  min-width: 0;
  height: 30px;
  border-radius: 7px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: #f8fafc;
  font: inherit;
  font-size: 12px;
  font-weight: 720;
  outline: none;
}
.lupi-world-home-badge {
  justify-self: end;
  align-self: center;
  max-width: 64px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid rgba(125,211,252,0.32);
  color: rgba(191,236,255,0.86);
  background: rgba(14,165,233,0.1);
  font-size: 9px;
  font-weight: 840;
  line-height: 1;
}
@media (max-width: 900px) {
  .lupi-world-home-picker {
    position: relative;
    top: auto;
    right: auto;
    margin: 10px 12px 0;
    grid-template-columns: 38px minmax(0, 1fr) auto;
  }
  .lupi-world-home-badge {
    justify-self: end;
  }
}
@media (max-width: 520px) {
  .lupi-world-home-picker {
    gap: 7px;
    padding: 7px;
  }
  .lupi-world-home-swatch {
    width: 38px;
    height: 38px;
  }
}
`;
