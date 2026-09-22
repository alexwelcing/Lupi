@group(0) @binding(0) var<uniform> resolution: vec2f;
@group(0) @binding(1) var<uniform> time: f32;
@group(0) @binding(2) var<uniform> energy: f32;
@group(0) @binding(3) var<uniform> reveal: f32;
@group(0) @binding(4) var<uniform> seed: f32;

// The scan swirl: a spiral of specks that whirls while the edge is looking at
// the photo, then tightens and fades as the answer materializes. Pastel Lupi
// colours only, so the photo underneath still reads and native text keeps its
// contrast. Premultiplied alpha; the canvas sits over the preview.

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += vec2f(dot(q, q + vec2f(45.32)));
  return fract(q.x * q.y);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2f) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var q = p;
  for (var i = 0; i < 4; i++) {
    value += amplitude * noise2(q);
    q = q * 2.03 + vec2f(1.7, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

@fragment fn scanSwirl(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = resolution.x / max(resolution.y, 1.0);
  let p = (uv - vec2f(0.5)) * vec2f(aspect, 1.0);
  let r = length(p);
  let angle = atan2(p.y, p.x);

  // The spiral tightens toward the centre as the answer arrives.
  let tighten = mix(1.0, 0.35, reveal);
  let twist = angle + energy * (2.2 / (r * 2.0 + 0.25)) - time * 0.9;
  let warp = fbm(vec2f(r * 5.0 * tighten - time * 0.7 + seed, twist * 1.6));
  let bands = 0.5 + 0.5 * sin(twist * 5.0 + warp * 6.0 + r * 18.0 * tighten - time * 2.4);
  let ringOffset = (r - mix(0.42, 0.16, reveal)) / mix(0.28, 0.06, reveal);
  let ring = exp(-ringOffset * ringOffset);

  // Atoms: a moving grid of specks riding the spiral.
  let cell = vec2f(twist * 4.0, r * 30.0 * tighten - time * 3.0);
  let id = floor(cell);
  let speck = hash21(id + vec2f(seed));
  let local = fract(cell) - vec2f(0.5);
  let speckLight = exp(-dot(local, local) * 40.0) * step(0.72, speck);

  let glow = ring * (0.35 + 0.65 * bands) + speckLight * 1.2 * ring;
  let hue = fbm(vec2f(twist * 0.8 + seed, r * 3.0 - time * 0.3));
  let lime = vec3f(0.835, 0.937, 0.612);
  let cyan = vec3f(0.518, 0.843, 1.0);
  let pink = vec3f(0.953, 0.663, 0.780);
  var tint = mix(cyan, lime, smoothstep(0.3, 0.7, hue));
  tint = mix(tint, pink, speckLight * 0.8);

  let centre = exp(-r * r * 14.0) * energy * 0.35;
  let alpha = clamp((glow * energy + centre) * (1.0 - reveal * 0.85), 0.0, 1.0);
  return vec4f((tint + vec3f(speckLight * 0.5)) * alpha, alpha);
}
