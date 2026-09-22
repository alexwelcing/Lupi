// Particle step for the gist stage. Each particle is pulled onto the signed
// distance surface of a handful of blended primitives (the gist) while a
// swirl keeps everything moving. `energy` is the swirl, `attract` is the pull
// to the surface: both 0..1, eased on the CPU, so the same kernel does the
// whirl, the settle, and the morph when the gist changes underneath it.

// 64 bytes. `nrm` is the surface normal where the particle last settled, for
// shading; `color` is a packed RGBA8: the photo pixel this particle was born
// from (alpha 255), or 0 when it has no photo and wears the palette; `home`
// is where that pixel sits in the world, and a homed particle settles on the
// shape at its own pixel, so the front face reassembles as the photo.
struct Particle {
  pos: vec3f,
  seed: f32,
  vel: vec3f,
  glow: f32,
  nrm: vec3f,
  color: u32,
  home: vec3f,
  homed: f32,
}

// 96 bytes: rot0..rot2 are the rows of the primitive's rotation matrix, so
// building a mat3x3f from them as columns gives the inverse rotation that
// takes a world point into the primitive's own frame. A lathe (kind 7)
// stands upright and uses those twelve floats as its radii, top to bottom.
struct Prim {
  center: vec3f,
  kind: u32,
  size: vec3f,
  blend: f32,
  rot0: vec4f,
  rot1: vec4f,
  rot2: vec4f,
  subtract: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

struct Params {
  time: f32,
  dt: f32,
  energy: f32,
  attract: f32,
  count: u32,
  primCount: u32,
  seed: f32,
  pad: f32,
  volumeOrigin: vec3f,
  volumeCell: f32,
  volumeN: u32,
  volumeActive: u32,
  pad2: u32,
  pad3: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> prims: array<Prim>;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;
// The rawest shape there is: a signed distance at every cell of an n³ grid,
// built on the CPU from the photo's own silhouette. x fastest, then y, then z.
@group(0) @binding(3) var<storage, read> volume: array<f32>;
// The volume's front face: half depth per (x, y) column, same grid, x fastest.
@group(0) @binding(4) var<storage, read> front: array<f32>;

// Bilinear front depth at a world (x, y); zero off the object.
fn frontDepth(xy: vec2f) -> f32 {
  let n = params.volumeN;
  let g = (xy - params.volumeOrigin.xy) / params.volumeCell - vec2f(0.5);
  let c = clamp(g, vec2f(0.0), vec2f(f32(n) - 1.001));
  let i0 = vec2u(floor(c));
  let i1 = min(i0 + vec2u(1u), vec2u(n - 1u));
  let f = c - floor(c);
  let a = mix(front[i0.x + n * i0.y], front[i1.x + n * i0.y], f.x);
  let b = mix(front[i0.x + n * i1.y], front[i1.x + n * i1.y], f.x);
  return mix(a, b, f.y);
}

// Kinds, in the order `KIND_INDEX` packs them: sphere, ellipsoid, box,
// cylinder, capsule, cone, torus, lathe, arc.

fn hash13(p: vec3f) -> f32 {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += vec3f(dot(q, q.yzx + vec3f(33.33)));
  return fract((q.x + q.y) * q.z);
}

fn hash33(p: vec3f) -> vec3f {
  return vec3f(hash13(p), hash13(p + vec3f(17.1, 3.7, 9.3)), hash13(p + vec3f(4.2, 21.9, 1.7)));
}

fn sdSphere(p: vec3f, r: f32) -> f32 {
  return length(p) - r;
}

fn sdEllipsoid(p: vec3f, r: vec3f) -> f32 {
  let k0 = length(p / r);
  let k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}

fn sdBox(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdCylinder(p: vec3f, r: f32, h: f32) -> f32 {
  let d = abs(vec2f(length(p.xz), p.y)) - vec2f(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

fn sdCapsule(p: vec3f, r: f32, h: f32) -> f32 {
  var q = p;
  q.y -= clamp(q.y, -h, h);
  return length(q) - r;
}

fn sdCone(p: vec3f, rb: f32, h: f32, rt: f32) -> f32 {
  // Capped cone along Y: bottom radius rb at y = -h, top radius rt at y = +h.
  let q = vec2f(length(p.xz), p.y);
  let k1 = vec2f(rt, h);
  let k2 = vec2f(rt - rb, 2.0 * h);
  let ca = vec2f(q.x - min(q.x, select(rb, rt, q.y < 0.0)), abs(q.y) - h);
  let cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / max(dot(k2, k2), 1e-6), 0.0, 1.0);
  let s = select(1.0, -1.0, cb.x < 0.0 && ca.y < 0.0);
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

fn sdTorus(p: vec3f, ring: f32, tube: f32) -> f32 {
  let q = vec2f(length(p.xz) - ring, p.y);
  return length(q) - tube;
}

fn latheRadiusAt(prim: Prim, band: u32) -> f32 {
  switch band {
    case 0u: { return prim.rot0.x; }
    case 1u: { return prim.rot0.y; }
    case 2u: { return prim.rot0.z; }
    case 3u: { return prim.rot0.w; }
    case 4u: { return prim.rot1.x; }
    case 5u: { return prim.rot1.y; }
    case 6u: { return prim.rot1.z; }
    case 7u: { return prim.rot1.w; }
    case 8u: { return prim.rot2.x; }
    case 9u: { return prim.rot2.y; }
    case 10u: { return prim.rot2.z; }
    default: { return prim.rot2.w; }
  }
}

// A solid of revolution: the photo's outline turned around Y. Radii run top
// to bottom; `scale` widens or slims the whole profile at once.
fn sdLathe(prim: Prim, p: vec3f, scale: f32, halfHeight: f32) -> f32 {
  let t = clamp((halfHeight - p.y) / max(2.0 * halfHeight, 1e-5), 0.0, 1.0) * 11.0;
  let lower = u32(floor(t));
  let radius = mix(latheRadiusAt(prim, lower), latheRadiusAt(prim, min(lower + 1u, 11u)), t - floor(t)) * scale;
  let dr = length(p.xz) - radius;
  let dy = abs(p.y) - halfHeight;
  let d = vec2f(dr, dy);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

// A tube bent along a circular arc in XY, opening upward: half angle `aperture`.
fn sdArc(p: vec3f, ra: f32, rb: f32, aperture: f32) -> f32 {
  let q = vec2f(abs(p.x), p.y);
  let sc = vec2f(sin(aperture), cos(aperture));
  var d: f32;
  if (sc.y * q.x > sc.x * q.y) {
    d = length(vec3f(q - sc * ra, p.z));
  } else {
    d = length(vec2f(length(q) - ra, p.z));
  }
  return d - rb;
}

fn sdPrim(prim: Prim, world: vec3f) -> f32 {
  if (prim.kind == 7u) {
    return sdLathe(prim, world - prim.center, prim.size.x, prim.size.y);
  }
  let p = mat3x3f(prim.rot0.xyz, prim.rot1.xyz, prim.rot2.xyz) * (world - prim.center);
  let s = prim.size;
  switch prim.kind {
    case 0u: { return sdSphere(p, s.x); }
    case 1u: { return sdEllipsoid(p, s); }
    case 2u: { return sdBox(p, s); }
    case 3u: { return sdCylinder(p, s.x, s.y); }
    case 4u: { return sdCapsule(p, s.x, s.y); }
    case 5u: { return sdCone(p, s.x, s.y, s.z); }
    case 8u: { return sdArc(p, s.x, s.y, s.z); }
    default: { return sdTorus(p, s.x, s.y); }
  }
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  if (k <= 0.0) { return min(a, b); }
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn volumeAt(x: u32, y: u32, z: u32) -> f32 {
  let n = params.volumeN;
  return volume[x + n * (y + n * z)];
}

// Trilinear sample of the volume's signed distance; outside the grid, the
// distance to the grid box is added so nothing far away sees a flat field.
fn sdVolume(p: vec3f) -> f32 {
  let n = params.volumeN;
  let g = (p - params.volumeOrigin) / params.volumeCell - vec3f(0.5);
  let c = clamp(g, vec3f(0.0), vec3f(f32(n) - 1.001));
  let i0 = vec3u(floor(c));
  let i1 = min(i0 + vec3u(1u), vec3u(n - 1u));
  let f = c - floor(c);
  let c00 = mix(volumeAt(i0.x, i0.y, i0.z), volumeAt(i1.x, i0.y, i0.z), f.x);
  let c10 = mix(volumeAt(i0.x, i1.y, i0.z), volumeAt(i1.x, i1.y, i0.z), f.x);
  let c01 = mix(volumeAt(i0.x, i0.y, i1.z), volumeAt(i1.x, i0.y, i1.z), f.x);
  let c11 = mix(volumeAt(i0.x, i1.y, i1.z), volumeAt(i1.x, i1.y, i1.z), f.x);
  let inner = mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
  let outside = length(max(g - c, c - g)) * params.volumeCell;
  return inner + outside;
}

fn sdScene(p: vec3f) -> f32 {
  var d = 1e5;
  if (params.volumeActive != 0u) {
    d = sdVolume(p);
  }
  for (var i = 0u; i < params.primCount; i++) {
    let prim = prims[i];
    if (prim.subtract != 0u) { continue; }
    d = smin(d, sdPrim(prim, p), prim.blend);
  }
  for (var i = 0u; i < params.primCount; i++) {
    let prim = prims[i];
    if (prim.subtract == 0u) { continue; }
    d = max(d, -sdPrim(prim, p));
  }
  return d;
}

fn sceneNormal(p: vec3f) -> vec3f {
  // Over a sampled volume the step spans most of a cell, so the normal turns
  // smoothly across the grid instead of snapping at every cell boundary.
  var e = 0.012;
  if (params.volumeActive != 0u) {
    e = max(e, params.volumeCell * 0.75);
  }
  let k = vec2f(1.0, -1.0);
  let n = k.xyy * sdScene(p + k.xyy * e) + k.yyx * sdScene(p + k.yyx * e) + k.yxy * sdScene(p + k.yxy * e) + k.xxx * sdScene(p + k.xxx * e);
  let len = length(n);
  if (len < 1e-6) { return vec3f(0.0, 1.0, 0.0); }
  return n / len;
}

@compute @workgroup_size(64)
fn step(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }
  var particle = particles[i];
  let p = particle.pos;
  let seed = particle.seed;
  let t = params.time;

  // Every particle owns a direction on the sphere around the object (uniform
  // by construction) and a height on the ring. The swirl keeps it on the
  // ring; the pull sends it toward its anchor direction, and the surface
  // catches it there. That is what spreads particles over the whole shape,
  // poles included, instead of piling them on the equator.
  let own = hash33(vec3f(seed * 7.7, seed * 3.1 + 1.0, 2.0));
  let baseY = (own.x - 0.5) * 1.5;
  let cosTheta = own.y * 2.0 - 1.0;
  let sinTheta = sqrt(max(1.0 - cosTheta * cosTheta, 0.0));
  let phi = own.z * 6.2831853 + t * 0.12;
  var anchor = vec3f(sinTheta * cos(phi), cosTheta, sinTheta * sin(phi)) * 1.5;
  // With a photo volume the front face belongs to the homed pixels; everything
  // else anchors behind, wrapping the sides and the back.
  if (params.volumeActive != 0u && particle.homed < 0.5) {
    anchor.z = -abs(anchor.z) - 0.2;
  }

  // The swirl: a ring of particles whirling around the vertical axis, breathing in height.
  let radial = vec3f(p.x, 0.0, p.z);
  let radius = max(length(radial), 1e-3);
  let tangent = vec3f(-p.z, 0.0, p.x) / radius;
  let ringRadius = 1.15 + 0.45 * seed;
  let wobble = sin(t * 1.7 + seed * 31.0) * 0.35;
  var swirl = tangent * (1.4 + 1.2 * seed) - radial / radius * (radius - ringRadius) * 2.2 + vec3f(0.0, (baseY + wobble - p.y) * 1.2, 0.0);
  swirl += (hash33(vec3f(seed * 91.0, t * 0.7, f32(i))) - vec3f(0.5)) * 0.6;

  // The pull: a strong spring onto the surface, a weak one toward the
  // anchor (which drifts, so the settled particles keep sliding), a shimmer.
  var pull = vec3f(0.0);
  var glow = 0.0;
  var nrm = particle.nrm;
  if (params.attract > 0.001) {
    let d = sdScene(p);
    let n = sceneNormal(p);
    if (particle.homed > 0.5 && params.volumeActive != 0u) {
      // A homed particle knows exactly where it belongs: its own pixel, at
      // the front face's depth there. One stiff spring, no field to slide
      // on, so a table leg four cells wide holds its pixels as well as a
      // wall does. The field still gives the normal for shading.
      let goalPoint = vec3f(particle.home.xy, frontDepth(particle.home.xy) + 0.004);
      let away = goalPoint - p;
      pull = away * 7.0 + (hash33(vec3f(f32(i), t * 2.0, seed)) - vec3f(0.5)) * 0.05;
      glow = 1.0 - clamp(length(away) * 5.0, 0.0, 1.0);
    } else {
      pull = -n * d * 9.0 + (anchor - p) * 0.5 + (hash33(vec3f(f32(i), t * 2.0, seed)) - vec3f(0.5)) * 0.15;
      glow = 1.0 - clamp(abs(d) * 5.0, 0.0, 1.0);
    }
    nrm = normalize(mix(nrm, n, 0.35) + vec3f(1e-5));
  }

  // A homed particle that has been caught stops whirling, or the residual
  // swirl would push every pixel off its column, most of all near the axis.
  let goal = swirl * params.energy * mix(1.0, 0.1, particle.homed * params.attract) + pull * params.attract;
  var vel = mix(particle.vel, goal, 0.18);
  var pos = p + vel * params.dt;

  // Anything flung away comes back in on the ring.
  if (length(pos) > 5.0 || !(pos.x == pos.x)) {
    let r = hash33(vec3f(f32(i), t, params.seed));
    let a = r.x * 6.2831853;
    pos = vec3f(cos(a) * ringRadius, (r.y - 0.5) * 1.5, sin(a) * ringRadius);
    vel = vec3f(0.0);
  }

  particle.pos = pos;
  particle.vel = vel;
  particle.glow = mix(particle.glow, glow, 0.2);
  particle.nrm = nrm;
  particles[i] = particle;
}
