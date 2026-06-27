/**
 * Shared leaf icons — zero local dependencies, so any component can import these
 * without the circular-dependency dance that previously bred a copy of each
 * glyph in every file. Add genuinely shared, reused glyphs here; keep one-off
 * decorative icons local to their component.
 */

export function IconClose({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
