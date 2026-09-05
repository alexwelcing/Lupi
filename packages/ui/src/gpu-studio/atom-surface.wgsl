// Decorative latitude lines on display spheres, not a calculated molecular field.
// Both looks run through this vgpu export. Three owns lighting and tone mapping.
export fn atomSurface(position: vec3f, baseColor: vec3f, contour: f32) -> vec3f {
  let wave = abs(sin(position.y * 36.0 + position.x * 2.0));
  let width = max(fwidth(wave) * 1.2, 0.045);
  let line = 1.0 - smoothstep(0.08, 0.08 + width, wave);
  let ink = mix(baseColor * 0.16, vec3f(0.68, 0.95, 0.77), line * 0.85);
  return mix(baseColor, ink, contour);
}
