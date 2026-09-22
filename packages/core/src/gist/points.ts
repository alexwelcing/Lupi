/**
 * Coloured points: the dots themselves, in the rawest useful form.
 *
 * A remote reconstruction (SAM 3D Objects, through a Space) answers with a
 * mesh of a million faces and twenty megabytes. The particles want none of
 * that: they want a few tens of thousands of positions with a colour each.
 * So the edge parses the GLB, samples the surface by area, and packs the
 * points as `lupi.points.v1`: a 32-byte header, then 9 bytes per point
 * (x, y, z as unsigned 16-bit fractions of the bounding box, then r, g, b).
 * Sixty thousand points are 540 kB. The page unpacks them straight into
 * the particle homes.
 *
 * Coordinates are normalised here: centred on the bounding box, the longest
 * side scaled to `extent`, y up, z toward the camera (the mesh's own frame
 * is kept; `orient` remaps axes if a source needs it).
 */

export interface ColouredPoints {
  count: number;
  /** xyz, interleaved, world units. */
  positions: Float32Array;
  /** rgb, interleaved, 0..255. */
  colors: Uint8Array;
  /** Unit normal per point, interleaved, as signed bytes (-127..127). */
  normals: Int8Array;
  /** Bounding box of the positions. */
  min: [number, number, number];
  max: [number, number, number];
}

export interface GlbMesh {
  positions: Float32Array;
  /** rgb per vertex, 0..255, or null when the mesh carries no colour. */
  colors: Uint8Array | null;
  indices: Uint32Array | null;
  vertexCount: number;
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
}
interface GltfBufferView {
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}
interface Gltf {
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number; mode?: number }> }>;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/**
 * Read an accessor into a float array. Memory matters here: a million-face
 * mesh has millions of indices, and the edge Worker has a small heap, so
 * the output is single precision and nothing else is allocated.
 */
function readAccessor(gltf: Gltf, bin: DataView, index: number): { data: Float32Array; components: number; count: number } {
  const accessor = gltf.accessors?.[index];
  if (!accessor || accessor.bufferView === undefined) throw new Error(`GLB accessor ${index} is missing or sparse.`);
  const view = gltf.bufferViews?.[accessor.bufferView];
  if (!view) throw new Error(`GLB buffer view for accessor ${index} is missing.`);
  const components = COMPONENTS[accessor.type] ?? 1;
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType] ?? 4;
  const stride = view.byteStride ?? components * size;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new Float32Array(accessor.count * components);
  const normalize = accessor.normalized === true;
  // Tightly packed floats and 32-bit indices can be copied in one go.
  if (stride === components * size && (accessor.componentType === 5126 || accessor.componentType === 5125)) {
    const offset = bin.byteOffset + base;
    if (accessor.componentType === 5126 && offset % 4 === 0) {
      data.set(new Float32Array(bin.buffer, offset, accessor.count * components));
      return { data, components, count: accessor.count };
    }
    if (accessor.componentType === 5125 && offset % 4 === 0) {
      data.set(new Uint32Array(bin.buffer, offset, accessor.count * components));
      return { data, components, count: accessor.count };
    }
  }
  for (let element = 0; element < accessor.count; element += 1) {
    for (let component = 0; component < components; component += 1) {
      const at = base + element * stride + component * size;
      let value: number;
      switch (accessor.componentType) {
        case 5120:
          value = bin.getInt8(at);
          if (normalize) value = Math.max(value / 127, -1);
          break;
        case 5121:
          value = bin.getUint8(at);
          if (normalize) value /= 255;
          break;
        case 5122:
          value = bin.getInt16(at, true);
          if (normalize) value = Math.max(value / 32767, -1);
          break;
        case 5123:
          value = bin.getUint16(at, true);
          if (normalize) value /= 65535;
          break;
        case 5125:
          value = bin.getUint32(at, true);
          break;
        default:
          value = bin.getFloat32(at, true);
      }
      data[element * components + component] = value;
    }
  }
  return { data, components, count: accessor.count };
}

