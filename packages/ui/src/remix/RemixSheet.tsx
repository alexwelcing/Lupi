/**
 * RemixSheet — the code behind the look: roll, read, copy, share, type.
 *
 * Opened from the code chip in the Play tray, the pill's Foil chip, the deck
 * and the palette. It never hides the molecule: no veil, a card beside the
 * view on desktop and a short bottom sheet on a phone (the view lifts into
 * the band above it), so every roll morphs in plain sight.
 *
 * - **The code** (`r1-K7QDM`), foil-bordered when it carries a finish, with
 *   its status: exactly this look, edited, or no code yet.
 * - **Roll** (M), **Undo** (Shift+M), **Copy code**, **Share look** (a link
 *   that opens this molecule in this look; the code alone without one).
 * - **Type or paste a code**: `r1-K7QDM`, `k7qdm`, or a whole link.
 * - **Finishes**, at their published odds: the code's own, or one the
 *   visitor has found on this device (or all, with "Show all finishes").
 * - **Preferences**: keep atom colours (on: CPK stays CPK), worlds and
 *   motion, and shake to roll on phones (off until switched on here).
 */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useStore } from '../store';
import { setBottomOccluder } from '../camera/viewInset';
import { useComfort } from '../motion/comfort';
import {
  FOIL_DESCRIPTION,
  FOIL_KINDS,
  FOIL_LABEL,
  FOIL_ODDS_TEXT,
  parseRemixCode,
  remixFoil,
  remixParseMessage,
  type FoilKind,
} from './code';
import {
  applyRemixCode,
  closeRemixSheet,
  describeRemix,
  remixCodeStatus,
  remixHistoryDepth,
  rollRemix,
  subscribeRemixHistory,
  undoRemix,
} from './actions';
import { remixLink } from './links';
import { remixStore, selectableFinishes, shownFinish, useRemixStore } from './remixStore';
import { disableShake, enableShake, shakeSupported } from './shake';
import './remixSheet.css';

function copyText(text: string): boolean {
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => undefined);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

function useHistoryDepth(): number {
  return useSyncExternalStore(subscribeRemixHistory, remixHistoryDepth, () => 0);
}

export function RemixSheet() {
  const open = useRemixStore((state) => state.sheetOpen);
  if (!open) return null;
  return <RemixSheetBody />;
}

const SHAKE_LABEL: Record<string, string> = {
  off: 'Off',
  arming: 'Tap anywhere to allow',
  on: 'On · shake to roll',
  denied: 'Not allowed in this browser',
  unsupported: 'This device doesn’t report motion',
};

