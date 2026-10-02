/**
 * FirstFrameOverlay — the sage plate over a canvas that has not drawn its
 * molecule yet, when no relay stage covers the page (deep links, Back, a
 * library open): the same preview and ring as the "Opening…" plate before
 * it, until the first frame lands, then a 120 ms fade. Never takes input.
 *
 * A fresh canvas shows it at once, in the same commit that retires the
 * "Opening…" plate, so nothing flashes between them. A molecule switch inside
 * a running viewer shows it only when the first frame is slow (250 ms), so a
 * quick switch never blinks.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { isRelayActive } from './baton';
import { hasFirstFrame, onFirstFrame } from './firstFrame';
import { RelayPlate } from './RelayPlate';

const SWITCH_DELAY_MS = 250;
const FADE_MS = 120;

type Phase = 'hidden' | 'shown' | 'fading';

export function FirstFrameOverlay() {
  const trajectory = useStore((state) => state.file?.trajectory ?? null);
  const galleryId = useStore((state) => state.activeCardId);
  const seen = useRef(false);
  const [phase, setPhase] = useState<Phase>(() => {
    if (!trajectory || hasFirstFrame(trajectory) || isRelayActive()) return 'hidden';
    seen.current = true;
    return 'shown';
  });

  useEffect(() => {
    if (!trajectory) {
      setPhase('hidden');
      return undefined;
    }
    const retire = () => setPhase((p) => (p === 'shown' ? 'fading' : p));
    const first = !seen.current;
    seen.current = true;
    if (hasFirstFrame(trajectory)) {
      retire();
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cover = () => {
      if (!hasFirstFrame(trajectory) && !isRelayActive()) setPhase('shown');
    };
    if (first) cover();
    else timer = setTimeout(cover, SWITCH_DELAY_MS);
    const off = onFirstFrame((key) => {
      if (key === trajectory) retire();
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [trajectory]);

  useEffect(() => {
    if (phase !== 'fading') return undefined;
    const timer = setTimeout(() => setPhase('hidden'), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === 'hidden') return null;
  return <RelayPlate galleryId={galleryId} copy="Opening…" inViewport fading={phase === 'fading'} />;
}
