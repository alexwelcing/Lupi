/**
 * feedback.ts — the cue router for toy feedback (sound and haptics).
 * WP0 stub: silent. Sound and haptics stay off by default either way.
 */
export type CueKind = 'detent' | 'catch' | 'flip' | 'poke' | 'reset';

export function cue(kind: CueKind): void {
  void kind;
}
