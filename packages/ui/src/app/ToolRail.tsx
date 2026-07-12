import type { ReactNode } from 'react';
import { useStore, type ViewerControlMode } from '../store';
import { Rail } from '../primitives/AppShell';
import { IconControls, IconExport, IconFlythrough, IconTelemetryTool } from '../icons';

function ToolRailButton({
  label,
  compact,
  shortLabel,
  icon,
  active,
  onClick,
}: {
  label: string;
  compact: boolean;
  shortLabel?: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  const visibleLabel = compact ? (shortLabel ?? label) : label;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`lupine-btn compact ${active ? 'active' : ''}`}
      style={{
        flexShrink: 0,
        width: compact ? 50 : 'auto',
        minWidth: compact ? 50 : 94,
        height: compact ? 44 : 38,
        padding: compact ? '4px 3px' : '0 12px',
        gap: compact ? 2 : 7,
        flexDirection: compact ? 'column' : 'row',
        fontSize: compact ? 9 : 12,
        fontWeight: 780,
        letterSpacing: 0,
        lineHeight: 1,
      }}
    >
      <span style={{
        display: 'flex',
        width: compact ? 17 : 19,
        height: compact ? 17 : 19,
        alignItems: 'center',
        justifyContent: 'center',
        color: active ? '#1edce0' : 'rgba(226,232,240,0.74)',
        filter: active ? 'drop-shadow(0 0 7px rgba(30,220,224,0.50))' : 'none',
      }}>
        {icon}
      </span>
      <span className="lupine-truncate" style={{ maxWidth: '100%' }}>
        {visibleLabel}
      </span>
    </button>
  );
}

export function ToolRail({ isMobile }: { isMobile: boolean }) {
  const activePanel = useStore(s => s.activePanel);
  const studioDeck = useStore(s => s.studioDeck);
  const setActivePanel = useStore(s => s.setActivePanel);
  const setStudioDeck = useStore(s => s.setStudioDeck);
  const setViewMenuOpen = useStore(s => s.setViewMenuOpen);

  const openStudioDeck = (mode: ViewerControlMode) => {
    setViewMenuOpen(false);
    setStudioDeck(mode);
    if (activePanel !== 'studio') setActivePanel('studio');
  };

  const toggleControlsPanel = () => {
    setViewMenuOpen(false);
    if (activePanel === 'studio' && (studioDeck ?? 'molecule') !== 'export') {
      setActivePanel(null);
      return;
    }
    setStudioDeck(studioDeck === 'export' ? 'molecule' : studioDeck ?? 'molecule');
    if (activePanel !== 'studio') setActivePanel('studio');
  };

  const openUtilityPanel = (panel: 'flythrough' | 'telemetry') => {
    setViewMenuOpen(false);
    setStudioDeck(null);
    setActivePanel(panel);
  };

  return (
    <Rail
      direction="row"
      role="toolbar"
      aria-label="Viewer tools"
      data-testid="viewer-tool-rail"
      className="lupine-overlay lupine-overlay--top-right"
      style={{ top: 88 }}
    >
      <ToolRailButton
        label="Style"
        compact={isMobile}
        shortLabel="Style"
        icon={<IconControls />}
        active={activePanel === 'studio' && (studioDeck ?? 'molecule') !== 'export'}
        onClick={toggleControlsPanel}
      />
      <ToolRailButton
        label="Export"
        compact={isMobile}
        shortLabel="Export"
        icon={<IconExport />}
        active={activePanel === 'studio' && studioDeck === 'export'}
        onClick={() => openStudioDeck('export')}
      />
      <ToolRailButton
        label="Camera path"
        compact={isMobile}
        shortLabel="Path"
        icon={<IconFlythrough />}
        active={activePanel === 'flythrough'}
        onClick={() => openUtilityPanel('flythrough')}
      />
      <ToolRailButton
        label="Analyze"
        compact={isMobile}
        shortLabel="Analyze"
        icon={<IconTelemetryTool />}
        active={activePanel === 'telemetry'}
        onClick={() => openUtilityPanel('telemetry')}
      />
    </Rail>
  );
}
