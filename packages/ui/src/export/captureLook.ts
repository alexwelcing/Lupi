/**
 * captureLook.ts — the viewer's look, as an export applies it.
 *
 * Owner decision (decisions.md, "Export background"): exported images use the
 * view as configured in the viewer. Raster captures therefore run the
 * configured post recipe (preset × intensity × overrides; postprocess/) —
 * ambient occlusion, bloom, depth of field, tone mapping and vignette — over
 * the supersampled scene, instead of the raw scene.
 *
 * The look an export applies is the *configured* one, never the phone budget
 * (reduceForMobile) or the playback cheapening: an export is one offline
 * render, so a phone exports the same picture a desktop does, and the
 * artifact spec does not depend on the device.
 *
 * Transparent output has no plate to glow over or darken, so it keeps the
 * per-pixel stages only (AO, tone mapping on un-premultiplied colour) and
 * drops bloom, depth of field and vignette (the spec records them as null).
 *
 * Under the Illustrate look the recipe steps aside (the drawing shades
 * itself in the impostors), so `view.postprocess` is the raw scene; the spec
 * records the ink in `view.ink` (mcp/renderArtifactAdapter.ts). The look's
 * screen-space contour (postprocess/inkContour.ts) still runs once over the
 * assembled image, like the recipe would (`inkContour`, `view.ink.contour`).
 *
 * This module is pure: the GPU pass is captureLookPass.ts.
 */
import type { RenderJsonObjectV1 } from '@atlas/core';
import { resolveActivePostprocess, type EffectOverrides } from '../postprocess/controls';
import { INK_CONTOUR_PIPELINE_ID, INK_CONTOUR_TUNING, inkContourSwitchedOn } from '../postprocess/inkContour';
import type { PostprocessPresetConfig, PostprocessPresetId } from '../postprocess/presets';

export type CaptureToneMapping = PostprocessPresetConfig['toneMapping'];

export interface CaptureLook {
  toneMapping: CaptureToneMapping;
  /** GTAO: `intensity` is the occlusion exponent, `radius` world units. */
  ao: { intensity: number; radius: number } | null;
  bloom: { intensity: number; threshold: number; smoothing: number } | null;
  /** World units: focus distance, distance to full blur, bokeh scale. */
  dof: { focusDistance: number; focusRange: number; bokehScale: number } | null;
  vignette: { offset: number; darkness: number } | null;
  /**
   * The Illustrate look's contour (line widths in ink units), on while the
   * look is; it is recorded in `view.ink.contour`, not in `view.postprocess`.
   */
  inkContour: CaptureInkContour | null;
}

export interface CaptureInkContour {
  /** Crease and step lines, ink units. */
  inner: number;
  /** The outer contour against the plate, ink units. */
  outer: number;
}

/** The spec's `view.postprocess.pipeline` when the look is applied. */
export const CAPTURE_LOOK_PIPELINE = 'viewer-look';
/** The spec's `view.postprocess.pipeline` when there is nothing to apply. */
export const CAPTURE_RAW_PIPELINE = 'raw-scene';

export const EMPTY_CAPTURE_LOOK: CaptureLook = Object.freeze({
  toneMapping: 'none',
  ao: null,
  bloom: null,
  dof: null,
  vignette: null,
  inkContour: null,
}) as CaptureLook;

/** True when the look has no post recipe to apply (`view.postprocess` is the raw scene); the ink contour is not part of it. */
export function captureLookIsEmpty(look: CaptureLook | null | undefined): boolean {
  return !look || (look.toneMapping === 'none' && !look.ao && !look.bloom && !look.dof && !look.vignette);
}

/** True when a capture runs the output-resolution pass: a post recipe, or the ink contour. */
export function captureLookRunsPass(look: CaptureLook | null | undefined): boolean {
  return Boolean(look) && (!captureLookIsEmpty(look) || look!.inkContour !== null);
}

/** True when the look restyles pixels the background owns (so it must be restored there). */
export function captureLookTouchesBackground(look: CaptureLook): boolean {
  return look.toneMapping !== 'none' || look.vignette !== null;
}

export interface CaptureLookState {
  postprocessPreset: PostprocessPresetId;
  postprocessIntensity: number;
  effectOverrides: EffectOverrides | null;
  /** The Illustrate look sets the recipe aside (postprocess/controls.ts inkRecipe) and adds its contour. Absent = off. */
  inkStyle?: 'off' | 'flat' | 'hatch' | 'engrave' | 'halftone' | 'chalk';
  cameraPosition: readonly [number, number, number] | readonly number[];
  cameraTarget: readonly [number, number, number] | readonly number[];
}

/** Round to 6 significant digits so float noise never splits a spec. */
function tidy(value: number): number {
  return Number.isFinite(value) ? Number(value.toPrecision(6)) : 0;
}

/**
 * The look an export of `state` applies: the configured recipe, not the
 * device budget. Depth-of-field autofocus focuses on the camera target, as
 * the live view does (postPipeline.ts `autofocus`).
 */
