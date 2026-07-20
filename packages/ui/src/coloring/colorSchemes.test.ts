import { describe, expect, it } from 'vitest';
import { pickInitialScheme } from './colorSchemes';

describe('initial atom color semantics', () => {
  it('uses element colors only when the frame has complete element identity', () => {
    expect(pickInitialScheme({
      hasProperty: false,
      uniqueTypes: 2,
      hasElementIdentity: true,
    })).toBe('element');
  });

  it('uses a non-chemical colorway for opaque raw type IDs', () => {
    expect(pickInitialScheme({
      hasProperty: true,
      uniqueTypes: 3,
      hasElementIdentity: false,
    })).toBe('colorway');
  });
});
