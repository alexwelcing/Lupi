/**
 * inkContour.ts — the Illustrate look's screen-space contour: the lines the
 * impostors cannot draw for themselves, on the live view and on every raster
 * export.
 *
 * Each impostor inks its own silhouette (scene tsl/inkLook.ts), so the
 * meeting line where two balls interpenetrate (space-filling), or where a
 * stick enters a ball, has no ink, and the molecule has no heavier outer
 * contour the way a hand-inked drawing does. This pass adds both from what
 * the picture already holds, one full-screen evaluation per pixel:
 * - inner lines, from a ring of eight depth taps around the pixel at about
 *   half the inner line width. Depth becomes view distance and each tap's
 *   difference from the centre is divided by the ring's footprint in world
 *   units (the centre's distance over the projection's pixel scale), so
 *   every measure is a slope: scale-free, the same for a close-up and a
 *   protein. Two of them draw:
 *   - creases: along each of the ring's four lines through the centre, how
 *     far the surface's slope turns inward (a valley: the centre lies behind
 *     both its neighbours). That is where two balls meet, or a stick enters
 *     a ball. Convex surfaces never draw, and a tap across a depth step is
 *     not on the crease's surface, so it is left out;
 *   - steps: the Sobel gradient of the ring, drawn only on the near side of
 *     the step (the side the impostors ink), so everything without its own
 *     ink (far-LOD clusters, bricks) is outlined too;
 * - the outer contour, the molecule against the plate, at the outer width
 *   (about twice the inner): the ring's eight directions read content
 *   coverage (the post chain's `lupiContent`) at three distances up to the
 *   outer width, and a pixel draws when plate lies on one side of a line
 *   through it and not on the other. A feature
 *   with plate on both sides closer than that (a thin bond across a hole)
 *   keeps its own outline instead of turning solid. The line lies inside the
 *   silhouette, so it never paints the plate (or a transparent export's
 *   background).
 *
 * Line widths are ink units, like the impostors' outlines: `unit` device
 * pixels (or output pixels) per unit, times the ink weight. The colour is the
 * drawing's ink (chalk under Chalk; scene `inkLookInkColor`), faded toward
 * the plate by the same depth cue the impostors apply. The
 * whole pass scales by `strength` (the live look's fade); it has no time and
 * no noise, so a still view stays still (Quiet Idle) and an export repeats.
 *
 * The ink, weight, plate and depth cue are the Illustrate uniforms the
 * impostors read (INK_LOOK; every capture renders them at the configured
 * target), so the contour and the outlines always agree.
 *
 * Adapted from Shaders (MIT), Chalkboard (`sobelTaps`, `chalkboardCompose`),
 * packages/core/src/std/effects/stylize.ts and
 * packages/core/src/gpu/kit/stylizePaints.ts: the eight-tap ring at a line
 * width and the Sobel gradient over it.
 */