export function resolveCaptureLook(state: CaptureLookState, options: { transparent: boolean }): CaptureLook {
  const ink = state.inkStyle !== undefined && state.inkStyle !== 'off';
  const config = resolveActivePostprocess({
    presetId: state.postprocessPreset,
    intensity: state.postprocessIntensity,
    overrides: state.effectOverrides,
    playing: false,
    reduced: false,
    ink,
  });
  const opaque = !options.transparent;
  let dof: CaptureLook['dof'] = null;
  if (opaque && config.dof.enabled) {
    let focusDistance = config.dof.focusDistance;
    let focusRange = config.dof.focusRange;
    if (config.dof.auto) {
      const [px, py, pz] = state.cameraPosition;
      const [tx, ty, tz] = state.cameraTarget;
      const distance = Math.hypot(px - tx, py - ty, pz - tz);
      if (Number.isFinite(distance)) {
        focusDistance = distance;
        focusRange = Math.max(config.dof.focusRange, Math.min(90, distance * 0.08), 0.001);
      }
    }
    dof = {
      focusDistance: tidy(Math.max(0, focusDistance)),
      focusRange: tidy(Math.max(0.001, focusRange)),
      bokehScale: tidy(Math.max(0, config.dof.bokehScale)),
    };
  }
  return {
    toneMapping: config.toneMapping,
    ao: config.ssao.enabled
      ? { intensity: tidy(Math.max(0, config.ssao.intensity)), radius: tidy(Math.max(0.01, config.ssao.radius)) }
      : null,
    bloom: opaque && config.bloom.enabled
      ? {
        intensity: tidy(Math.max(0, config.bloom.intensity)),
        threshold: tidy(config.bloom.threshold),
        smoothing: tidy(Math.max(0.001, config.bloom.smoothing)),
      }
      : null,
    dof,
    vignette: opaque && config.vignette.enabled
      ? { offset: tidy(config.vignette.offset), darkness: tidy(config.vignette.darkness) }
      : null,
    // The contour inks the molecule only, so transparent output keeps it too.
    inkContour: ink && inkContourSwitchedOn()
      ? { inner: INK_CONTOUR_TUNING.innerLine, outer: INK_CONTOUR_TUNING.outerLine }
      : null,
  };
}

/** The spec's `view.ink.contour` for a look's contour. */
export function captureInkContourToSpec(contour: CaptureInkContour): RenderJsonObjectV1 {
  return { pipeline: INK_CONTOUR_PIPELINE_ID, inner: contour.inner, outer: contour.outer };
}

/** The spec's `view.postprocess` for a look (the V1 raw-scene literal when it is empty). */
export function captureLookToSpec(look: CaptureLook): RenderJsonObjectV1 {
  if (captureLookIsEmpty(look)) {
    return {
      pipeline: CAPTURE_RAW_PIPELINE,
      toneMapping: 'none',
      multisampling: 0,
      outputColorSpace: 'srgb',
    };
  }
  return {
    pipeline: CAPTURE_LOOK_PIPELINE,
    toneMapping: look.toneMapping,
    multisampling: 0,
    outputColorSpace: 'srgb',
    ao: look.ao ? { ...look.ao } : null,
    bloom: look.bloom ? { ...look.bloom } : null,
    dof: look.dof ? { ...look.dof } : null,
    vignette: look.vignette ? { ...look.vignette } : null,
  };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * The look a validated spec asks for: its `view.postprocess` and, when it
 * carries one, its `view.ink.contour`. A raw-scene (or missing) postprocess
 * is the empty recipe; an ink spec without a contour (one written before
 * `ink-contour.v1`) draws none. Values were range-checked by the spec
 * validation; this only reshapes them.
 */
export function captureLookFromSpec(postprocess: unknown, ink?: unknown): CaptureLook {
  const contour = record(record(ink)?.contour);
  const inkContour: CaptureInkContour | null = contour && contour.pipeline === INK_CONTOUR_PIPELINE_ID
    && finite(contour.inner) !== null && finite(contour.outer) !== null
    ? { inner: contour.inner as number, outer: contour.outer as number }
    : null;
  return { ...captureRecipeFromSpec(postprocess), inkContour };
}

function captureRecipeFromSpec(postprocess: unknown): CaptureLook {
  const value = record(postprocess);
  if (!value || value.pipeline !== CAPTURE_LOOK_PIPELINE) return EMPTY_CAPTURE_LOOK;
  const toneMapping: CaptureToneMapping = value.toneMapping === 'neutral' || value.toneMapping === 'aces'
    || value.toneMapping === 'reinhard'
    ? value.toneMapping
    : 'none';
  const ao = record(value.ao);
  const bloom = record(value.bloom);
  const dof = record(value.dof);
  const vignette = record(value.vignette);
  return {
    toneMapping,
    ao: ao && finite(ao.intensity) !== null && finite(ao.radius) !== null
      ? { intensity: ao.intensity as number, radius: ao.radius as number }
      : null,
    bloom: bloom && finite(bloom.intensity) !== null && finite(bloom.threshold) !== null && finite(bloom.smoothing) !== null
      ? { intensity: bloom.intensity as number, threshold: bloom.threshold as number, smoothing: bloom.smoothing as number }
      : null,
    dof: dof && finite(dof.focusDistance) !== null && finite(dof.focusRange) !== null && finite(dof.bokehScale) !== null
      ? { focusDistance: dof.focusDistance as number, focusRange: dof.focusRange as number, bokehScale: dof.bokehScale as number }
      : null,
    vignette: vignette && finite(vignette.offset) !== null && finite(vignette.darkness) !== null
      ? { offset: vignette.offset as number, darkness: vignette.darkness as number }
      : null,
    inkContour: null,
  };
}

/** Stable key of the stages a look runs (the GPU graph's shape). */
export function captureLookStructureKey(look: CaptureLook, transparent: boolean, coverage: boolean): string {
  return [
    look.ao ? 'ao' : '_',
    look.bloom ? 'bl' : '_',
    look.dof ? 'dof' : '_',
    look.vignette ? 'vg' : '_',
    look.toneMapping,
    transparent ? 'transparent' : 'opaque',
    coverage ? 'cov' : '_',
    look.inkContour ? 'ink' : '_',
  ].join('|');
}
