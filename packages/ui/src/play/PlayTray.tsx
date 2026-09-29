/**
 * PlayTray — the short menu the Play pill opens (also `P`, a right click on
 * empty canvas, and the palette's "Open Play"):
 *
 *   One finger   Orbit · Poke
 *   Try          Scatter · Spin · Reset
 *   Motion       Standard · Gentle · Still
 *                Settings…
 *
 * A `role="menu"` anchored above the pill. Arrow keys, Home and End move
 * between items, Enter and Space activate, Escape (or Tab, or a tap outside)
 * closes. Every item is at least 44 px tall. Toys only emit intents; Motion
 * writes `comfort.ts`, never the viewer store, URLs or saved views.
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { emitIntent, isCanvasInputSourceActive } from '@atlas/scene';
import { useStore } from '../store';
import { coastEnabled, setComfort, useComfort, type Comfort } from '../motion/comfort';
import { cue } from './feedback';
import { playStore, usePlayStore, type PlayVerb } from './playStore';

export interface PlayTrayProps {
  id: string;
  /** The Play button: focus returns to it, and a tap on it is not "outside". */
  anchorRef: RefObject<HTMLElement | null>;
  onClose(options?: { restoreFocus?: boolean }): void;
}

const MOTION_OPTIONS: ReadonlyArray<{ value: Comfort; label: string }> = [
  { value: 'standard', label: 'Standard' },
  { value: 'gentle', label: 'Gentle' },
  { value: 'still', label: 'Still' },
];

interface TrayItemProps {
  role: 'menuitem' | 'menuitemradio';
  checked?: boolean;
  disabled?: boolean;
  hint?: string;
  onSelect(): void;
  children: ReactNode;
}

function TrayItem({ role, checked, disabled, hint, onSelect, children }: TrayItemProps) {
  return (
    <button
      type="button"
      role={role}
      tabIndex={-1}
      className="lupi-play-tray__item"
      aria-checked={role === 'menuitemradio' ? Boolean(checked) : undefined}
      aria-disabled={disabled || undefined}
      title={disabled && hint ? hint : undefined}
      onClick={() => {
        if (!disabled) onSelect();
      }}
    >
      <span className="lupi-play-tray__item-label">{children}</span>
      {hint && disabled ? <small className="lupi-play-tray__hint">{hint}</small> : null}
    </button>
  );
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'));
}

export function PlayTray({ id, anchorRef, onClose }: PlayTrayProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const verb = usePlayStore((state) => state.verb);
  const comfort = useComfort();
  const still = comfort === 'still';
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Focus the current one-finger verb when the tray opens (APG menu pattern).
  useEffect(() => {
    const items = menuItems(menuRef.current);
    const checked = items.find((item) => item.getAttribute('aria-checked') === 'true');
    (checked ?? items[0])?.focus({ preventScroll: true });
  }, []);

  // A tap anywhere outside the tray and its Play button closes it.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      // A right click on the canvas toggles the tray itself (play.toggleTray
      // on release): closing it here would only reopen it.
      if (event.button === 2 && target instanceof HTMLCanvasElement && isCanvasInputSourceActive()) return;
      closeRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchorRef]);

  const chooseVerb = (next: PlayVerb) => {
    playStore.getState().setVerb(next);
    onClose({ restoreFocus: true });
  };
  const run = (intent: 'play.scatter' | 'play.spin' | 'play.reset') => {
    emitIntent({ type: intent });
    if (intent === 'play.reset') cue('reset');
    onClose({ restoreFocus: true });
  };
  const openSettings = () => {
    // The store subscription in PlayPill closes the tray as the panel opens.
    onClose();
    useStore.getState().setActivePanel('settings');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus({ preventScroll: true });
    };
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        focusAt(index < 0 ? 0 : index + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        focusAt(index < 0 ? items.length - 1 : index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
      case 'Escape':
        // Only close the tray: the global Escape would also reset the toys.
        event.preventDefault();
        event.stopPropagation();
        onClose({ restoreFocus: true });
        break;
      case 'Tab':
        event.preventDefault();
        onClose({ restoreFocus: true });
        break;
      default:
        break;
    }
  };

  const stillHint = 'Off in Still';
  return (
    <div
      id={id}
      ref={menuRef}
      role="menu"
      aria-label="Play: toys and view"
      className="lupi-play-tray"
      onKeyDown={onKeyDown}
    >
      <div role="group" aria-labelledby={`${id}-finger`} className="lupi-play-tray__row">
        <span id={`${id}-finger`} className="lupi-play-tray__label">One finger</span>
        <TrayItem role="menuitemradio" checked={verb === 'orbit'} onSelect={() => chooseVerb('orbit')}>
          Orbit
        </TrayItem>
        <TrayItem
          role="menuitemradio"
          checked={verb === 'poke'}
          disabled={still}
          hint={stillHint}
          onSelect={() => chooseVerb('poke')}
        >
          Poke
        </TrayItem>
      </div>
      <div role="group" aria-labelledby={`${id}-try`} className="lupi-play-tray__row">
        <span id={`${id}-try`} className="lupi-play-tray__label">Try</span>
        <TrayItem role="menuitem" disabled={still} hint={stillHint} onSelect={() => run('play.scatter')}>
          Scatter
        </TrayItem>
        <TrayItem
          role="menuitem"
          disabled={!coastEnabled(comfort)}
          hint="Needs Standard"
          onSelect={() => run('play.spin')}
        >
          Spin
        </TrayItem>
        <TrayItem role="menuitem" onSelect={() => run('play.reset')}>
          Reset
        </TrayItem>
      </div>
      <div role="group" aria-labelledby={`${id}-motion`} className="lupi-play-tray__row">
        <span id={`${id}-motion`} className="lupi-play-tray__label">Motion</span>
        {MOTION_OPTIONS.map((option) => (
          <TrayItem
            key={option.value}
            role="menuitemradio"
            checked={comfort === option.value}
            onSelect={() => setComfort(option.value)}
          >
            {option.label}
          </TrayItem>
        ))}
      </div>
      <div role="none" className="lupi-play-tray__row lupi-play-tray__row--end">
        <TrayItem role="menuitem" onSelect={openSettings}>
          Settings…
        </TrayItem>
      </div>
    </div>
  );
}
