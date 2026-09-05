import { memo } from 'react';
import { useStore } from '../store';
import { SavedViewButton } from '../SavedViewButton';
import { LupiAgentDock } from '../LupiAgentDock';
import { GpuStudioLaunch } from '../gpu-studio/GpuStudioLaunch';

export const AppHeader = memo(function AppHeader({
  isMobile,
  clearLoadedFile,
  onStudioOpenChange,
}: {
  isMobile: boolean;
  clearLoadedFile: () => void;
  onStudioOpenChange: (open: boolean) => void;
}) {
  const fileName = useStore(state => state.file?.name ?? '');
  const atomCount = useStore(state => state.file?.trajectory.frames.find(Boolean)?.natoms ?? 0);
  return (
    <header
      className="lupine-status-bar"
      style={{
        display: 'flex',
        gap: isMobile ? 6 : 12,
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 58,
        padding: '8px 12px',
        margin: isMobile ? '8px' : '14px 16px 0',
        borderRadius: 8,
        zIndex: 200,
      }}
    >
      <button
        onClick={clearLoadedFile}
        aria-label="Return to Lupi home"
        style={{
          font: '24px Georgia,serif',
          color: '#eff3e9',
          border: 0,
          background: 'none',
          cursor: 'pointer',
          minHeight: 40,
        }}
      >
        Lupi
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          title={fileName}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 13,
            color: '#eff3e9',
          }}
        >
          {fileName || 'Molecule viewer'}
        </div>
        {atomCount > 0 && (
          <div style={{ fontSize: 11, color: '#afc0b4', whiteSpace: 'nowrap' }}>
            {atomCount.toLocaleString()} atoms
          </div>
        )}
      </div>
      {fileName && <SavedViewButton compact={isMobile} />}
      {fileName && <GpuStudioLaunch onOpenChange={onStudioOpenChange} />}
      <LupiAgentDock compact={isMobile} />
    </header>
  );
});
