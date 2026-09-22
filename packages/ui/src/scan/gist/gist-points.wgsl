// Draws the gist particles as soft billboarded discs: six vertices per
// instance, no geometry buffers. Colour comes from the gist's palette, mixed
// by height, and brightened where a particle has settled onto the surface.
// Premultiplied alpha over the photo.

struct Particle {
  pos: vec3f,
  seed: f32,
  vel: vec3f,
  glow: f32,
}

struct Camera {
  viewProjection: mat4x4f,
  main: vec3f,
  aspect: f32,
  accent: vec3f,
  size: f32,
  time: f32,
  attract: f32,
  fade: f32,
  pad: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct Out {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) tint: vec3f,
  @location(2) alpha: f32,
}

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let particle = particles[i];
  let clip = camera.viewProjection * vec4f(particle.pos, 1.0);
  let corner = corners[v];
  let settled = mix(0.55, 1.0, particle.glow);
  let size = camera.size * (0.7 + 0.6 * particle.seed) * mix(1.0, 0.8, camera.attract) * settled;
  var out: Out;
  out.position = clip + vec4f(corner * size * clip.w * vec2f(1.0 / max(camera.aspect, 1e-3), 1.0), 0.0, 0.0);
  out.uv = corner;
  let height = clamp(particle.pos.y * 0.5 + 0.5, 0.0, 1.0);
  let base = mix(camera.main, camera.accent, height * 0.7 + particle.seed * 0.3);
  out.tint = mix(base, vec3f(1.0), particle.glow * 0.35);
  out.alpha = (0.45 + 0.55 * particle.glow) * camera.fade;
  return out;
}

@fragment fn fs(@location(0) uv: vec2f, @location(1) tint: vec3f, @location(2) alpha: f32) -> @location(0) vec4f {
  let r = length(uv);
  let disc = 1.0 - smoothstep(0.55, 1.0, r);
  let core = exp(-r * r * 6.0);
  let a = clamp((disc * 0.8 + core * 0.5) * alpha, 0.0, 1.0);
  return vec4f((tint + vec3f(core * 0.25)) * a, a);
}
