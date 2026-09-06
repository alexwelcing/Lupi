fn snowHash(p: f32) -> f32 {
  return fract(sin(p * 127.1 + 311.7) * 43758.5453);
}

// A refracted miniature world in each display sphere. Analytic, gravity-inspired
// glitter trajectories are a creative material, not atom dynamics or electron density.
fn snowWorld(n: vec3f, tint: vec3f, time: f32, energy: f32, drift: vec3f, seed: f32) -> vec3f {
  let origin = normalize(n);
  let ray = normalize(vec3f(-origin.xy * 0.23, -1.0));
  let rim = pow(1.0 - max(origin.z, 0.0), 2.4);
  let pearl = 0.5 + 0.5 * cos(vec3f(0.0, 2.1, 4.2) + origin.y * 3.0 + origin.x * 2.0);
  var result = mix(vec3f(0.018, 0.04, 0.10), tint * 0.22 + vec3f(0.025, 0.065, 0.11), 0.65);
  result += pearl * rim * 0.52;
  // A softly curved snow bed makes the interior readable even at rest.
  let bed = 1.0 - smoothstep(-0.77, -0.60, origin.y + origin.z * 0.12);
  result = mix(result, vec3f(0.43, 0.64, 0.75), bed * (1.0 - rim * 0.6));
  for (var i = 0; i < 28; i++) {
    let id = f32(i) + seed * 37.0;
    let h = vec3f(snowHash(id + 1.0), snowHash(id + 8.2), snowHash(id + 19.4));
    let phase = h.x * 6.283185 + time * (0.6 + h.z);
    let orbit = sqrt(h.y) * 0.69;
    let swirl = vec3f(cos(phase) * orbit, sin(phase * 1.3 + h.z * 5.0) * 0.65, sin(phase) * orbit);
    let resting = vec3f((h.x - 0.5) * 1.1, -0.68 + h.z * 0.12, (h.y - 0.5) * 0.7);
    var p = mix(resting, swirl, sqrt(energy));
    p += drift * energy * 0.16;
    p *= min(1.0, 0.85 / max(length(p), 0.001));
    let distanceAlongRay = dot(p - origin, ray);
    let offset = p - (origin + ray * max(distanceAlongRay, 0.0));
    let radius = 0.014 + h.z * 0.024;
    let distanceToFlake = length(offset);
    let aa = max(fwidth(distanceToFlake), 0.003);
    let flake = 1.0 - smoothstep(radius, radius + aa, distanceToFlake);
    let glow = exp(-distanceToFlake * distanceToFlake / (radius * radius * 8.0)) * 0.14;
    let depth = 0.45 + (p.z + 1.0) * 0.35;
    let ice = mix(vec3f(0.4, 0.85, 1.0), vec3f(1.0, 0.88, 0.63), h.x);
    result += ice * (flake * 1.6 + glow) * depth;
  }
  // Bright curved softbox reflections, with a darker outer lip: glass, not chrome.
  let highlight = exp(-pow((origin.x + 0.38) / 0.105, 2.0) - pow((origin.y - 0.42) / 0.32, 2.0));
  result += vec3f(0.65, 0.85, 1.0) * highlight * 0.95;
  return result * (1.0 - smoothstep(0.9, 1.0, rim) * 0.45);
}

export fn atomSurface(position: vec3f, viewNormal: vec3f, baseColor: vec3f, contour: f32, emphasis: f32, snow: f32, time: f32, energy: f32, drift: vec3f, seed: f32) -> vec3f {
  if (snow > 0.5) {
    return mix(vec3f(0.018, 0.026, 0.04), snowWorld(viewNormal, baseColor, time, energy, drift, seed), emphasis);
  }
  let wave = abs(sin(position.y * 22.0 + position.x * 2.0));
  let width = max(fwidth(wave) * 1.2, 0.045);
  let line = 1.0 - smoothstep(0.08, 0.08 + width, wave);
  let ink = mix(baseColor * 0.24, vec3f(0.68, 0.95, 0.77), line * 0.65);
  let surface = mix(baseColor, ink, contour);
  return mix(vec3f(0.025, 0.04, 0.035), surface, emphasis);
}
