/**
 * links.ts — Remix codes in links (`?remix=r1-K7QDM`).
 *
 * - `remixLink(code)`: the molecule's own address (`sim`, `load`,
 *   `molecule`, or a saved view's route) plus `remix=`, so whoever opens it
 *   sees this molecule in this look. Null when the molecule has no address
 *   (a dropped file); the code itself still travels.
 * - `intakeRemixParam()`: read once as the viewer boots. The code waits
 *   until a molecule is open (the Remix driver applies it), and the
 *   parameter leaves the address bar so a reload keeps whatever look the
 *   visitor has moved on to.
 */
import { parseRemixCode, type RemixCode, type RemixCodeParse } from './code';

export const REMIX_PARAM = 'remix';

/** Query parameters that say which molecule a link opens. */
const SOURCE_PARAMS = ['sim', 'load', 'molecule'] as const;

/** The molecule's address plus `remix=`, or null when it has no address. */
export function remixLink(code: RemixCode, href: string = typeof window !== 'undefined' ? window.location.href : ''): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const params = new URLSearchParams();
  for (const key of SOURCE_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  const hash = url.hash.startsWith('#/view/') ? url.hash.split('?')[0] : '';
  if (!params.toString() && !hash) return null;
  params.set(REMIX_PARAM, code.text);
  return `${url.origin}/?${params.toString()}${hash}`;
}

let pending: RemixCodeParse | null = null;

/** Take `?remix=` from the address bar (idempotent); the driver applies it. */
export function intakeRemixParam(): boolean {
  if (typeof window === 'undefined') return false;
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return false;
  }
  const value = url.searchParams.get(REMIX_PARAM);
  if (value === null) return false;
  url.searchParams.delete(REMIX_PARAM);
  try {
    window.history.replaceState(window.history.state, '', url);
  } catch {
    /* sandboxed: the parameter stays, harmlessly */
  }
  pending = parseRemixCode(value);
  return true;
}

/** The link's code, once (null when there was none). */
export function takePendingRemix(): RemixCodeParse | null {
  const parse = pending;
  pending = null;
  return parse;
}
