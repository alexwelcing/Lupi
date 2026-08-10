import { describe, expect, it } from 'vitest';

import {
  isEmbeddedMobileViewerRoute,
  isMcpViewerRoute,
} from './viewerRoutes';

describe('embedded mobile viewer route', () => {
  it('matches only the exact embedded mobile hash route', () => {
    expect(isEmbeddedMobileViewerRoute('/embed/mobile')).toBe(true);
    expect(isEmbeddedMobileViewerRoute('/embed/mobile?source=expo')).toBe(true);
    expect(isEmbeddedMobileViewerRoute('/embed')).toBe(false);
    expect(isEmbeddedMobileViewerRoute('/embed/mobile/extra')).toBe(false);
    expect(isEmbeddedMobileViewerRoute('/mcp')).toBe(false);
  });

  it('does not use the visible MCP harness as its bridge surface', () => {
    expect(isMcpViewerRoute('/embed/mobile', '')).toBe(false);
    expect(isMcpViewerRoute('/mcp', '')).toBe(true);
  });
});
