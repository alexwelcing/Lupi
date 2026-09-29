/**
 * landingIntent.ts — what the landing page may ask of its host: warm the
 * viewer chunks once a visitor shows intent (the hero's first real spin or a
 * hover dwell), never on scroll. Default: a no-op (inside the viewer).
 *
 * Contract file: additive edits only.
 */
import { createContext } from 'react';

export const LandingIntentContext = createContext<{ prefetchViewer(): void }>({
  prefetchViewer() {},
});
