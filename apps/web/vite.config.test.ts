import { describe, expect, it, vi } from 'vitest';
import { reactPerformanceTrackGuardPlugin, resolveLupiBrowserBuildSha } from './vite.config';

const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567';
const OTHER_SHA = '89abcdef0123456789abcdef0123456789abcdef';

describe('browser build SHA injection', () => {
  it('pins production builds to the checked-out exact SHA', () => {
    expect(resolveLupiBrowserBuildSha(
      'build',
      { VITE_LUPI_BUILD_SHA: HEAD_SHA.toUpperCase() },
      () => HEAD_SHA,
    )).toBe(HEAD_SHA);
    expect(resolveLupiBrowserBuildSha('build', {}, () => HEAD_SHA)).toBe(HEAD_SHA);
  });

  it('rejects malformed, mismatched, and unavailable production identity', () => {
    expect(() => resolveLupiBrowserBuildSha(
      'build',
      { VITE_LUPI_BUILD_SHA: 'main' },
      () => HEAD_SHA,
    )).toThrow(/exact 40-hex Git SHA/);
    expect(() => resolveLupiBrowserBuildSha(
      'build',
      { VITE_LUPI_BUILD_SHA: OTHER_SHA },
      () => HEAD_SHA,
    )).toThrow(/does not match the checked-out Git HEAD/);
    expect(() => resolveLupiBrowserBuildSha('build', {}, () => undefined)).toThrow(
      /Production web builds require VITE_LUPI_BUILD_SHA/,
    );
  });

  it('leaves ordinary development explicitly unpinned unless the caller pins it', () => {
    const readHead = vi.fn(() => HEAD_SHA);
    expect(resolveLupiBrowserBuildSha('serve', {}, readHead)).toBeUndefined();
    expect(readHead).not.toHaveBeenCalled();
    expect(resolveLupiBrowserBuildSha(
      'serve',
      { VITE_LUPI_BUILD_SHA: HEAD_SHA },
      readHead,
    )).toBe(HEAD_SHA);
  });
});

describe('development React performance-track guard', () => {
  it('runs before React and preserves an explicit profiling opt-in', () => {
    const plugin = reactPerformanceTrackGuardPlugin();
    const tags = plugin.transformIndexHtml.handler();
    expect(plugin.apply).toBe('serve');
    expect(plugin.transformIndexHtml.order).toBe('pre');
    expect(tags[0]).toMatchObject({ tag: 'script', injectTo: 'head-prepend' });
    expect(tags[0].children).toContain("get('reactProfile') === '1'");
    expect(tags[0].children).toContain("console, 'timeStamp'");
    expect(tags[0].children).toContain('__lupiReactPerformanceTracksDisabled');
  });
});
