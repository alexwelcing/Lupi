export function normalizeTrustedShareUrl(
  value: unknown,
  trustedBaseUrl: string,
): string | null {
  if (typeof value !== "string" || value.length > 16_384) return null;
  try {
    const parsed = new URL(value);
    const trusted = new URL(trustedBaseUrl);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.origin !== trusted.origin
    )
      return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