/** Parse a binary glTF's first triangle primitive: positions, vertex colours, indices. */
export function parseGlb(buffer: ArrayBuffer): GlbMesh {
  const header = new DataView(buffer);
  if (buffer.byteLength < 20 || header.getUint32(0, true) !== GLB_MAGIC) throw new Error('Not a GLB.');
  let offset = 12;
  let json: Gltf | null = null;
  let bin: DataView | null = null;
  while (offset + 8 <= buffer.byteLength) {
    const length = header.getUint32(offset, true);
    const type = header.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length))) as Gltf;
    else if (type === CHUNK_BIN) bin = new DataView(buffer, start, length);
    offset = start + length;
  }
  if (!json || !bin) throw new Error('GLB has no JSON or binary chunk.');
  const primitive = json.meshes?.flatMap((mesh) => mesh.primitives).find((entry) => (entry.mode ?? 4) === 4 && entry.attributes.POSITION !== undefined);
  if (!primitive) throw new Error('GLB has no triangle primitive.');
  const positions = readAccessor(json, bin, primitive.attributes.POSITION);
  const mesh: GlbMesh = { positions: positions.data, colors: null, indices: null, vertexCount: positions.count };
  if (primitive.attributes.COLOR_0 !== undefined) {
    const colour = readAccessor(json, bin, primitive.attributes.COLOR_0);
    const colors = new Uint8Array(colour.count * 3);
    for (let vertex = 0; vertex < colour.count; vertex += 1) {
      for (let channel = 0; channel < 3; channel += 1) colors[vertex * 3 + channel] = Math.max(0, Math.min(255, Math.round(colour.data[vertex * colour.components + channel] * 255)));
    }
    mesh.colors = colors;
  }
  if (primitive.indices !== undefined) {
    // Indices above 2^24 would not survive single precision; meshes that
    // large are not expected here, and are truncated to what fits.
    const raw = readAccessor(json, bin, primitive.indices).data;
    mesh.indices = new Uint32Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) mesh.indices[index] = raw[index];
  }
  return mesh;
}

export interface SampleOptions {
  /** Longest side of the result's bounding box, world units. */
  extent?: number;
  /** A deterministic random source, 0..1. */
  random?: () => number;
  /**
   * Axis remap from the mesh's frame to Lupi's (x right, y up, z toward the
   * camera): each entry names which source axis feeds x, y, z, with a sign.
   * Default keeps the mesh's own frame.
   */
  orient?: [number, number, number];
}

/**
 * Sample `count` points on the mesh, each triangle weighted by its area,
 * colours interpolated from the vertices, then centre and scale the cloud.
 */
export function sampleMeshPoints(mesh: GlbMesh, count: number, options: SampleOptions = {}): ColouredPoints {
  const random = options.random ?? Math.random;
  const extent = options.extent ?? 1.8;
  const indices = mesh.indices ?? Uint32Array.from({ length: mesh.vertexCount }, (_, index) => index);
  const triangles = Math.floor(indices.length / 3);
  if (triangles === 0 || count <= 0) return { count: 0, positions: new Float32Array(0), colors: new Uint8Array(0), normals: new Int8Array(0), min: [0, 0, 0], max: [0, 0, 0] };
  const p = mesh.positions;
  // Cumulative area, for weighted picking. Face normals are recomputed per
  // sample rather than stored: a million of them would be twelve megabytes.
  const cumulative = new Float64Array(triangles);
  let total = 0;
  const faceNormal = (t: number): [number, number, number] => {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const length = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
    return [cx / length, cy / length, cz / length];
  };
  for (let t = 0; t < triangles; t += 1) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    total += Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
    cumulative[t] = total;
  }
  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 3);
  const normals = new Float32Array(count * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let n = 0; n < count; n += 1) {
    // Binary search the triangle whose cumulative area covers the pick.
    const pick = random() * total;
    let lo = 0;
    let hi = triangles - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < pick) lo = mid + 1;
      else hi = mid;
    }
    const a = indices[lo * 3];
    const b = indices[lo * 3 + 1];
    const c = indices[lo * 3 + 2];
    // Uniform barycentric point.
    let r1 = random();
    let r2 = random();
    if (r1 + r2 > 1) {
      r1 = 1 - r1;
      r2 = 1 - r2;
    }
    const wa = 1 - r1 - r2;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = wa * p[a * 3 + axis] + r1 * p[b * 3 + axis] + r2 * p[c * 3 + axis];
      positions[n * 3 + axis] = value;
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
    if (mesh.colors) {
      for (let channel = 0; channel < 3; channel += 1) colors[n * 3 + channel] = Math.round(wa * mesh.colors[a * 3 + channel] + r1 * mesh.colors[b * 3 + channel] + r2 * mesh.colors[c * 3 + channel]);
    } else colors.fill(200, n * 3, n * 3 + 3);
    const normal = faceNormal(lo);
    normals[n * 3] = normal[0];
    normals[n * 3 + 1] = normal[1];
    normals[n * 3 + 2] = normal[2];
  }
  // Centre and scale, then orient, positions and normals alike.
  const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const longest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
  const scale = extent / longest;
  const orient = options.orient ?? [1, 2, 3];
  const oriented = new Float32Array(count * 3);
  const orientedNormals = new Float32Array(count * 3);
  for (let n = 0; n < count; n += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const source = Math.abs(orient[axis]) - 1;
      const sign = orient[axis] < 0 ? -1 : 1;
      oriented[n * 3 + axis] = (positions[n * 3 + source] - centre[source]) * scale * sign;
      orientedNormals[n * 3 + axis] = normals[n * 3 + source] * sign;
    }
  }
  // Far to near, so a draw in point order paints the back first.
  const order = Array.from({ length: count }, (_, index) => index).sort((a, b) => oriented[a * 3 + 2] - oriented[b * 3 + 2]);
  const out = new Float32Array(count * 3);
  const outColors = new Uint8Array(count * 3);
  const outNormals = new Int8Array(count * 3);
  const outMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const outMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  order.forEach((source, n) => {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = oriented[source * 3 + axis];
      out[n * 3 + axis] = value;
      outMin[axis] = Math.min(outMin[axis], value);
      outMax[axis] = Math.max(outMax[axis], value);
      outColors[n * 3 + axis] = colors[source * 3 + axis];
      outNormals[n * 3 + axis] = Math.max(-127, Math.min(127, Math.round(orientedNormals[source * 3 + axis] * 127)));
    }
  });
  return { count, positions: out, colors: outColors, normals: outNormals, min: outMin, max: outMax };
}