import type { Node, TextureNode } from 'three/webgpu';
import {
  Fn,
  abs,
  clamp,
  float,
  int,
  max,
  mix,
  orthographicDepthToViewZ,
  perspectiveDepthToViewZ,
  round,
  select,
  smoothstep,
  sqrt,
  textureSize,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { INK_LOOK, INK_LOOK_TUNING, inkLookInkColor } from '@atlas/scene';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

/** `view.ink.contour.pipeline`: this pass, recorded in an ink spec. */
export const INK_CONTOUR_PIPELINE_ID = 'ink-contour.v1';

/**
 * Tuning points. Widths are ink units; the rest are slopes (depth change
 * over the ring's footprint) or coverage. The thresholds are part of
 * `ink-contour.v1`: changing them means a new pipeline id.
 */
export const INK_CONTOUR_TUNING = {
  /** Crease and step lines. */
  innerLine: 1.3,
  /** The molecule's outer contour against the plate (the drawings use about twice the inner line). */
  outerLine: 2.6,
  /** The depth ring's radius, as a share of the inner line. */
  innerReach: 0.6,
  /**
   * The ring is at least one texel per this many texels of picture height, so
   * it spans the same share of a tall phone canvas as of a desktop one.
   */
  ringPicture: 900,
  /** Crease: the inward turn of the slope across the ring, from faint to full ink. */
  crease: [0.22, 0.6] as const,
  /** Step: the ring's Sobel gradient (a slope), from faint to full ink. */
  step: [2.5, 5] as const,
  /** A tap steeper than this from the centre is across a step, not on a crease's surface. */
  jump: 2.5,
  /** Content coverage that reads as molecule (from plate to molecule). */
  content: [0.25, 0.75] as const,
  /** Slopes are clamped to this (the plate's depth is the far plane). */
  slopeLimit: 64,
  /** Depth buffer resolution, in steps of [0, 1] (24-bit depth), used as a noise floor for creases. */
  depthSteps: 2 ** 24,
  /** How many depth steps of slope noise a crease must clear. */
  grainMargin: 4,
} as const;

/**
 * The contour, unless the URL carries `?contour=0` (also inside a hash route
 * such as `#/mcp?contour=0`): a debug switch for before-and-after
 * comparisons. It leaves the contour out of the live view and of exports,
 * whose specs then record no `view.ink.contour` (the drawing before it).
 */
export function inkContourEnabled(
  search: string = typeof location === 'undefined' ? '' : location.search,
  hash: string = typeof location === 'undefined' ? '' : location.hash,
): boolean {
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
  const asked = new URLSearchParams(search).get('contour') ?? new URLSearchParams(hashQuery).get('contour');
  return asked !== '0';
}

let switchedOn: boolean | null = null;

/** `inkContourEnabled()` for this page, read once. */
export function inkContourSwitchedOn(): boolean {
  if (switchedOn === null) switchedOn = inkContourEnabled();
  return switchedOn;
}

/** The ring around a pixel, as Chalkboard orders it: tl, t, tr, l, r, bl, b, br. */
const RING = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
/** The ring's four lines through the centre: two taps and their distance in radii. */
const LINES = [[3, 4, 1], [1, 6, 1], [0, 7, Math.SQRT2], [2, 5, Math.SQRT2]] as const;
/** Where along each direction the outer contour looks for plate, as shares of its width. */
const OUTER_REACH = [1 / 3, 2 / 3, 1] as const;

export interface InkContourInput {
  /** This pixel's linear colour (premultiplied when `alpha` is its alpha). */
  color: Node;
  /** The alpha the ink is premultiplied by: the colour's own alpha, or 1 for an opaque picture whose alpha holds something else. */
  alpha: Node;
  /** The picture's depth (0 near, 1 cleared), one texel per pixel. */
  depth: TextureNode;
  /** Content coverage at a uv: 1 molecule, 0 plate. */
  coverage: (at: Node) => Node;
  /** The camera the picture was rendered with. */
  projectionMatrix: Node;
  viewMatrix: Node;
  near: Node;
  far: Node;
  /** Picture pixels per ink unit (the impostors' `uInkPx` for the same picture). */
  unit: Node;
  /** 0..1: how much of the contour shows. */
  strength: Node;
  /** Line widths, ink units. */
  inner: Node | number;
  outer: Node | number;
}

/**
 * The colour with the contour inked over it (linear, alpha unchanged). Every
 * input is sampled at the quad's `uv()`.
 */
export function inkContour(input: InkContourInput): Node {
  return (Fn(() => {
    const T = INK_CONTOUR_TUNING;
    const I = INK_LOOK as unknown as Record<keyof typeof INK_LOOK, N>;
    const depth = input.depth as N;
    const projection = input.projectionMatrix as N;
    const near = input.near as N;
    const far = input.far as N;
    const at: N = uv().toVar();
    const size: N = vec2((textureSize as N)(depth, int(0))).toVar();
    const texel: N = vec2(1).div(size).toVar();
    const ortho: N = projection.element(3).w.greaterThan(0.5);
    const distanceAt = (raw: N): N => select(
      ortho,
      orthographicDepthToViewZ(raw, near, far),
      perspectiveDepthToViewZ(raw, near, far),
    ).negate();

    const unit = (input.unit as N).mul(I.uInkWeight).toVar();
    const innerPx = unit.mul(input.inner as N).toVar();
    const outerPx = unit.mul(input.outer as N).toVar();

    // Inner lines: the depth ring at a little over half the inner width (a
    // crease line spans the ring on both sides of it and thins toward its
    // edges). Offsets are whole texels: a fractional one samples a stepped
    // edge differently on alternate rows and combs it.
    // A tall canvas (a phone held upright, at DPR 2–3) keeps the ring's share
    // of the picture: with one texel, its footprint shrinks while the depth
    // grain at the fitted distance grows, and the grain swallows the creases.
    const ringFloor = max(round(size.y.div(T.ringPicture)), 1.0);
    const radius = max(round(innerPx.mul(T.innerReach)), ringFloor).toVar();
    const centreRaw = (depth.sample(at) as N).r.toVar();
    const zc = distanceAt(centreRaw).toVar();
    // The ring's footprint in world units at the centre's distance:
    // |P[1][1]| × height / 2 pixels per unit of y over distance.
    const pixelsPerUnit = abs(projection.element(1).y).mul(size.y).mul(0.5);
    const footprint = max(select(ortho, float(1), zc).div(max(pixelsPerUnit, 1e-6)).mul(radius), 1e-6).toVar();
    const limit = float(T.slopeLimit);
    const slopes: N[] = RING.map(([x, y]) => {
      const raw = (depth.sample(at.add(vec2(x, y).mul(radius).mul(texel))) as N).r;
      return clamp(distanceAt(raw).sub(zc).div(footprint), limit.negate(), limit).toVar();
    });
    const [tl, t, tr, l, r, bl, b, br] = slopes;

    // Steps: Chalkboard's Sobel over the ring (8 = its weight on a unit slope),
    // drawn on the near side only (the far taps are farther than the near
    // ones are nearer).
    const gx = tr.add(r.mul(2)).add(br).sub(tl).sub(l.mul(2)).sub(bl);
    const gy = bl.add(b.mul(2)).add(br).sub(tl).sub(t.mul(2)).sub(tr);
    const gradient = sqrt(gx.mul(gx).add(gy.mul(gy))).div(8);
    let farthest: N = slopes[0];
    let nearest: N = slopes[0];
    for (const slope of slopes.slice(1)) {
      farthest = max(farthest, slope);
      nearest = nearest.min(slope);
    }
    const nearSide = farthest.greaterThan(nearest.negate());
    const step = select(nearSide, smoothstep(T.step[0], T.step[1], gradient), float(0));

    // Creases: the inward turn of the slope along each line, without taps
    // across a step, above the depth buffer's own grain at this distance.
    const steps = float(T.depthSteps);
    const grain = select(ortho, far.sub(near).div(steps), zc.mul(zc).div(max(near, 1e-6).mul(steps))).div(footprint);
    let crease: N = float(0);
    for (const [a, c, span] of LINES) {
      const onSurface = max(abs(slopes[a]), abs(slopes[c])).lessThan(T.jump * span);
      const turn = slopes[a].add(slopes[c]).negate().div(span).sub(grain.mul(T.grainMargin));
      crease = max(crease, select(onSurface, turn, float(0)));
    }
    const inner = max(step, smoothstep(T.crease[0], T.crease[1], crease))
      .mul(clamp(innerPx, 0, 1)) // hairlines fade rather than break up
      .mul(centreRaw.lessThan(1.0).select(float(1), float(0)));

    // The outer contour: plate within the outer width on one side of a line
    // through the pixel. Each direction is read at three distances, so a
    // sliver of plate between two atoms is never stepped over.
    const reach = max(outerPx, 1.0).toVar();
    const plate: N[] = RING.map(([x, y]) => {
      const direction = vec2(x, y).div(Math.hypot(x, y));
      let found: N = float(0);
      for (const share of OUTER_REACH) {
        const covered = input.coverage(at.add(round(direction.mul(reach.mul(share))).mul(texel))) as N;
        found = max(found, float(1).sub(smoothstep(T.content[0], T.content[1], covered)));
      }
      return found.toVar();
    });
    let outer: N = float(0);
    for (const [a, c] of LINES) outer = max(outer, abs(plate[a].sub(plate[c])));
    const content = clamp(input.coverage(at) as N, 0, 1);
    outer = outer.mul(content).mul(clamp(outerPx, 0, 1));

    // The impostors' depth cue: the back of the molecule's bounding sphere fades toward the plate.
    const sphere = I.uInkRadius.toVar();
    const centreDepth = (input.viewMatrix as N).mul(vec4(I.uInkCenter, 1.0)).z.negate();
    const across = zc.sub(centreDepth.sub(sphere)).div(max(sphere.mul(2.0), 1e-3));
    const cue = smoothstep(INK_LOOK_TUNING.depthCueFrom, 1.0, clamp(across, 0.0, 1.0))
      .mul(INK_LOOK_TUNING.depthCue)
      .mul(sphere.greaterThan(1e-3).select(float(1), float(0)));
    const inkColor = mix(inkLookInkColor() as N, vec3(I.uPlateColor), cue);

    const amount = clamp(max(inner, outer), 0, 1).mul(clamp(input.strength as N, 0, 1));
    const color = input.color as N;
    return vec4(mix(color.rgb, inkColor.mul(input.alpha as N), amount), color.a);
  }) as N)();
}
