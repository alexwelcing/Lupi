/**
 * framePhases.ts — Lupi's frame phases and job ids on the fiber v10 scheduler.
 *
 * Order (proven, lead probe L5):
 *   start → input → physics → update → lupi-canonical → lupi-uniforms
 *         → lupi-overlays → render → lupi-capture → finish
 *
 * - `lupi-canonical`: settle canonical scene state (the export barrier).
 * - `lupi-uniforms`: push playback, property and look state into node
 *   material uniforms. Camera-derived values live in the node graph.
 * - `lupi-overlays`: place CPU-side overlays from this frame's uniforms
 *   (labels and rings riding display motion), so they never trail the atoms
 *   by a frame.
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
  overlays: 'lupi-overlays',
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
  /** The Lupi camera rig (drag, coast, glide, detents) in fiber's `update` phase. */
  cameraRig: 'lupi/camera-rig',
  /** Display-only motion (arrival, ripple, scatter, tug, burst, heat) uniforms in `lupi-uniforms`. */
  displayMotion: 'lupi/display-motion',
  /** The atom impostor's hover and selection glow fades in `lupi-uniforms`. */
  atomGlow: 'lupi/atom-glow',
  /** The first rendered frame of a file, in `lupi-capture`. */
  firstFrame: 'lupi/first-frame',
  /** Quiet Idle: counts the drawn frame and asks for the next one, in `finish` (frameDemand.ts). */
  frameDemand: 'lupi/frame-demand',
  /** The phone atom card's view shift (a projection view offset) in `update`. */
  viewInset: 'lupi/view-inset',
  /** Overlays (labels, rings, the card anchor, trails) riding display motion, in `lupi-overlays`. */
  displayFollow: 'lupi/display-follow',
  /** Instant Replay's clip: compose each recorded frame and its labels, in `lupi-capture`. */
  clipComposite: 'lupi/clip-composite',
  /** Instant Replay's recorder: the camera pose of each drawn frame, in `lupi-capture`. */
  replayRecord: 'lupi/replay-record',
  /** A shared replay playing in this view (camera and toys), in `update`. */
  replayPlay: 'lupi/replay-play',
  /** A Remix code's Foil finish: level fades and the reveal sweep, in `lupi-uniforms`. */
  atomFoil: 'lupi/atom-foil',
  /** The Illustrate look's fade (Ink-to-Light) uniforms in `lupi-uniforms`. */
  inkLook: 'lupi/ink-look',
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
  if (!scheduler.hasPhase(LUPI_PHASE.overlays)) scheduler.addPhase(LUPI_PHASE.overlays, { after: LUPI_PHASE.uniforms });
  if (!scheduler.hasPhase(LUPI_PHASE.capture)) scheduler.addPhase(LUPI_PHASE.capture, { after: 'render' });
}

installLupiPhases();