export const POINTS_MAGIC = 0x31545050; // 'PPT1'
const POINTS_HEADER = 32;
/** Bytes per packed point: xyz as u16, rgb, and a normal as three signed bytes. */
export const POINT_BYTES = 12;

/** Pack points as `lupi.points.v1`. */
export function packPoints(points: ColouredPoints): ArrayBuffer {
  const buffer = new ArrayBuffer(POINTS_HEADER + points.count * POINT_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, POINTS_MAGIC, true);
  view.setUint32(4, points.count, true);
  for (let axis = 0; axis < 3; axis += 1) {
    view.setFloat32(8 + axis * 4, points.min[axis], true);
    view.setFloat32(20 + axis * 4, points.max[axis], true);
  }
  const bytes = new Uint8Array(buffer);
  const span = [0, 1, 2].map((axis) => Math.max(points.max[axis] - points.min[axis], 1e-6));
  for (let n = 0; n < points.count; n += 1) {
    const at = POINTS_HEADER + n * POINT_BYTES;
    for (let axis = 0; axis < 3; axis += 1) {
      const q = Math.max(0, Math.min(65535, Math.round(((points.positions[n * 3 + axis] - points.min[axis]) / span[axis]) * 65535)));
      view.setUint16(at + axis * 2, q, true);
    }
    bytes[at + 6] = points.colors[n * 3];
    bytes[at + 7] = points.colors[n * 3 + 1];
    bytes[at + 8] = points.colors[n * 3 + 2];
    view.setInt8(at + 9, points.normals[n * 3] ?? 0);
    view.setInt8(at + 10, points.normals[n * 3 + 1] ?? 0);
    view.setInt8(at + 11, points.normals[n * 3 + 2] ?? 127);
  }
  return buffer;
}

/** Unpack `lupi.points.v1`; throws on a wrong magic or a short buffer. */
export function unpackPoints(buffer: ArrayBuffer): ColouredPoints {
  const view = new DataView(buffer);
  if (buffer.byteLength < POINTS_HEADER || view.getUint32(0, true) !== POINTS_MAGIC) throw new Error('Not a lupi.points.v1 buffer.');
  const count = view.getUint32(4, true);
  if (buffer.byteLength < POINTS_HEADER + count * POINT_BYTES) throw new Error('Points buffer is short.');
  const min: [number, number, number] = [view.getFloat32(8, true), view.getFloat32(12, true), view.getFloat32(16, true)];
  const max: [number, number, number] = [view.getFloat32(20, true), view.getFloat32(24, true), view.getFloat32(28, true)];
  const span = [0, 1, 2].map((axis) => Math.max(max[axis] - min[axis], 1e-6));
  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 3);
  const normals = new Int8Array(count * 3);
  const bytes = new Uint8Array(buffer);
  for (let n = 0; n < count; n += 1) {
    const at = POINTS_HEADER + n * POINT_BYTES;
    for (let axis = 0; axis < 3; axis += 1) positions[n * 3 + axis] = min[axis] + (view.getUint16(at + axis * 2, true) / 65535) * span[axis];
    colors[n * 3] = bytes[at + 6];
    colors[n * 3 + 1] = bytes[at + 7];
    colors[n * 3 + 2] = bytes[at + 8];
    normals[n * 3] = view.getInt8(at + 9);
    normals[n * 3 + 1] = view.getInt8(at + 10);
    normals[n * 3 + 2] = view.getInt8(at + 11);
  }
  return { count, positions, colors, normals, min, max };
}
