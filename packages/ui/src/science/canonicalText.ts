/** Reconstruct exact repository LF bytes after a platform may expose CRLF. */
export function normalizeCanonicalLfText(value: string, label: string): string {
  if (!value.includes('\r')) return value;
  const normalized = value.replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) {
    throw new Error(`${label} contains an unsupported lone carriage return.`);
  }
  return normalized;
}
