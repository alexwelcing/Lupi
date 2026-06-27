/**
 * WorldBackdropBrowser — the Scene tab's world picker: a hero preview of the
 * active backdrop, an "active asset" metric strip, and horizontally-scrolling
 * rails of backdrop tiles grouped by category. Pure presentation driven by
 * props; the Scene controls own the store wiring.
 */
import type { CSSProperties } from 'react';
import { BG_PRESETS, getBgBadge, getBgPoster, type BgPresetWithId } from '../backgroundPresets';
import { SegmentButton } from './primitives';

export function WorldBackdropBrowser({
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
        <div style={{ minWidth: 0, color: '#94a3b8', fontSize: 10, fontWeight: 820, textTransform: 'uppercase', lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ flexShrink: 0, color: '#64748b', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 820, lineHeight: 1 }}>
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
