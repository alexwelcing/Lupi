import { expect, test } from 'playwright/test';
import { createCanvas, loadImage } from 'canvas';

async function pixels(bytes: Buffer) {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height).data;
}

test('action shader draws changing pixels, shares one device and stops when idle', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('console', message => { if (message.text().includes('[Lupi action light]')) console.log(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /vgpu|shader|validation/i.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(() => {
    const gpu = navigator.gpu;
    if (!gpu) return;
    const devices = new Set<GPUDevice>();
    let submits = 0;
    (window as any).__actionTest = { count: () => devices.size, submits: () => submits };
    const request = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = async options => {
      const adapter = await request(options);
      // Count only the action layer's low-power request. The existing atom
      // pipeline can independently acquire a high-performance compute device.
      if (!adapter || options?.powerPreference !== 'low-power') return adapter;
      const create = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async descriptor => {
        const device = await create(descriptor);
        devices.add(device);
        const submit = device.queue.submit.bind(device.queue);
        device.queue.submit = commands => { submits++; submit(commands); };
        const destroy = device.destroy.bind(device);
        device.destroy = () => { devices.delete(device); destroy(); };
        return device;
      };
      return adapter;
    };
  });
  await page.goto('/?sim=glucose');
  await expect(page.getByRole('button', { name: 'Style command', exact: true })).toBeVisible();
  // Opening Style intentionally focuses its first action; measure laziness
  // before that real keyboard-focus interaction, not after it.
  expect(await page.evaluate(() => (window as any).__actionTest?.count() ?? 0)).toBe(0);
  await page.getByRole('button', { name: 'Style command', exact: true }).click();
  const remix = page.getByRole('button', { name: 'Remix scene', exact: true });
  const mods = page.getByRole('button', { name: 'All visual mods', exact: true });
  const count = () => page.evaluate(() => (window as any).__actionTest?.count() ?? 0);
  const submits = () => page.evaluate(() => (window as any).__actionTest?.submits() ?? 0);
  console.log('Action shader environment', await page.evaluate(() => ({
    webgpu: Boolean(navigator.gpu), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    forcedColors: matchMedia('(forced-colors: active)').matches, hidden: document.hidden,
  })));
  await remix.focus();
  await expect(remix).toHaveAttribute('data-action-renderer', 'vgpu', { timeout: 30_000 });
  expect(await count()).toBe(1);
  const rect = (await remix.boundingBox())!;
  const beforePointer = await submits();
  await page.mouse.move(rect.x + 20, rect.y + 15);
  await expect(remix).toHaveAttribute('data-light-active', 'true');
  await expect.poll(submits).toBeGreaterThan(beforePointer);
  await expect(remix).not.toHaveAttribute('data-light-active');
  const stopped = await submits();
  // Deliberate bounded idle observation: production must submit no more frames.
  await page.waitForTimeout(300);
  expect(await submits()).toBe(stopped);
  // Isolate the actual GPU canvas from CSS decoration. Holding opacity at one
  // exposes its last frame after the finite burst, without changing GPU inputs.
  const visibility = await page.addStyleTag({ content: '.lupi-action__light { background: #14241e!important; } .lupi-action__light canvas { opacity:1!important; transition:none!important; }' });
  const first = await pixels(await remix.locator('canvas').screenshot());
  await page.mouse.move(rect.x + rect.width - 20, rect.y + rect.height - 15);
  await expect.poll(submits).toBeGreaterThan(stopped);
  await expect(remix).not.toHaveAttribute('data-light-active');
  const second = await pixels(await remix.locator('canvas').screenshot());
  let changed = 0;
  let colored = 0;
  for (let i = 0; i < first.length; i += 4) {
    if (first[i] + first[i + 1] + first[i + 2] > 160) colored++;
    if (Math.abs(first[i] - second[i]) + Math.abs(first[i + 1] - second[i + 1]) + Math.abs(first[i + 2] - second[i + 2]) > 30) changed++;
  }
  expect(colored).toBeGreaterThan(100);
  expect(changed).toBeGreaterThan(100);
  await visibility.evaluate(element => element.remove());
  await mods.focus();
  await expect(mods).toHaveAttribute('data-action-renderer', 'vgpu');
  expect(await count()).toBe(1);
  // Keyboard activation remains native and the labels survive the decoration.
  await remix.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Undo remix' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo remix' }).click();
  await page.screenshot({ path: info.outputPath('actions-desktop.png') });
  await page.getByRole('button', { name: 'Close Style panel' }).click();
  await expect.poll(count).toBe(0);
  expect(errors).toEqual([]);
  await info.attach('shader-receipt', { body: JSON.stringify({ coloredPixels: colored, changedPixels: changed, idleSubmissions: 0, devicesAfterClose: await count() }), contentType: 'application/json' });
});

test('phone touch, reduced motion, forced colors and 320px text reflow remain usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?sim=glucose');
  await page.getByRole('button', { name: 'Style command', exact: true }).click();
  const remix = page.getByRole('button', { name: 'Remix scene', exact: true });
  await remix.focus();
  expect(await remix.locator('canvas').count()).toBe(0);
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Undo remix' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo remix' }).click();
  for (const button of [remix, page.getByRole('button', { name: 'All visual mods', exact: true }), page.getByRole('button', { name: 'Open GPU Studio' })]) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await remix.tap();
  await expect(page.getByRole('button', { name: 'Undo remix' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo remix' }).tap();
  await page.screenshot({ path: info.outputPath('actions-mobile.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addStyleTag({ content: '* { line-height:1.5!important; letter-spacing:.12em!important; word-spacing:.16em!important; } p { margin-bottom:2em!important; }' });
  await expect(remix).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const panel = page.getByRole('region', { name: 'Style command panel' });
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('actions-320-text-spacing.png') });
  const allMods = page.getByRole('button', { name: 'All visual mods', exact: true });
  await allMods.scrollIntoViewIfNeeded();
  await expect(allMods).toBeInViewport();
  const recenter = page.getByRole('button', { name: 'Recenter', exact: true });
  const remixBounds = (await remix.boundingBox())!;
  expect((await recenter.boundingBox())!.y).toBeGreaterThanOrEqual(remixBounds.y + remixBounds.height);
  await page.screenshot({ path: info.outputPath('actions-320-footer.png') });
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' });
  await remix.focus();
  // Switch from touch modality to real keyboard navigation before checking
  // :focus-visible; programmatic focus after a tap intentionally has no ring.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(remix).toBeFocused();
  expect(await remix.locator('canvas').count()).toBe(0);
  expect(await remix.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Undo remix' })).toBeEnabled();
});
