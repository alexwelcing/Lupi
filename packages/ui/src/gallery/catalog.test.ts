import { describe, expect, it } from 'vitest';
import {
  EXAMPLES,
  ALL_DOMAINS,
  DOMAIN_COLORS,
  DOMAIN_THREAD,
  gallerySnapshotUrl,
  parseFrameCountLabel,
  resolveExampleUrl,
} from './catalog';
import { FEATURED_IDS } from '../landing/shared';

/**
 * Catalog ⇄ gallery-data.json contract.
 *
 * Intentionally asserts STRUCTURE and INTERNAL CONSISTENCY, never exact
 * counts or a pinned domain list — that brittleness is exactly why the
 * previous gallery-data test was deleted. The point is to catch the failure
 * modes that actually break the gallery at runtime: an unknown `domain`
 * (DOMAIN_COLORS[domain] → undefined → the scene row paints with no thread
 * color), a duplicate/empty id (snapshot URL collisions, React key clashes),
 * a malformed colors tuple, or a featured id that no longer resolves.
 */
describe('gallery catalog contract', () => {
  it('has at least one example', () => {
    expect(EXAMPLES.length).toBeGreaterThan(0);
  });

  it('every example carries the fields the gallery renders', () => {
    for (const ex of EXAMPLES) {
      expect(typeof ex.id, `id on ${JSON.stringify(ex.title)}`).toBe('string');
      expect(ex.id.length, `non-empty id`).toBeGreaterThan(0);
      expect(typeof ex.title, `title on ${ex.id}`).toBe('string');
      expect(ex.title.length, `non-empty title on ${ex.id}`).toBeGreaterThan(0);
      expect(typeof ex.subtitle, `subtitle on ${ex.id}`).toBe('string');
      expect(typeof ex.file, `file on ${ex.id}`).toBe('string');
      expect(typeof ex.available, `available on ${ex.id}`).toBe('boolean');
    }
  });

  it('every domain resolves to a color + thread (no undefined lookups)', () => {
    for (const ex of EXAMPLES) {
      expect(ALL_DOMAINS, `domain "${ex.domain}" on ${ex.id} must be known`).toContain(ex.domain);
      expect(DOMAIN_COLORS[ex.domain], `DOMAIN_COLORS[${ex.domain}]`).toBeTruthy();
      expect(DOMAIN_THREAD[ex.domain], `DOMAIN_THREAD[${ex.domain}]`).toBeTruthy();
    }
  });

  it('ids are unique', () => {
    const seen = new Map<string, number>();
    for (const ex of EXAMPLES) seen.set(ex.id, (seen.get(ex.id) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(dupes, `duplicate ids: ${dupes.join(', ')}`).toHaveLength(0);
  });

  it('colors is a 3-tuple of CSS color strings', () => {
    for (const ex of EXAMPLES) {
      expect(Array.isArray(ex.colors), `colors array on ${ex.id}`).toBe(true);
      expect(ex.colors, `colors length on ${ex.id}`).toHaveLength(3);
      for (const c of ex.colors) {
        expect(typeof c, `color value on ${ex.id}`).toBe('string');
        expect(c.length, `non-empty color on ${ex.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('atoms / frames labels parse to finite, non-negative numbers', () => {
    for (const ex of EXAMPLES) {
      const frames = parseFrameCountLabel(ex.frames);
      expect(Number.isFinite(frames), `frames "${ex.frames}" on ${ex.id}`).toBe(true);
      expect(frames, `frames >= 0 on ${ex.id}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('every example produces a snapshot + resolvable source url', () => {
    for (const ex of EXAMPLES) {
      expect(gallerySnapshotUrl(ex.id), `snapshot url for ${ex.id}`).toBeTruthy();
      expect(resolveExampleUrl(ex), `resolved url for ${ex.id}`).toBeTruthy();
    }
  });

  it('every FEATURED_IDS entry resolves to a real example', () => {
    const ids = new Set(EXAMPLES.map((e) => e.id));
    const missing = FEATURED_IDS.filter((id) => !ids.has(id));
    expect(missing, `featured ids with no catalog entry: ${missing.join(', ')}`).toHaveLength(0);
  });
});
