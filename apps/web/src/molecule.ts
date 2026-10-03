/**
 * Entry of the zero-canvas molecule pages (/m/<id>), a separate Vite input
 * (molecule.html). scripts/generate-molecule-pages.mts fills the built
 * template once per gallery molecule; this script makes the drawing spin and
 * wires the verbs. No React, no three.
 */
import '@atlas/ui/moleculePage/page.css';
import { mountMoleculePage } from '@atlas/ui/moleculePage/page';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountMoleculePage, { once: true });
} else {
  mountMoleculePage();
}
