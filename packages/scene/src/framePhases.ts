/**
 * framePhases.ts — Lupi's frame phases and job ids on the fiber v10 scheduler.
 *
 * Order (proven, lead probe L5):
 *   start → input → physics → update → lupi-canonical → lupi-uniforms
 *         → render → lupi-capture → finish
 *
 * - `lupi-canonical`: settle canonical scene state (the export barrier).
 * - `lupi-uniforms`: push playback, property and look state into node
 *   material uniforms. Camera-derived values live in the node graph.
 * - `lupi-capture`: read back after the default render.
 *
 * Rules (plan-final D12, §4.6): frame jobs use `useFrame(cb, { phase, id })`
 * with the ids below. No Lupi job runs in `render` (a job there takes over
 * rendering), and numeric priorities are not used (a positive one disables
 * the default render; zero and negative ones are silently reordered).
 */
import { getScheduler } from '@react-three/fiber/webgpu';

export const LUPI_PHASE = {
  canonical: 'lupi-canonical',
  uniforms: 'lupi-uniforms',
  capture: 'lupi-capture',
} as const;

export type LupiPhase = (typeof LUPI_PHASE)[keyof typeof LUPI_PHASE];

export const LUPI_JOB = {
  atomsUniforms: 'lupi/atoms-uniforms',
  bondsUniforms: 'lupi/bonds-uniforms',
  glyphsUniforms: 'lupi/glyphs-uniforms',
  clustersUniforms: 'lupi/clusters-uniforms',
  envSync: 'lupi/env-sync',
  exportCanonical: 'lupi/export-canonical',
  exportCapture: 'lupi/export-capture',
  /** Queued viewer captures (saved-view thumbnails) in `lupi-capture`. */
  viewerCapture: 'lupi/viewer-capture',
  videoDrive: 'lupi/video-drive',
  axesGizmo: 'lupi/axes-gizmo',
  dofFocus: 'lupi/dof-focus',
  labelsFacing: 'lupi/labels-facing',
  contactShadow: 'lupi/contact-shadow',
  /** Camera state sync (store presets, flythrough preview, clipping planes) in `update`. */
  cameraSync: 'lupi/camera-sync',
  /** The eased move to a clicked atom in `update`. */
  cameraFocus: 'lupi/camera-focus',
  /** The testbed harness: probe projection and the readiness count. */
  harness: 'lupi/harness',
} as const;

export type LupiJobId = (typeof LUPI_JOB)[keyof typeof LUPI_JOB];

/**
 * Add the Lupi phases to the global scheduler. Idempotent. Runs when this
 * module is imported (so any job that names a Lupi phase finds it in place)
 * and again from LupiCanvas.
 */
export function installLupiPhases(): void {
  const scheduler = getScheduler();
  if (!scheduler.hasPhase(LUPI_PHASE.canonical)) scheduler.addPhase(LUPI_PHASE.canonical, { after: 'update' });
  if (!scheduler.hasPhase(LUPI_PHASE.uniforms)) scheduler.addPhase(LUPI_PHASE.uniforms, { after: LUPI_PHASE.canonical });
  if (!scheduler.hasPhase(LUPI_PHASE.capture)) scheduler.addPhase(LUPI_PHASE.capture, { after: 'render' });
}

installLupiPhases();
