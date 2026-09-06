import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enablePhoneSnow, SnowMotion } from "./snow-motion";

let controller: AbortController;
const status = vi.fn();
const impulse = vi.fn();
const permission = vi.fn();
function emit(acceleration: object | null, gravity: object | null = null) {
  const event = new Event("devicemotion");
  Object.assign(event, { acceleration, accelerationIncludingGravity: gravity });
  window.dispatchEvent(event);
}
beforeEach(() => {
  controller = new AbortController();
  status.mockReset();
  impulse.mockReset();
  permission.mockReset();
  permission.mockResolvedValue("granted");
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("DeviceMotionEvent", { requestPermission: permission });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => {
  controller.abort();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("has bounded inertia that settles completely, and rejects non-finite input", () => {
  const snow = new SnowMotion();
  expect(snow.energy).toBe(0);
  snow.kick(Infinity, 0, 1);
  expect(snow.energy).toBe(0);
  for (let i = 0; i < 100; i++) snow.kick(100, -100, 100);
  expect([snow.energy, snow.x, snow.y]).toEqual([1, 1, -1]);
  for (let i = 0; i < 600; i++) snow.step(1 / 60);
  expect([snow.energy, snow.x, snow.y]).toEqual([0, 0, 0]);
  snow.kick();
  snow.step(NaN);
  expect(Number.isFinite(snow.time)).toBe(true);
  snow.calm();
  expect(snow.energy).toBe(0);
});

it("requests permission synchronously, accepts real samples, and cleans up on abort", async () => {
  const pending = enablePhoneSnow(controller.signal, impulse, status);
  expect(permission).toHaveBeenCalledTimes(1);
  await pending;
  expect(status).toHaveBeenLastCalledWith("listening");
  emit({ x: 12, y: 4, z: 1 });
  expect(status).toHaveBeenLastCalledWith("active");
  expect(impulse).toHaveBeenCalledTimes(1);
  controller.abort();
  emit({ x: 30, y: 2, z: 1 });
  expect(impulse).toHaveBeenCalledTimes(1);
});

it("does not listen after denied permission or a late grant after closing", async () => {
  permission.mockResolvedValueOnce("denied");
  await enablePhoneSnow(controller.signal, impulse, status);
  expect(status).toHaveBeenLastCalledWith("denied");
  let grant: (value: string) => void = () => {};
  permission.mockReturnValueOnce(
    new Promise((resolve) => {
      grant = resolve;
    }),
  );
  const pending = enablePhoneSnow(controller.signal, impulse, status);
  controller.abort();
  grant("granted");
  await pending;
  emit({ x: 10, y: 10, z: 10 });
  expect(impulse).not.toHaveBeenCalled();
});

it("fails honestly in insecure contexts and when a browser supplies no usable sensor values", async () => {
  vi.stubGlobal("isSecureContext", false);
  await enablePhoneSnow(controller.signal, impulse, status);
  expect(permission).not.toHaveBeenCalled();
  expect(status).toHaveBeenLastCalledWith("unavailable");
  vi.stubGlobal("isSecureContext", true);
  vi.useFakeTimers();
  await enablePhoneSnow(controller.signal, impulse, status);
  emit({ x: null, y: null, z: null });
  vi.advanceTimersByTime(5000);
  expect(status).toHaveBeenLastCalledWith("unavailable");
  emit({ x: 10, y: 10, z: 10 });
  expect(impulse).not.toHaveBeenCalled();
});

it("ignores gravity at rest, non-finite samples, and hidden-page motion", async () => {
  let now = 100;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  await enablePhoneSnow(controller.signal, impulse, status);
  emit(null, { x: 0, y: 9.8, z: 0 });
  now += 60;
  emit(null, { x: 0, y: 9.8, z: 0 });
  expect(impulse).not.toHaveBeenCalled();
  now += 60;
  emit({ x: NaN, y: 10, z: 10 });
  expect(impulse).not.toHaveBeenCalled();
  now += 60;
  emit(null, { x: 10, y: 8, z: 0 });
  expect(impulse).toHaveBeenCalledTimes(1);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  now += 60;
  emit({ x: 10, y: 10, z: 10 });
  expect(impulse).toHaveBeenCalledTimes(1);
});
