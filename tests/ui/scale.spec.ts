import { expect, test } from 'playwright/test';

/**
 * /scale reads every count exactly from LupiScale records, before and without
 * a renderer, so these checks are DOM only: the googolplex readout, a switch
 * to copper's billion, and §12.4's grain opened from its lsr1 link.
 */

const GRAIN =
  'lsr1:TFNSAQECAAChDiEDYilwBFAS61MIQ75O8KCAscIeUmXilMtEDD5XWTQAAABMVVBOAwEAACgAAAAFAAsR-WgBAAUAAAAAAAAABQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAqAAAAExVUE4EAQAAnAAAAC74UC_NIuSwmMV-hcC9G2eT_4vhP5szDQAX8clWHj8-CgEAAHQzHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAdDMcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB0MxwAAAAAACoA_f______________D48uqAhDsqp8GiGOQM6K8wvOxIQnC-t8w5QlrUkSESMBAAEAAyoA_f______________D48uqAhDsqp8GiGOQM6K8wvOxIQnC-t8w5QlrUkSAgAFAQABACoAVFVVVVVVVVVVVVVVBYUPOFgW5jjUCAvaau_Y-wOaQSwNWU7U64YMjxgGAQAJKgBUVVVVVVVVVVVVVVUFhQ84WBbmONQIC9pq79j7A5pBLA1ZTtTrhgyPGAYCAAUBAAEAKgBTVVVVVVVVVVVVVVUFhQ84WBbmONQIC9pq79j7A5pBLA1ZTtTrhgyPGAZElhGs54iVFtEXIu6NoHil5LaXyJ5O94VN2RGEl9-ArQ';

test('scale opens on a googolplex of salt with its exact count', async ({ page }) => {
  await page.goto('/scale');
  await expect(page).toHaveTitle(/googolplex/i);
  await expect(page.getByTestId('scale-count')).toHaveText('10^(10^100) atoms');
  await expect(page.getByRole('slider', { name: 'Scale' })).toBeVisible();
  await page.getByRole('navigation', { name: 'What to look at' }).getByRole('button', { name: 'Copper' }).click();
  await expect(page.getByTestId('scale-count')).toHaveText('1,000,188,000 atoms');
  expect(new URL(page.url()).searchParams.get('e')).toBe('copper-billion');
});

test('an lsr1 link opens its piece in place', async ({ page }) => {
  await page.goto(`/scale?ref=${GRAIN}`);
  await expect(page.getByTestId('scale-count')).toHaveText('10^(10^100) atoms');
  await expect(page.locator('.scale-piece')).toContainText('1,000 atoms');
  await expect(page.locator('.scale-piece')).toContainText('BrCl499Na500');
});
