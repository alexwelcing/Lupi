/** The shared Lupi canvas calls this sink on a renderer failure. Keep this
 * local to the iframe: the public molecule card has no analytics or account. */
export const ANALYTICS_EVENTS = { RENDER_FAILED: 'render_failed' } as const;

export function track(_event: string, _details: unknown): void {
  window.dispatchEvent(new Event('lupi:renderer-unavailable'));
}
