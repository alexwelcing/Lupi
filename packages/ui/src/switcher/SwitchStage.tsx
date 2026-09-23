/**
 * The search's stage: type "candy" and, while the results come in, the
 * particles form candy. A word or two goes to the gist route with no
 * photo, the model sketches what that thing looks like, the particles whirl
 * and settle onto it, and Jev sculpts it closer over the next seconds, the
 * likeness on the label. Picking a result opens the molecule as it always
 * has; the molecule itself never gets the effect.
 *
 * The strip stays collapsed until there is something to form. It skips
 * text that is a formula or a single element, since those are not things,
 * and it disappears for good in a session where the edge reports the
 * sketcher is not configured, so a deployment without keys shows the plain
 * search it always did.
 */
import { useEffect, useRef, useState } from 'react';
import type { Gist } from '@atlas/core/gist';
import { GistStage, type StageLabel } from '../scan/gist/GistStage';
import { requestGistText } from '../scan/gist/gistClient';
import { startSculptLoop, type SculptEvent, type SculptLoopHandle } from '../scan/gist/sculptLoop';
// The stage's own styles live with the scanner; the strip scales them down.
import '../scan/scan.css';

/** How long the typing has to pause before the sketch is asked for. */
const SETTLE_MS = 380;
const MIN_CHARS = 3;
/** A formula (C8H10N4O2), an element (Fe), or anything with digits: not a thing to form. */
const NOT_A_THING = /^(?:[A-Z][a-z]?\d*)+$|\d/;

export function isFormableQuery(query: string): boolean {
  const text = query.trim();
  if (text.length < MIN_CHARS) return false;
  if (NOT_A_THING.test(text)) return false;
  return /[a-zA-Z]{3,}/.test(text);
}

interface SwitchStageProps {
  query: string;
  compact?: boolean;
}

export function SwitchStage({ query, compact = false }: SwitchStageProps) {
  const [subject, setSubject] = useState<string | null>(null);
  const [gist, setGist] = useState<Gist | null>(null);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(true);
  const [events, setEvents] = useState<SculptEvent[]>([]);
  const [sculpting, setSculpting] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const sculpt = useRef<SculptLoopHandle | null>(null);

  // The subject is the query once typing has paused. Text that is not a
  // thing (cleared, too short, a formula) drops the subject at once, so the
  // stage collapses and nothing keeps working on the old word.
  useEffect(() => {
    if (!isFormableQuery(query)) {
      setSubject(null);
      return;
    }
    const timer = window.setTimeout(() => setSubject(query.trim().toLowerCase()), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    abort.current?.abort();
    sculpt.current?.stop();
    sculpt.current = null;
    if (!subject || !available) {
      setBusy(false);
      setGist(null);
      setEvents([]);
      setSculpting(false);
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setEvents([]);
    setSculpting(false);
    void requestGistText(subject, controller.signal)
      .then((reply) => {
        if (controller.signal.aborted) return;
        setBusy(false);
        if (reply?.configured === false) {
          setAvailable(false);
          return;
        }
        if (!reply?.gist || reply.gist.label.toLowerCase() === 'nothing') return;
        setGist(reply.gist);
        setSculpting(true);
        sculpt.current = startSculptLoop({
          subject,
          gist: reply.gist,
          onGist: (next) => setGist(next),
          onEvent: (event) => setEvents((previous) => [...previous, event]),
          onDone: () => setSculpting(false),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => {
      controller.abort();
      sculpt.current?.stop();
      sculpt.current = null;
    };
  }, [subject, available]);

  useEffect(
    () => () => {
      abort.current?.abort();
      sculpt.current?.stop();
    },
    [],
  );

  if (!available) return null;
  const on = Boolean(subject) && (busy || gist !== null);
  const likeness = [...events].reverse().find((event) => event.likeness !== null)?.likeness ?? null;
  const lastMove = [...events].reverse().find((event) => event.applied)?.move ?? null;
  const label: StageLabel | null = gist
    ? { text: gist.label, confidence: gist.confidence, likeness, judgments: events.length, lastMove, sculpting, model: events[events.length - 1]?.model }
    : null;
  return (
    <div className="switcher-stage" data-on={on} data-compact={compact} aria-hidden={!on}>
      {on && <GistStage photoUrl={null} active={busy} gist={gist} settled={!busy && gist !== null} status={null} label={label} />}
    </div>
  );
}
