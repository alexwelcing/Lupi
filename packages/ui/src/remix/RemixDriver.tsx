/**
 * RemixDriver — the DOM half of Remix codes, mounted with a molecule.
 *
 * - **Links.** A `?remix=` code (taken from the address bar at boot) lands
 *   once the molecule is open, at once (the arrival is already moving).
 * - **Your look follows you.** Opening another molecule re-applies the code
 *   on screen over that molecule's opening look, Foil included.
 * - **Code status.** A code stays on screen while its backdrop and recipe
 *   do; a Look, a saved view or anything else that replaces them retires it
 *   (and its Foil). Ignored while a morph runs.
 * - **Paste anywhere.** A pasted `r1-…` code or `remix=` link (outside text
 *   fields) applies that look.
 * - **Shake to roll**, when the visitor turned it on (shake.ts).
 */
import { useEffect } from 'react';
import { useStore } from '../store';
import { playStore } from '../play/playStore';
import { findRemixCodeInText, remixParseMessage } from './code';
import { applyRemixCode, remixCodeStatus, rollRemix } from './actions';
import { isLookMorphing } from './lookMorph';
import { takePendingRemix } from './links';
import { remixStore } from './remixStore';
import { remixPatchForCode } from '../sceneRemix';
import { resumeShake, setShakeHandler } from './shake';

function isTextTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== 'function') return false;
  return element.isContentEditable || Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
}

export function RemixDriver(): null {
  // A link's code, once the molecule is open.
  useEffect(() => {
    const parse = takePendingRemix();
    if (parse?.ok) {
      // A shared look lands at once; the arrival is the motion.
      applyRemixCode(parse.code, 'link');
      return;
    }
    if (parse) playStore.getState().flashText(remixParseMessage(parse), 'info', 3200);
    // Back from no molecule to a new one: the code on screen comes along.
    const remix = remixStore.getState();
    const state = useStore.getState();
    if (remix.applied && remixCodeStatus(state, remix.applied) === 'gone') {
      const patch = remixPatchForCode(remix.applied.code, state);
      useStore.setState(patch);
      remix.setApplied({ ...remix.applied, patch });
    }
  }, []);

  // Code status, and the look following the visitor to the next molecule.
  useEffect(
    () => useStore.subscribe((state, previous) => {
      const remix = remixStore.getState();
      const applied = remix.applied;
      if (!applied) return;
      if (state.file !== previous.file && state.file) {
        // A new molecule opened with its own look: put the code's back.
        const patch = remixPatchForCode(applied.code, state);
        useStore.setState(patch);
        remix.setApplied({ ...applied, patch });
        return;
      }
      if (isLookMorphing()) return;
      if (remixCodeStatus(state, applied) === 'gone') remix.setApplied(null);
    }),
    [],
  );

  // A pasted code applies its look.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTextTarget(event.target)) return;
      const text = event.clipboardData?.getData('text') ?? '';
      const parse = findRemixCodeInText(text);
      if (!parse) return;
      event.preventDefault();
      if (parse.ok) applyRemixCode(parse.code, 'paste');
      else playStore.getState().flashText(remixParseMessage(parse), 'info', 3200);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  // Shake to roll, when it is on.
  useEffect(() => {
    setShakeHandler(() => rollRemix('shake'));
    const stop = resumeShake();
    return () => {
      setShakeHandler(null);
      stop();
    };
  }, []);

  return null;
}
