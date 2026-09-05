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
// are the shared frame; each glyph fills in its own subject. Used throughout
// the viewer command deck and its context panels.
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

// Optical action family: the viewer's specimen frame, with orbital linework.
export function IconRemix() {
  return <LupiGlyph><path d="M7 10c1-4 8-4 10 0M17 14c-1 4-8 4-10 0" />
    <path d="m14 8 3 2 1-3M10 16l-3-2-1 3" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /></LupiGlyph>;
}
export function IconOptics() {
  return <LupiGlyph><ellipse cx="12" cy="12" rx="6" ry="2.6" transform="rotate(-40 12 12)" />
    <ellipse cx="12" cy="12" rx="2.6" ry="6" transform="rotate(-40 12 12)" opacity=".6" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /></LupiGlyph>;
}
export function IconRecenter() {
  return <LupiGlyph><circle cx="12" cy="12" r="3.1" />
    <path d="M12 5v2M19 12h-2M12 19v-2M5 12h2" /></LupiGlyph>;
}
export function IconUndo() {
  return <LupiGlyph><path d="M7 10h6a4 4 0 1 1 0 8M10 7l-3 3 3 3" /></LupiGlyph>;
}
export function IconTick() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="m6 12 4 4 8-9" /></svg>;
}
export function IconBack() {
  return <LupiGlyph><path d="M18 12H6m5-5-5 5 5 5" /></LupiGlyph>;
}

// ─── Transport arrows ─────────────────────────────────────────────────
export function IconFirst({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 4v16M10 12l8-6v12l-8-6z" />
    </svg>
  );
}

export function IconPrev({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M19 20L9 12l10-8v16z" />
    </svg>
  );
}

export function IconNext({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 4l10 8-10 8V4z" />
    </svg>
  );
}

export function IconLast({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 4v16M14 12L6 6v12l8-6z" />
    </svg>
  );
}

// ─── Tool-rail glyphs ─────────────────────────────────────────────────
export function IconStudy() {
  return (
    <LupiGlyph>
      <path d="M7.2 7.4h4.2c1.1 0 2 .9 2 2v7.2H9.2c-1.1 0-2-.9-2-2V7.4Z" />
      <path d="M13.4 9.4c.38-.32.88-.5 1.42-.5h2v7.2h-2c-.54 0-1.04.18-1.42.5" opacity="0.72" />
      <path d="M9.1 10.2h2.1" opacity="0.7" />
      <path d="M9.1 12.7h2.1" opacity="0.52" />
    </LupiGlyph>
  );
}

export function IconFlythrough() {
  return (
    <LupiGlyph>
      <path d="M7.1 15.8c1.92-3.9 5.25-6.42 9.8-7.6" />
      <path d="M12.4 7.2h4.5v4.5" />
      <circle cx="7.35" cy="15.85" r="1.35" />
      <circle cx="16.9" cy="8.2" r="1.35" />
      <path d="M9.2 13.1c1.6.82 3.22.7 4.86-.36" opacity="0.56" />
    </LupiGlyph>
  );
}

export function IconTelemetryTool() {
  return (
    <LupiGlyph>
      <path d="M7 15.9h10" opacity="0.54" />
      <path d="M7.5 14.1l2.1-3 2.15 1.85 2.6-4.45 2.15 2.8" />
      <path d="M7 7.4h2.2" opacity="0.54" />
      <path d="M14.8 17.2H17" opacity="0.54" />
    </LupiGlyph>
  );
}

export function IconExport() {
  return (
    <LupiGlyph>
      <path d="M7.1 8.3h6.3c1.28 0 2.32 1.04 2.32 2.32v4.58H7.1V8.3Z" />
      <path d="M9.1 8.3 10.2 6h3.1l1.1 2.3" opacity="0.7" />
      <circle cx="11.45" cy="12.05" r="1.45" />
      <path d="M15.4 6.6h2.5v2.5" />
      <path d="m17.9 6.6-4.2 4.2" />
    </LupiGlyph>
  );
}