function RemixSheetBody() {
  const titleId = useId();
  const inputId = useId();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const comfort = useComfort();
  const applied = useRemixStore((state) => state.applied);
  const chosenFinish = useRemixStore((state) => state.chosenFinish);
  const found = useRemixStore((state) => state.found);
  const showAll = useRemixStore((state) => state.showAllFinishes);
  const keepColors = useRemixStore((state) => state.keepColors);
  const worlds = useRemixStore((state) => state.worlds);
  const shakePreferred = useRemixStore((state) => state.shakePreferred);
  const shake = useRemixStore((state) => state.shake);
  const status = useStore((state) => remixCodeStatus(state, applied));
  const historyDepth = useHistoryDepth();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const finish = shownFinish({ applied, chosenFinish });
  const selectable = selectableFinishes({ found, showAllFinishes: showAll });
  const code = applied?.code ?? null;
  const link = code ? remixLink(code) : null;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const offerShake = shakeSupported();

  const close = useCallback(() => {
    closeRemixSheet();
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-lupi-pill] .lupi-play-pill__play-button')?.focus({ preventScroll: true });
    });
  }, []);

  // Esc closes; focus starts on Roll.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    cardRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  // A panel or the tray opening closes the sheet (one surface at a time).
  useEffect(
    () => useStore.subscribe((state, previous) => {
      if (state.activePanel && state.activePanel !== previous.activePanel) closeRemixSheet();
    }),
    [],
  );

  // On a phone the view lifts into the band above the sheet.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof ResizeObserver === 'undefined') return undefined;
    const report = () => {
      const phone = window.matchMedia?.('(max-width: 640px)').matches ?? false;
      setBottomOccluder(phone ? card.getBoundingClientRect().top : null);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(card);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      setBottomOccluder(null);
    };
  }, []);

  const flashCopied = (what: 'code' | 'link') => {
    setCopied(what);
    setTimeout(() => setCopied((current) => (current === what ? null : current)), 1600);
  };

  const onRoll = () => {
    setError('');
    rollRemix('sheet');
  };
  const onCopyCode = () => {
    if (code && copyText(code.text)) flashCopied('code');
  };
  const onCopyLink = () => {
    if (link && copyText(link)) flashCopied('link');
  };
  const onShare = () => {
    if (!code) return;
    const text = `My Lupi look: ${code.text}${finish && applied?.foil ? ` (${FOIL_LABEL[finish]} foil)` : ''}`;
    if (!navigator.share) {
      onCopyLink();
      return;
    }
    navigator.share(link ? { title: 'A Lupi look', text, url: link } : { title: 'A Lupi look', text }).catch(() => undefined);
  };
  const onApply = (event: FormEvent) => {
    event.preventDefault();
    const parse = parseRemixCode(typed);
    if (!parse.ok) {
      setError(remixParseMessage(parse));
      return;
    }
    setError('');
    setTyped('');
    applyRemixCode(parse.code, 'sheet');
  };
  const chooseFinish = (kind: FoilKind | null) => remixStore.getState().setChosenFinish(kind);
  const onShake = (on: boolean) => {
    if (on) void enableShake();
    else disableShake();
  };

  const statusText = !code
    ? 'No code yet: roll one, or type a code someone sent you.'
    : status === 'exact'
      ? 'This is exactly the look on screen. The code makes it on any device, on any molecule.'
      : 'You’ve tweaked it since: the code makes the look as it was rolled.';
  const typedPreview = (() => {
    const parse = parseRemixCode(typed);
    return parse.ok ? remixFoil(parse.code) : null;
  })();

  return (
    <div
      ref={cardRef}
      className="lupi-remix-sheet"
      data-lupi-remix-sheet=""
      data-still={comfort === 'still' || undefined}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
    >
      <button type="button" className="lupi-remix-sheet__close" aria-label="Close" onClick={close}>
        <span aria-hidden="true">×</span>
      </button>
      <h2 id={titleId} className="lupi-remix-sheet__title">Remix</h2>

      <div className="lupi-remix-sheet__code-row">
        <output
          className="lupi-remix-sheet__code"
          data-foil={applied?.foil ?? undefined}
          data-empty={!code || undefined}
          aria-label={code ? describeRemix(code, applied?.foil ?? null) : 'No code yet'}
        >
          <span className="lupi-remix-sheet__code-text">{code ? code.text : 'r1-·····'}</span>
          {applied?.foil && <span className="lupi-remix-sheet__code-foil">{FOIL_LABEL[applied.foil]}</span>}
          {code && status === 'edited' && <span className="lupi-remix-sheet__code-edited">edited</span>}
        </output>
        <div className="lupi-remix-sheet__code-actions">
          <button type="button" className="lupi-remix-sheet__button lupi-remix-sheet__button--primary" data-autofocus="" onClick={onRoll} title="Roll a new look (M)">
            Roll <span aria-hidden="true">⟳</span>
          </button>
          <button type="button" className="lupi-remix-sheet__button" onClick={() => undoRemix()} disabled={historyDepth === 0} title="Back to the previous look (Shift+M)">
            Undo
          </button>
        </div>
      </div>
      <p className="lupi-remix-sheet__note">{statusText}</p>

      {code && (
        <div className="lupi-remix-sheet__actions">
          <button type="button" className="lupi-remix-sheet__button" onClick={onCopyCode}>
            {copied === 'code' ? 'Copied ✓' : 'Copy code'}
          </button>
          {link && (
            <button type="button" className="lupi-remix-sheet__button" onClick={onCopyLink}>
              {copied === 'link' ? 'Copied ✓' : 'Copy link'}
            </button>
          )}
          {canShare && (
            <button type="button" className="lupi-remix-sheet__button" onClick={onShare}>
              Share look
            </button>
          )}
        </div>
      )}

      <form className="lupi-remix-sheet__type" onSubmit={onApply}>
        <label htmlFor={inputId} className="lupi-remix-sheet__label">Type or paste a code</label>
        <div className="lupi-remix-sheet__type-row">
          <input
            id={inputId}
            className="lupi-remix-sheet__field"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              if (error) setError('');
            }}
            placeholder="r1-K7QDM"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
          />
          <button type="submit" className="lupi-remix-sheet__button" disabled={!typed.trim()}>
            Apply{typedPreview ? ` · ${FOIL_LABEL[typedPreview]}` : ''}
          </button>
        </div>
        {error && <p id={`${inputId}-error`} className="lupi-remix-sheet__error" role="alert">{error}</p>}
      </form>

      <section className="lupi-remix-sheet__section" aria-labelledby={`${titleId}-finish`}>
        <h3 id={`${titleId}-finish`} className="lupi-remix-sheet__label">Finish</h3>
        <div className="lupi-remix-sheet__chips" role="radiogroup" aria-labelledby={`${titleId}-finish`}>
          <button
            type="button"
            role="radio"
            aria-checked={!chosenFinish}
            className="lupi-remix-sheet__chip"
            onClick={() => chooseFinish(null)}
            title={applied?.foil ? `This code’s own finish: ${FOIL_LABEL[applied.foil]}` : 'Only codes that carry a foil show one'}
          >
            {applied?.foil ? `Code’s · ${FOIL_LABEL[applied.foil]}` : 'From the code'}
          </button>
          {FOIL_KINDS.map((kind) => {
            const available = selectable.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={chosenFinish === kind}
                aria-disabled={!available || undefined}
                className="lupi-remix-sheet__chip"
                data-foil={kind}
                onClick={() => {
                  if (available) chooseFinish(chosenFinish === kind ? null : kind);
                }}
                title={available ? `${FOIL_LABEL[kind]}: ${FOIL_DESCRIPTION[kind]}` : `Roll a ${FOIL_LABEL[kind]} foil to keep it (or show all finishes)`}
              >
                {FOIL_LABEL[kind]}
                {found.includes(kind) && <span className="lupi-remix-sheet__found" aria-label="found">✓</span>}
              </button>
            );
          })}
        </div>
        <p className="lupi-remix-sheet__odds">
          {FOIL_ODDS_TEXT}. Rolls are free and unlimited; nothing is counted. A finish you roll stays yours on this device.
        </p>
        <p className="lupi-remix-sheet__honest">
          {finish ? `${FOIL_LABEL[finish]} · cosmetic finish. ` : ''}Atom colours and positions are unchanged. Exports and MCP images never carry a finish.
        </p>
      </section>

      <section className="lupi-remix-sheet__section lupi-remix-sheet__prefs" aria-label="Remix preferences">
        <label className="lupi-remix-sheet__toggle">
          <input type="checkbox" checked={keepColors} onChange={(event) => remixStore.getState().setKeepColors(event.target.checked)} />
          <span>Keep atom colours <small>(off: each roll paints a decorative palette)</small></span>
        </label>
        <label className="lupi-remix-sheet__toggle">
          <input type="checkbox" checked={worlds} onChange={(event) => remixStore.getState().setWorlds(event.target.checked)} />
          <span>Worlds &amp; moving backdrops <small>(may load images)</small></span>
        </label>
        <label className="lupi-remix-sheet__toggle">
          <input type="checkbox" checked={showAll} onChange={(event) => remixStore.getState().setShowAllFinishes(event.target.checked)} />
          <span>Show all finishes <small>(no rolling needed)</small></span>
        </label>
        {offerShake && (
          <label className="lupi-remix-sheet__toggle">
            <input type="checkbox" checked={shakePreferred && shake !== 'denied'} onChange={(event) => onShake(event.target.checked)} />
            <span>Shake to roll <small>({SHAKE_LABEL[shakePreferred ? shake : 'off']})</small></span>
          </label>
        )}
      </section>
    </div>
  );
}
