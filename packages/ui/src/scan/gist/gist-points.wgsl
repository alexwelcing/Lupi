// Draws the gist particles as small shaded discs: six vertices per instance,
// no geometry buffers, perspective-correct world size so the settled cloud
// reads as a surface. Each settled particle carries the surface normal the
// step kernel found, so a key light, a rim, and the gist's two colours give
// the cloud the density and shading of a splat at rest. Premultiplied alpha.

struct Particle {
  pos: vec3f,
  seed: f32,
  vel: vec3f,
  glow: f32,
  nrm: vec3f,
  color: u32,
}

struct Camera {
  viewProjection: mat4x4f,
  main: vec3f,
  aspect: f32,
  accent: vec3f,
  size: f32,
  light: vec3f,
  time: f32,
  eye: vec3f,
  attract: f32,
  fade: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct Out {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) tint: vec3f,
  @location(2) alpha: f32,
  @location(3) settled: f32,
}

// Scale of the perspective divide for the vertical field of view, so a disc
// keeps its world size: 1 / tan(fov / 2) for the 34 degree camera.
const PROJECTION_SCALE: f32 = 3.27;

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let particle = particles[i];
  let clip = camera.viewProjection * vec4f(particle.pos, 1.0);
  let corner = corners[v];
  let settled = clamp(particle.glow, 0.0, 1.0) * camera.attract;
  // Whirling particles are larger and airy; settled ones shrink into a dense skin.
  let worldSize = camera.size * (0.75 + 0.5 * particle.seed) * mix(1.5, 1.0, settled);
  var out: Out;
  out.position = clip + vec4f(corner * worldSize * PROJECTION_SCALE * vec2f(1.0 / max(camera.aspect, 1e-3), 1.0), 0.0, 0.0);
  out.uv = corner;

  let height = clamp(particle.pos.y * 0.5 + 0.5, 0.0, 1.0);
  // The per-particle hue nudge comes from the seed; the photo colour, when the
  // particle was born from a pixel, wins over the palette.
  let hue = fract(particle.seed * 7.31);
  let photo = unpack4x8unorm(particle.color);
  var base = mix(camera.main, camera.accent, clamp(height * 0.45 + (hue - 0.5) * 0.5, 0.0, 1.0));
  base = mix(base, base * vec3f(1.08, 1.0, 0.92), height * 0.3);
  base = mix(base, photo.rgb, photo.a * 0.85);
  let n = normalize(particle.nrm + vec3f(1e-4));
  let toEye = normalize(camera.eye - particle.pos);
  let diffuse = 0.32 + 0.68 * max(dot(n, camera.light), 0.0);
  let rim = pow(1.0 - max(dot(n, toEye), 0.0), 3.0) * 0.35;
  let speck = 0.5 + 0.5 * hue;
  let lit = base * (diffuse * (0.85 + 0.3 * speck)) + camera.accent * rim + vec3f(0.12) * pow(max(dot(reflect(-camera.light, n), toEye), 0.0), 24.0);
  // Airy pastel while whirling (the photo's own colours when it has them), shaded skin once settled.
  let airy = mix(mix(base, vec3f(1.0), 0.35), photo.rgb, photo.a * 0.9);
  out.tint = mix(airy, lit, settled);
  // Thousands of airborne discs overlap, so each stays faint; the skin is nearly opaque.
  out.alpha = mix(mix(0.12, 0.5, photo.a), 0.95, settled) * camera.fade;
  out.settled = settled;
  return out;
}

@fragment fn fs(@location(0) uv: vec2f, @location(1) tint: vec3f, @location(2) alpha: f32, @location(3) settled: f32) -> @location(0) vec4f {
  let r = length(uv);
  // A firmer edge once settled so neighbouring discs tile into a surface.
  let edge = mix(0.45, 0.72, settled);
  let disc = 1.0 - smoothstep(edge, 1.0, r);
  let core = exp(-r * r * 5.0) * (1.0 - settled) * 0.5;
  let a = clamp((disc + core) * alpha, 0.0, 1.0);
  return vec4f((tint + vec3f(core * 0.3)) * a, a);
}
