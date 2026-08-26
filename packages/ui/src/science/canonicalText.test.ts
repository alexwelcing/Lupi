import { describe, expect, it } from 'vitest';
import { normalizeCanonicalLfText } from './canonicalText';

describe('canonical LF text materialization', () => {
  it('preserves canonical LF input byte-for-byte', () => {
    const canonical = '{\n  "value": 1\n}\n';
    expect(normalizeCanonicalLfText(canonical, 'fixture')).toBe(canonical);
  });

  it('reconstructs canonical LF bytes from a CRLF checkout', () => {
    expect(normalizeCanonicalLfText('{\r\n}\r\n', 'fixture')).toBe('{\n}\n');
  });

  it('rejects a lone carriage return instead of silently rewriting identity', () => {
    expect(() => normalizeCanonicalLfText('{\r}', 'fixture')).toThrow(/lone carriage return/i);
  });
});
