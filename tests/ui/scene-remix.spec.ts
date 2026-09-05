import { expect, test } from 'playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

test('mobile Remix, undo, sphere shader, and the full visual workbench are live', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?sim=glucose&debug=1');
  await page.waitForFunction(() => (window as any).__lupi?.three?.scene && (window as any).__lupiViewerMcp?.ready);
  const read = () => page.evaluate(() => (window as any).__lupiViewerMcp.state());
  const before = await read();
  await page.getByRole('button', { name: 'Style command', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Keep atom colors' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Remix scene', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo remix' })).toBeEnabled();
  const after = await read();
  expect(after.backgroundPreset).not.toBe(before.backgroundPreset);
  expect(after.colorScheme).toBe('colorway');
  expect(after.colormap).not.toBe(before.colormap);
  await page.screenshot({ path: testInfo.outputPath('remixed-atoms.png') });
  for (const key of ['fileName', 'atomCount', 'frame', 'showBonds', 'atomScale']) expect(after[key]).toEqual(before[key]);
  await page.getByRole('button', { name: 'Remix scene', exact: true }).click();
  expect((await read()).colormap).not.toBe(after.colormap);
  await page.getByRole('button', { name: 'Undo remix' }).click();
  expect((await read()).colormap).toBe(after.colormap);
  await page.getByRole('button', { name: 'Close Style panel' }).click();
  await page.getByRole('button', { name: 'Style command', exact: true }).click();
  await page.getByRole('button', { name: 'Undo remix' }).click();
  expect((await read()).backgroundPreset).toBe(before.backgroundPreset);
  expect((await read()).colorScheme).toBe(before.colorScheme);
  expect((await read()).colormap).toBe(before.colormap);
  await page.getByRole('checkbox', { name: 'Keep atom colors' }).check();
  await page.getByRole('button', { name: 'Remix scene', exact: true }).click();
  expect((await read()).colorScheme).toBe(before.colorScheme);
  expect((await read()).colormap).toBe(before.colormap);
  await page.getByRole('button', { name: 'Undo remix' }).click();
  expect((await read()).colorScheme).toBe(before.colorScheme);
  await page.getByRole('button', { name: 'Prism look', exact: true }).click();
  await page.getByRole('button', { name: 'Recenter', exact: true }).click();
  const sphere = () => page.evaluate(() => {
    let found: null | { opacity: number; wireframe: boolean; shader: boolean } = null;
    (window as any).__lupi.three.scene.traverse((node: any) => {
      if (node.material?.uniforms?.uAccent && node.material?.uniforms?.uOpacity) {
        found = { opacity: node.material.uniforms.uOpacity.value, wireframe: node.material.wireframe, shader: node.material.fragmentShader.includes('fresnel') };
      }
    });
    return found;
  });
  await expect.poll(sphere).toEqual({ opacity: .38, wireframe: false, shader: true });
  await page.screenshot({ path: testInfo.outputPath('mobile-prism.png') });
  await page.getByRole('button', { name: 'All visual mods', exact: true }).click();
  await page.getByRole('button', { name: 'Sphere', exact: true }).click();
  const opacity = page.getByRole('slider', { name: 'Atmosphere visibility' });
  await opacity.focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await sphere())?.opacity).toBe(.65);
  await page.getByRole('button', { name: 'Backdrop', exact: true }).click();
  const library = page.getByRole('combobox', { name: 'Background library' });
  expect(await library.locator('option').count()).toBeGreaterThan(30);
  await library.selectOption('gallery-studio');
  await page.getByRole('slider', { name: 'Brightness', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect.poll(() => page.evaluate(() => {
    let brightness = -1;
    (window as any).__lupi.three.scene.traverse((node: any) => { if (node.material?.uniforms?.brightness) brightness = node.material.uniforms.brightness.value; });
    return brightness;
  })).toBe(.35);
  await library.selectOption('hopf-current');
  await page.getByRole('checkbox', { name: 'Animate background' }).uncheck();
  const time = () => page.evaluate(() => {
    let value = -1;
    (window as any).__lupi.three.scene.traverse((node: any) => { if (node.material?.uniforms?.uTime) value = node.material.uniforms.uTime.value; });
    return value;
  });
  const pausedTime = await time();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await time()).toBe(pausedTime);
  await library.selectOption('gallery-studio');
  await page.getByRole('button', { name: 'Effects', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Glow', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Full effects on this device' }).check();
  await expect(page.getByRole('checkbox', { name: 'Glow', exact: true })).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Glow', exact: true }).check();
  await page.getByRole('slider', { name: 'Glow strength' }).focus();
  await page.keyboard.press('End');
  await page.getByRole('checkbox', { name: 'Full effects on this device' }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Glow', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Glow', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-effects.png') });
  expect(errors).toEqual([]);
  await page.goto('about:blank');
});
