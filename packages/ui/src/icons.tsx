/**
 * Shared leaf icons — zero local dependencies, so any component can import these
 * without the circular-dependency dance that previously bred a copy of each
 * glyph in every file. Add genuinely shared, reused glyphs here; keep one-off
 * decorative icons local to their component.
 */
import type { ReactNode } from 'react';

export function IconClose({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

// ─── Playback transport ───────────────────────────────────────────────
// Play/Pause are reused across the media bar, flythrough preview, hero CTA,
// and the world-home shuffler — one definition, sized per call site.
export function IconPlay({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

export function IconPause({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

// ─── Lupi toolbar glyphs ──────────────────────────────────────────────
// Specimen-frame linework, not emoji or generic app art. The corner ticks
// are the shared frame; each glyph fills in its own subject. Used by both the
// desktop dock (ViewerControlsDrawer) and the mobile chrome (App).
export function LupiGlyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.5 7.25V4.5h2.75" opacity="0.46" />
      <path d="M16.75 4.5h2.75v2.75" opacity="0.46" />
      <path d="M19.5 16.75v2.75h-2.75" opacity="0.46" />
      <path d="M7.25 19.5H4.5v-2.75" opacity="0.46" />
      {children}
    </svg>
  );
}

export function IconControls() {
  return (
    <LupiGlyph>
      <path d="M7 8.2h10" />
      <path d="M7 12h10" opacity="0.82" />
      <path d="M7 15.8h10" opacity="0.64" />
      <circle cx="10" cy="8.2" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="14.2" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="11.7" cy="15.8" r="1.15" fill="currentColor" stroke="none" />
    </LupiGlyph>
  );
}
