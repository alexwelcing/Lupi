/**
 * PlayTray — the short menu the Play pill opens (also `P`, a right click on
 * empty canvas, and the palette's "Open Play"):
 *
 *   One finger   Orbit · Poke · Tug
 *                Burst · Heat
 *   Try          Scatter · Spin · Reset
 *   Look         Remix ⟳ · r1-K7QDM (the code: copy, share, type one)
 *                Foil 1 in 24 · each finish 1 in 72
 *   Motion       Standard · Gentle · Still
 *                Replay ↗ · Settings…
 *
 * Remix keeps the tray open, so the next roll is one more tap away.
 *
 * A `role="menu"` anchored above the pill. Arrow keys, Home and End move
 * between items, Enter and Space activate, Escape (or Tab, or a tap outside)
 * closes. Every item is at least 44 px tall. Toys only emit intents; Motion
 * writes `comfort.ts`, never the viewer store, URLs or saved views.
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { emitIntent, isCanvasInputSourceActive } from '@atlas/scene';
import { useStore } from '../store';
import { pressButton } from '../camera/gestureArbiter';
import { coastEnabled, setComfort, useComfort, type Comfort } from '../motion/comfort';
import { cue } from './feedback';
import { openReplaySheet } from '../replay/actions';
import { openRemixSheet, rollRemix, undoRemix } from '../remix/actions';
import { FOIL_LABEL, FOIL_ODDS_TEXT } from '../remix/code';
import { useRemixStore } from '../remix/remixStore';
import { PLAY_VERBS, PLAY_VERB_LABEL, playStore, usePlayStore, type PlayVerb } from './playStore';

export interface PlayTrayProps {
  id: string;
  /** The Play button: focus returns to it, and a tap on it is not "outside". */
  anchorRef: RefObject<HTMLElement | null>;
  onClose(options?: { restoreFocus?: boolean }): void;
}

/** What each verb does, for the item's tooltip and accessible description. */
const VERB_TITLE: Readonly<Record<PlayVerb, string>> = {
  orbit: 'One finger turns the molecule',
  poke: 'Drag to stir; tap an atom to ring it (Enter rings the selected atom)',
  tug: 'Drag an atom; its neighbours follow and spring back (Enter plucks the selected atom)',
  burst: 'Tap to pop the atoms outward; they spring back (Enter pops at the selected atom)',
  heat: 'Hold to warm it up; let go to cool (or hold Enter)',
};

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
  /** Tooltip while enabled. */
  title?: string;
  verb?: PlayVerb;
  /** A Foil code's finish (the code item wears it). */
  foil?: string;
  ariaLabel?: string;
  onSelect(): void;
  children: ReactNode;
}

function TrayItem({ role, checked, disabled, hint, title, verb, foil, ariaLabel, onSelect, children }: TrayItemProps) {
  return (
    <button
      type="button"
      role={role}
      tabIndex={-1}
      className="lupi-play-tray__item"
      data-verb={verb}
      data-foil={foil}
      aria-label={ariaLabel}
      aria-checked={role === 'menuitemradio' ? Boolean(checked) : undefined}
      aria-disabled={disabled || undefined}
      title={disabled && hint ? hint : title}
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
  const applied = useRemixStore((state) => state.applied);
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
      // on release): closing it here would only reopen it. A Mac ctrl+click is one.
      if (pressButton(event) === 2 && target instanceof HTMLCanvasElement && isCanvasInputSourceActive()) return;
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
  // Remix: roll in place (the tray stays open for the next roll).
  const roll = () => {
    rollRemix('tray');
  };
  const openCodes = () => {
    onClose();
    openRemixSheet();
  };
  // Instant Replay: the last moment (or this view) as a link and a clip.
  const openReplay = () => {
    onClose();
    openReplaySheet();
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
      case 'm':
      case 'M':
        // M rolls a Remix (Shift+M steps back), as it does outside the tray.
        if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) break;
        event.preventDefault();
        if (event.shiftKey) undoRemix();
        else rollRemix('tray');
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
      <div role="group" aria-labelledby={`${id}-finger`} className="lupi-play-tray__row lupi-play-tray__row--verbs">
        <span id={`${id}-finger`} className="lupi-play-tray__label">One finger</span>
        {PLAY_VERBS.map((option) => (
          <TrayItem
            key={option}
            role="menuitemradio"
            verb={option}
            checked={verb === option}
            disabled={option !== 'orbit' && still}
            hint={stillHint}
            title={VERB_TITLE[option]}
            onSelect={() => chooseVerb(option)}
          >
            {PLAY_VERB_LABEL[option]}
          </TrayItem>
        ))}
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
      <div role="group" aria-labelledby={`${id}-look`} className="lupi-play-tray__row lupi-play-tray__row--look">
        <span id={`${id}-look`} className="lupi-play-tray__label">Look</span>
        <TrayItem
          role="menuitem"
          title={`Roll a new look (M). ${FOIL_ODDS_TEXT}.`}
          ariaLabel={`Remix: roll a new look. ${FOIL_ODDS_TEXT}.`}
          onSelect={roll}
        >
          Remix ⟳
        </TrayItem>
        <TrayItem
          role="menuitem"
          foil={applied?.foil ?? undefined}
          title="The code for this look: copy it, share it, or type one in"
          ariaLabel={applied
            ? `Remix code ${applied.code.text}${applied.foil ? `, ${FOIL_LABEL[applied.foil]} finish` : ''}: copy, share or type a code`
            : 'Remix codes: type a code, finishes and shake to roll'}
          onSelect={openCodes}
        >
          <span className="lupi-play-tray__code">{applied ? applied.code.text : 'Codes…'}</span>
          {applied?.foil ? <small className="lupi-play-tray__hint lupi-play-tray__foil">{FOIL_LABEL[applied.foil]}</small> : null}
        </TrayItem>
        <span className="lupi-play-tray__note" aria-hidden="true">{FOIL_ODDS_TEXT}</span>
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
        <TrayItem
          role="menuitem"
          title={still ? 'Share this view as a link (R)' : 'Replay the last moment: a live link and a 9:16 clip (R)'}
          onSelect={openReplay}
        >
          {still ? 'Share ↗' : 'Replay ↗'}
        </TrayItem>
        <TrayItem role="menuitem" onSelect={openSettings}>
          Settings…
        </TrayItem>
      </div>
    </div>
  );
}
