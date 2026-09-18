import { expect, test } from 'playwright/test';

/**
 * The Library is a real path route rebuilt on the surviving federated
 * providers. These checks run against the static build: gallery, research,
 * and NIST sources are same-origin, and the OMol25 edge is absent locally, so
 * that page must fail honestly rather than crash.
 */

test('library route lists every collection and browses same-origin sources without a renderer', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Every connected source, one search.');
  const nav = page.getByRole('navigation', { name: 'Library collections' });
  for (const name of ['All sources', 'Lupi gallery', 'OMol25', 'Zenodo research', 'NIST potentials', 'Surprise me']) {
    await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Library' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('status')).toHaveText(/results from \d+ sources/);
  const cards = page.locator('.library-card');
  expect(await cards.count()).toBeGreaterThan(10);
  await expect(page.locator('.library-card--gallery').first()).toBeVisible();
  await expect(page.locator('.library-card--research').first()).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('library search prefills from the URL and opens a gallery structure in place', async ({ page }) => {
  await page.goto('/library?q=benzene');
  await expect(page.getByRole('searchbox', { name: 'Search every collection' })).toHaveValue('benzene');
  const benzene = page.getByRole('button', { name: 'Open Benzene' }).first();
  await expect(benzene).toBeVisible();
  await benzene.click();
  await expect(page.locator('.lupine-main-viewport canvas')).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get('load')).toContain('benzene');
});

test('research collection carries provenance and the full gallery keeps its filters', async ({ page }) => {
  await page.goto('/library/research');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cited research files.');
  await expect(page.locator('.library-card--research')).toHaveCount(8);
  await expect(page.locator('.library-provenance').first()).toContainText('zenodo.org · 10.5281/zenodo.');
  await page.goto('/library/gallery');
  await expect(page.getByRole('status')).toHaveText(/^104 of 104 gallery entries/);
  await page.getByRole('button', { name: /^Biomolecules/ }).click();
  await expect(page.getByRole('status')).toHaveText(/^59 of 104/);
  await expect(page.getByRole('link', { name: 'Open Caffeine' })).toHaveAttribute('href', '/?sim=caffeine');
});

test('legacy tabs and OMol25 education URLs redirect into the library; research execution stays retired', async ({ page }) => {
  for (const [from, to] of [
    ['/?tab=research', '/library/research'],
    ['/?tab=omol25', '/library/omol25'],
    ['/?tab=browse', '/library'],
    ['/materials/omol25', '/library/omol25'],
  ]) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to.replace(/\//g, '\\/')}$`));
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(/retired/);
  }
  await page.goto('/?tab=equilibrium');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This research workspace has retired from Lupi.');
});

test('OMol25 page states its coverage and fails honestly when the dataset edge is unreachable', async ({ page }) => {
  await page.goto('/library/omol25');
  await expect(page.getByRole('heading', { name: 'Open Molecules 2025' })).toBeVisible();
  await expect(page.getByText(/OMol25 supplies no bond topology/)).toBeVisible();
  await expect(page.locator('.library-coverage')).toContainText('colabfit/OMol25_train_neutral');
  // Either rows arrive (deployed run with the edge) or the alert explains why not.
  await expect(page.locator('.library-card--omol').first().or(page.getByRole('alert'))).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('library reflows at 320px with increased text spacing', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  for (const path of ['/library', '/library/omol25?view=facets']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.addStyleTag({
      content:
        '.student-home * { line-height:1.5!important; letter-spacing:.12em!important; word-spacing:.16em!important; } .student-home p { margin-bottom:2em!important; }',
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('@deployed-smoke OMol25 rows stream through the live dataset edge', async ({ page }) => {
  test.skip(!process.env.UI_TEST_URL, 'needs the deployed Worker');
  await page.goto('/library/omol25');
  await expect(page.locator('.library-card--omol').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('status')).toHaveText(/of 34,335,828/);
});
