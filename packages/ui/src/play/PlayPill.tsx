/**
 * PlayPill — the one floating pill (Play, status, stow). WP0 stub: the
 * existing stow ("Clear view") bucket, markup unchanged.
 */
import type { Dispatch, SetStateAction } from 'react';

export interface PlayPillProps {
  uiStowed: boolean;
  setUiStowed: Dispatch<SetStateAction<boolean>>;
}

export function PlayPill({ uiStowed, setUiStowed }: PlayPillProps) {
  return (
    <button
      type="button"
      className="lupine-ui-bucket"
      data-stowed={uiStowed}
      aria-label={uiStowed ? 'Restore viewer controls' : 'Stow viewer controls'}
      aria-pressed={uiStowed}
      title={uiStowed ? 'Restore controls' : 'Stow all controls'}
      onClick={() => setUiStowed(value => !value)}
    >
      <span className="lupine-ui-bucket__orb" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="lupine-ui-bucket__label">{uiStowed ? 'Restore' : 'Clear view'}</span>
      <span className="lupine-ui-bucket__count" aria-hidden="true">
        {uiStowed ? 'UI' : '↓'}
      </span>
    </button>
  );
}
