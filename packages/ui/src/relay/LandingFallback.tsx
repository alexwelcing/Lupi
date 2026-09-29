/**
 * LandingFallback — what ViewerApp shows with no file. While a deep link
 * (`?sim=`, `?load=`, `?molecule=`) is opening it shows the sage plate with
 * the molecule's preview and "Opening…", never the home page, so the H1 does
 * not flash before the molecule arrives. Anything else gets the landing page.
 * (A failed deep link is ViewerApp's RemoteMoleculeLoadError, not this.)
 */
import { LandingPage } from '../LandingPage';
import { RelayPlate } from './RelayPlate';
import { deepLinkGalleryId } from './preview';

function opensMolecule(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('sim') || params.has('load') || params.has('molecule');
}

export function LandingFallback() {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  if (opensMolecule(search)) return <RelayPlate galleryId={deepLinkGalleryId(search)} copy="Opening…" />;
  return <LandingPage />;
}
