import { describe, expect, it } from 'vitest';
import { libraryCollectionFromRoute, libraryPath, libraryRedirectTarget } from './viewerRoutes';

describe('library routes', () => {
  it('maps paths to collections and back', () => {
    expect(libraryCollectionFromRoute('/library')).toBe('all');
    expect(libraryCollectionFromRoute('/library/omol25?q=C6H6')).toBe('omol25');
    expect(libraryCollectionFromRoute('/library/random/')).toBe('random');
    expect(libraryCollectionFromRoute('/study/organic-functional-groups')).toBeNull();
    expect(libraryPath('all')).toBe('/library');
    expect(libraryPath('research')).toBe('/library/research');
  });

  it('redirects legacy tabs and OMol25 education URLs but keeps research execution retired', () => {
    expect(libraryRedirectTarget('/', '?tab=browse')).toBe('/library');
    expect(libraryRedirectTarget('/', '?tab=simulations')).toBe('/library/gallery');
    expect(libraryRedirectTarget('/', '?tab=omol25')).toBe('/library/omol25');
    expect(libraryRedirectTarget('/', '?tab=research')).toBe('/library/research');
    expect(libraryRedirectTarget('/', '?tab=potentials')).toBe('/library/potentials');
    expect(libraryRedirectTarget('/materials/omol25', '')).toBe('/library/omol25');
    expect(libraryRedirectTarget('/materials/omol25-molecule-geometry/', '')).toBe('/library/omol25');
    expect(libraryRedirectTarget('/', '?tab=equilibrium')).toBeNull();
    expect(libraryRedirectTarget('/materials/million-atom-viewer', '')).toBeNull();
    expect(libraryRedirectTarget('/study/x', '?tab=browse')).toBeNull();
  });
});
