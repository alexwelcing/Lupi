import { lazy, Suspense, useState } from 'react';
const AccountMenu = lazy(() =>
  import('./user/AccountMenu').then(module => ({
    default: module.AccountMenu,
  })),
);

/** Authentication and saved-view clients are fetched only when Account is opened. */
export function LupiAgentDock({ compact = false }: { compact?: boolean }) {
  const [activated, setActivated] = useState(false);
  const style = {
    minHeight: 40,
    padding: compact ? '8px 10px' : '9px 14px',
    color: '#edf3e6',
    background: '#23352b',
    border: '1px solid #556b59',
    borderRadius: 7,
    cursor: 'pointer',
    font: '500 13px/1.4 system-ui,sans-serif',
  };
  if (!activated)
    return (
      <div style={{ flexShrink: 0 }}>
        <button
          type="button"
          data-testid="lupi-agent-dock-button"
          aria-label="Account"
          aria-expanded={false}
          style={style}
          onClick={() => setActivated(true)}
        >
          Account
        </button>
      </div>
    );
  return (
    <Suspense
      fallback={
        <span role="status" style={style}>
          Loading account…
        </span>
      }
    >
      <AccountMenu compact={compact} />
    </Suspense>
  );
}
