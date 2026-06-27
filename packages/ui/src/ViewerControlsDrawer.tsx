/**
 * ViewerControlsDrawer - tabbed control surface for the Studio panel.
 *
 * Renders either inside the dockable window (showChrome=false) or inside
 * the legacy mobile bottom sheet (showChrome=true).
 */
import type { ReactNode } from 'react';
import { usePressSpring } from './hooks/usePressSpring';
import { LupiGlyph, IconControls } from './icons';
import { StudioControlDeck, type StudioDeckMode } from './StudioControlDeck';
import { FigureExportPanel } from './panels/FigureExportPanel';

export type ViewerControlMode = StudioDeckMode | 'export';

interface ViewerControlsDrawerProps {
  activeMode: ViewerControlMode;
  onModeChange: (mode: ViewerControlMode) => void;
  showChrome?: boolean;
}

export function ViewerControlsDrawer({
  activeMode,
  onModeChange,
  showChrome = true,
}: ViewerControlsDrawerProps) {
  const activeLabel = activeMode === 'export'
    ? 'Export'
    : activeMode === 'molecule'
      ? 'Molecule'
      : 'Scene';

  return (
    <div
      data-testid="viewer-controls-drawer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      {showChrome && (
        <div style={{
          flexShrink: 0,
          display: 'grid',
          gap: 7,
          padding: '2px 4px 8px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'transparent',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ color: 'rgba(30,220,224,0.82)', display: 'flex', flexShrink: 0, transform: 'scale(0.9)' }}><IconControls /></span>
              <span style={{ display: 'grid', gap: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 820, letterSpacing: 0, lineHeight: 1 }}>Controls</span>
              </span>
            </div>
            <span style={{ color: 'rgba(30,220,224,0.86)', fontSize: 10, fontWeight: 760, letterSpacing: 0.4, textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>{activeLabel}</span>
          </div>
          <ModeTabs activeMode={activeMode} onModeChange={onModeChange} />
        </div>
      )}

      {!showChrome && (
        <div style={{
          flexShrink: 0,
          padding: '9px 10px 7px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'linear-gradient(180deg, rgba(15,23,42,0.42), rgba(3,7,18,0.08))',
        }}>
          <ModeTabs activeMode={activeMode} onModeChange={onModeChange} />
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {activeMode === 'export' ? (
          <FigureExportPanel showCloseButton={false} />
        ) : (
          <StudioControlDeck mode={activeMode} />
        )}
      </div>
    </div>
  );
}

function ModeTabs({ activeMode, onModeChange }: { activeMode: ViewerControlMode; onModeChange: (mode: ViewerControlMode) => void }) {
  return (
    <div
      role="group"
      aria-label="Viewer control modes"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 5,
        padding: 4,
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 9,
        background: 'rgba(2,6,23,0.5)',
      }}
    >
      <ControlModeTab icon={<IconSurface />} label="Molecule" active={activeMode === 'molecule'} onClick={() => onModeChange('molecule')} />
      <ControlModeTab icon={<IconWorld />} label="Scene" active={activeMode === 'scene'} onClick={() => onModeChange('scene')} />
      <ControlModeTab icon={<IconExport />} label="Export" active={activeMode === 'export'} onClick={() => onModeChange('export')} />
    </div>
  );
}

function ControlModeTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const press = usePressSpring({ pressedScale: 0.96, sound: false });
  return (
    <button
      {...press}
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`lupine-btn ${active ? 'active' : ''}`}
      style={{
        minWidth: 0,
        minHeight: 44,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '6px 4px',
        fontSize: 9,
        fontWeight: 800,
        lineHeight: 1,
        letterSpacing: 0,
        borderRadius: 7,
        boxShadow: active ? '0 0 0 1px rgba(30,220,224,0.28), 0 0 14px rgba(30,220,224,0.16)' : 'none',
        touchAction: 'manipulation',
      }}
    >
      <span style={{
        display: 'flex',
        width: 18,
        height: 18,
        flexShrink: 0,
        color: active ? '#1edce0' : 'rgba(226,232,240,0.78)',
      }}>{icon}</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

const IconSurface = () => (
  <LupiGlyph>
    <path d="M6.7 15.8c2.15-1.35 4.1-1.35 5.85 0 1.4 1.05 3.03 1.05 4.75 0" />
    <path d="M6.7 11.8c2.15-1.35 4.1-1.35 5.85 0 1.4 1.05 3.03 1.05 4.75 0" opacity="0.72" />
    <circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none" opacity="0.72" />
    <circle cx="12" cy="7" r="0.8" fill="currentColor" stroke="none" opacity="0.72" />
    <circle cx="16" cy="8" r="0.8" fill="currentColor" stroke="none" opacity="0.72" />
  </LupiGlyph>
);

const IconWorld = () => (
  <LupiGlyph>
    <path d="M6.5 14.8c1.75 1.05 3.58 1.58 5.5 1.58s3.75-.53 5.5-1.58" />
    <path d="M6.5 10.2c1.75-1.05 3.58-1.58 5.5-1.58s3.75.53 5.5 1.58" />
    <path d="M12 6.5v11" opacity="0.7" />
    <path d="M8.8 7.2c-.82 3.12-.82 6.48 0 9.6" opacity="0.54" />
    <path d="M15.2 7.2c.82 3.12.82 6.48 0 9.6" opacity="0.54" />
  </LupiGlyph>
);

const IconExport = () => (
  <LupiGlyph>
    <path d="M7.1 8.3h6.3c1.28 0 2.32 1.04 2.32 2.32v4.58H7.1V8.3Z" />
    <path d="M9.1 8.3 10.2 6h3.1l1.1 2.3" opacity="0.7" />
    <circle cx="11.45" cy="12.05" r="1.45" />
    <path d="M15.4 6.6h2.5v2.5" />
    <path d="m17.9 6.6-4.2 4.2" />
  </LupiGlyph>
);
