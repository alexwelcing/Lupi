import { expect, test } from "playwright/test";
import { createCanvas, loadImage } from "canvas";

async function pixels(bytes: Buffer) {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height).data;
}

test("vgpu renders snowglobe and classic looks, responds to shaking, and releases devices", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const requests: string[] = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  // Device lifecycle instrumentation is test-only; production exposes no GPU handles.
  await page.addInitScript(() => {
    const gpu = navigator.gpu;
    if (!gpu) return;
    const liveDevices = new Set<GPUDevice>();
    (window as any).__studioTestLiveDevices = () => liveDevices.size;
    const requestAdapter = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = async (options) => {
      const adapter = await requestAdapter(options);
      if (!adapter) return adapter;
      const requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async (descriptor) => {
        const device = await requestDevice(descriptor);
        if (descriptor?.label === "Lupi GPU Studio") liveDevices.add(device);
        const destroy = device.destroy.bind(device);
        device.destroy = () => {
          liveDevices.delete(device);
          destroy();
        };
        return device;
      };
      return adapter;
    };
  });
  await page.goto("/?sim=glucose");
  const launch = page.getByRole("button", { name: "Open GPU Studio" });
  await expect(launch).toBeVisible();
  await expect(page.locator(".lupine-main-viewport canvas")).toBeVisible();
  expect(
    requests.filter((url) => /vendor-three-webgpu|\/runtime-/.test(url)),
  ).toEqual([]);
  const deviceCount = () =>
    page.evaluate(() => (window as any).__studioTestLiveDevices?.() ?? 0);
  const before = await deviceCount();
  await launch.click();
  const dialog = page.getByRole("dialog");
  // This lane fails, rather than silently skipping, if a real device is unavailable.
  await expect(dialog).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
  await expect.poll(deviceCount).toBe(before + 1);
  await expect(dialog).toContainText("WebGPU active");
  await expect(dialog).toContainText("24 atoms");
  // Hold the CSS backdrop fixed: pixel differences must come from the shader.
  await page.addStyleTag({
    content: ".gpu-studio__stage { background:#17332a!important; }",
  });
  const canvas = dialog.locator(".gpu-studio__canvas canvas");
  const studio = await canvas.screenshot();
  const studioPixels = await pixels(studio);
  let brightPixels = 0;
  for (let i = 0; i < studioPixels.length; i += 4) {
    if (studioPixels[i] > 120 && studioPixels[i + 1] > 100) brightPixels++;
  }
  expect(brightPixels).toBeGreaterThan(1000);
  await expect(dialog).toHaveAttribute("data-look", "snowglobe");
  await expect(dialog).toContainText("Reduced motion is on.");
  await dialog.getByRole("button", { name: "Shake it", exact: true }).click();
  const shakenPixels = await pixels(await canvas.screenshot());
  let snowChangedPixels = 0;
  for (let i = 0; i < studioPixels.length; i += 4) {
    if (
      Math.abs(studioPixels[i] - shakenPixels[i]) +
        Math.abs(studioPixels[i + 1] - shakenPixels[i + 1]) >
      25
    )
      snowChangedPixels++;
  }
  expect(snowChangedPixels).toBeGreaterThan(300);
  await page.screenshot({ path: testInfo.outputPath("snowglobe-desktop.png") });
  // Under reduced motion a shake changes the composition once, then holds still.
  await page.waitForTimeout(300);
  const heldPixels = await pixels(await canvas.screenshot());
  expect(Buffer.from(heldPixels).equals(Buffer.from(shakenPixels))).toBe(true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await dialog.getByRole("button", { name: "Shake it", exact: true }).click();
  const flowing = await pixels(await canvas.screenshot());
  await page.waitForTimeout(400);
  const later = await pixels(await canvas.screenshot());
  let animatedPixels = 0;
  for (let i = 0; i < flowing.length; i += 4) {
    if (
      Math.abs(flowing[i] - later[i]) +
        Math.abs(flowing[i + 1] - later[i + 1]) >
      15
    )
      animatedPixels++;
  }
  expect(animatedPixels).toBeGreaterThan(200);
  await dialog.getByRole("button", { name: "Settle snow" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Shake it", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("snowglobe-mobile.png"),
    fullPage: true,
  });
  // Restore the starting canvas dimensions before classic-finish pixel comparisons.
  await page.setViewportSize(testInfo.project.use.viewport!);
  await dialog.getByRole("button", { name: /Graphic contours/ }).click();
  await expect(dialog).toHaveAttribute("data-look", "contours");
  const contours = await canvas.screenshot();
  const contourPixels = await pixels(contours);
  let changedPixels = 0;
  for (let i = 0; i < studioPixels.length; i += 4) {
    if (
      Math.abs(studioPixels[i] - contourPixels[i]) +
        Math.abs(studioPixels[i + 1] - contourPixels[i + 1]) +
        Math.abs(studioPixels[i + 2] - contourPixels[i + 2]) >
      50
    )
      changedPixels++;
  }
  expect(changedPixels).toBeGreaterThan(1000);
  await page.screenshot({ path: testInfo.outputPath("contours-desktop.png") });
  await dialog.getByRole("button", { name: "Focus O atoms" }).click();
  await expect(dialog).toContainText("6 O atoms highlighted.");
  await expect(
    dialog.getByRole("button", { name: "Focus O atoms" }),
  ).toHaveAttribute("aria-pressed", "true");
  const focusedPixels = await pixels(await canvas.screenshot());
  let focusChangedPixels = 0;
  for (let i = 0; i < contourPixels.length; i += 4) {
    if (
      Math.abs(contourPixels[i] - focusedPixels[i]) +
        Math.abs(contourPixels[i + 1] - focusedPixels[i + 1]) >
      40
    )
      focusChangedPixels++;
  }
  expect(focusChangedPixels).toBeGreaterThan(1000);
  await dialog.getByRole("button", { name: "All atoms" }).click();
  const light = dialog.getByRole("slider", { name: "Light angle" });
  await light.focus();
  await page.keyboard.press("Home");
  await expect(light).toHaveValue("-180");
  await expect(light).toHaveAttribute("aria-valuetext", "-180 degrees");
  await expect(dialog).toHaveAttribute("data-status", "ready");
  // No autoplay, including under the suite's reduced-motion preference.
  await expect(
    dialog.getByRole("button", { name: "Rotate", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "Rotate", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Stop rotation" }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Stop rotation" }).click();
  await dialog.getByRole("button", { name: "Reset view" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("contours-mobile.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Back to viewer" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(deviceCount).toBe(before);
  await expect(launch).toBeFocused();
  await expect(page.locator(".lupine-status-bar")).toContainText("Glucose");
  await launch.click();
  await expect(dialog).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
  await expect.poll(deviceCount).toBe(before + 1);
  await page.keyboard.press("Escape");
  await expect.poll(deviceCount).toBe(before);
  expect(errors).toEqual([]);
  await testInfo.attach("render-receipt", {
    body: JSON.stringify({
      brightPixels,
      changedPixels,
      focusChangedPixels,
      snowChangedPixels,
      animatedPixels,
      deviceCountBefore: before,
      deviceCountAfter: await deviceCount(),
    }),
    contentType: "application/json",
  });
  await page.goto("about:blank", { waitUntil: "commit" });
});
