@group(0) @binding(0) var<uniform> resolution: vec2f;
@group(0) @binding(1) var<uniform> pointer: vec2f;
@group(0) @binding(2) var<uniform> phase: f32;
@group(0) @binding(3) var<uniform> energy: f32;

// A small optical field, not a second molecular scene. Light stays pastel so
// native dark text retains its contrast even at the brightest part of a ripple.
@fragment fn actionLight(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = resolution.x / max(resolution.y, 1.0);
  let point = (uv - pointer) * vec2f(aspect, 1.0);
  let distance = length(point);
  let lens = exp(-distance * distance * 0.9);
  let bend = uv.x * 9.0 + uv.y * 2.0 + lens * 2.5 - phase * 1.4;
  let spectrum = 0.5 + 0.5 * cos(vec3f(bend, bend + 2.1, bend + 4.2));
  let tint = vec3f(0.65, 0.76, 0.72) + spectrum * vec3f(0.35, 0.24, 0.28);
  let ring = exp(-pow((distance - phase * 1.7) / 0.045, 2.0));
  let filament = pow(0.5 + 0.5 * sin(bend * 2.3), 14.0);
  let light = mix(tint, vec3f(1.0), ring * 0.65 + filament * 0.18);
  let alpha = (lens * 0.62 + filament * 0.14 + ring * 0.24) * energy;
  return vec4f(light * alpha, alpha);
}
