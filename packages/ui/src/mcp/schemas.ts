/**
 * JSON Schema definitions for each new Lupi MCP tool.
 *
 * These schemas mirror the parameter contracts used by the handlers in
 * `tools.ts` and can be serialized to MCP clients or used to auto-generate
 * tests.
 */

export const LUPI_MCP_SCHEMAS: Record<string, unknown> = {
  'lupi.generate_molecule': {
    type: 'object',
    properties: {
      inputType: { type: 'string', enum: ['name', 'template', 'smiles', 'xyz', 'description', 'procedural'] },
      input: { type: 'string', description: 'Molecule name, template id, SMILES, XYZ text, or natural-language description.' },
      name: { type: 'string' },
      smiles: { type: 'string' },
      xyz: { type: 'string' },
      atomCount: { type: ['number', 'string'], description: 'Procedural lattice atom count.' },
      element: { type: 'string', description: 'Procedural lattice element symbol.' },
      elements: {
        oneOf: [
          { type: 'string', description: 'Comma-separated procedural element symbols.' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      lattice: { type: 'string', enum: ['sc', 'bcc', 'fcc'] },
      spacing: { type: ['number', 'string'] },
      viewer: { type: 'object', description: 'Optional viewer patch applied after loading.' },
    },
  },

  'lupi.load_molecule_url': {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'URL to a molecule, trajectory, or saved Lupi payload.' },
    },
  },

  'lupi.open_saved_view': {
    type: 'object',
    required: ['slug'],
    properties: {
      slug: { type: 'string', minLength: 1, description: 'Saved Lupi view slug.' },
    },
  },

  'lupi.search_molecules': {
    type: 'object',
    properties: {
      query: { type: 'string' },
      text: { type: 'string' },
      elements: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number', minimum: 1, maximum: 50 },
    },
  },

  'lupi.set_viewer': {
    type: 'object',
    properties: {
      showBonds: { type: 'boolean' },
      atomScale: { type: 'number' },
      showCell: { type: 'boolean' },
      showAxes: { type: 'boolean' },
      backgroundPreset: { type: 'string' },
      postprocessPreset: { type: 'string' },
      colorScheme: { type: 'string' },
      colorMode: { type: 'string' },
      colorProperty: { type: 'string' },
      colormap: { type: 'string' },
      cameraPreset: { type: 'string', enum: ['top', 'side', 'front', 'iso', 'free'] },
      bondTolerance: { type: 'number' },
      bondColorMode: { type: 'string' },
    },
  },

  'lupi.export_xyz': {
    type: 'object',
    properties: {},
  },

  'lupi.export_asset': {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['png', 'jpeg', 'jpg', 'webp', 'glb', 'usdz'], description: 'Asset format to render from the active viewer.' },
      type: { type: 'string', enum: ['png', 'jpeg', 'jpg', 'webp', 'glb', 'usdz'], description: 'Alias for format.' },
      width: { type: 'number', minimum: 64, maximum: 4096, description: 'Image width in pixels.' },
      height: { type: 'number', minimum: 64, maximum: 4096, description: 'Image height in pixels.' },
      resolution: {
        type: 'object',
        properties: {
          width: { type: 'number', minimum: 64, maximum: 4096 },
          height: { type: 'number', minimum: 64, maximum: 4096 },
        },
      },
      transparent: { type: 'boolean', description: 'Use transparent background for image exports.' },
      baseName: { type: 'string', description: 'Base filename without extension/frame suffix.' },
      fitCamera: { type: 'boolean', description: 'Refit the camera to the active frame before rendering. Defaults to true for small structures (under ~5000 atoms) and false otherwise.' },
      atomScale: { type: 'number', minimum: 0.1, maximum: 8, description: 'Override the viewer atom scale before rendering. Small molecules auto-boost to 1.8 if not specified.' },
      timeoutMs: { type: 'number', minimum: 1000, maximum: 600000 },
      timeoutSeconds: { type: 'number', minimum: 1, maximum: 600 },
      maxInlineBytes: { type: 'number', minimum: 1024, maximum: 134217728, description: 'Maximum blob size to inline as base64 in the MCP response.' },
    },
  },

  'lupi.viewer_state': {
    type: 'object',
    properties: {},
  },

  'lupi.knowledge_graph': {
    type: 'object',
    properties: {
      query: { type: 'string' },
      kind: { type: 'string' },
      sphereId: { type: 'string' },
      limit: { type: 'number', minimum: 1, maximum: 500 },
    },
  },

  'lupi.status': {
    type: 'object',
    properties: {},
  },

  'lupi.set_frame': {
    type: 'object',
    required: ['frame'],
    properties: {
      frame: { type: 'number', description: 'Zero-based trajectory frame index.' },
    },
  },

  'lupi.play': {
    type: 'object',
    properties: {},
  },

  'lupi.pause': {
    type: 'object',
    properties: {},
  },

  'lupi.set_playback_speed': {
    type: 'object',
    required: ['speed'],
    properties: {
      speed: { type: 'number', minimum: 0.0625, maximum: 16, description: 'Playback speed multiplier.' },
    },
  },

  'lupi.set_camera_preset': {
    type: 'object',
    required: ['preset'],
    properties: {
      preset: {
        type: 'string',
        enum: ['top', 'side', 'front', 'iso', 'free'],
        description: 'Named camera preset.',
      },
    },
  },

  'lupi.set_camera': {
    type: 'object',
    properties: {
      position: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: { type: 'number' },
        description: 'Camera world position [x, y, z].',
      },
      target: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: { type: 'number' },
        description: 'Camera look-at target [x, y, z].',
      },
      fov: { type: 'number', minimum: 5, maximum: 120, description: 'Vertical field of view in degrees.' },
    },
  },

  'lupi.fit_camera': {
    type: 'object',
    properties: {},
  },

  'lupi.set_background': {
    type: 'object',
    properties: {
      preset: { type: 'string', description: 'Background environment preset id.' },
      style: { type: 'string', description: 'Background style variant.' },
      motionPaused: { type: 'boolean' },
      motionSpeed: { type: 'number', minimum: 0, maximum: 4 },
      opacity: { type: 'number', minimum: 0, maximum: 1 },
      brightness: { type: 'number', minimum: 0, maximum: 2 },
      saturation: { type: 'number', minimum: 0, maximum: 2 },
      contrast: { type: 'number', minimum: 0, maximum: 2 },
      yaw: { type: 'number' },
      pitch: { type: 'number' },
      shape: { type: 'string', enum: ['dome', 'sphere', 'cube'] },
      pattern: { type: 'string', enum: ['image', 'plain', 'grid'] },
      radius: { type: 'number', minimum: 0.25, maximum: 5 },
    },
  },

  'lupi.set_postprocess': {
    type: 'object',
    properties: {
      preset: { type: 'string', description: 'Postprocess preset id.' },
      intensity: { type: 'number', minimum: 0, maximum: 1 },
    },
  },

  'lupi.set_material': {
    type: 'object',
    properties: {
      preset: { type: 'string', description: 'Material preset id.' },
      scene: { type: 'string', description: 'Material scene id.' },
      intensity: { type: 'number', minimum: 0, maximum: 2 },
      texture: { type: 'string', enum: ['none', 'scratched', 'noise'] },
    },
  },

  'lupi.set_lighting': {
    type: 'object',
    properties: {
      ambient: { type: 'number', minimum: 0, maximum: 2 },
      dir: { type: 'number', minimum: 0, maximum: 2 },
      rim: { type: 'number', minimum: 0, maximum: 2 },
      keyAzimuth: { type: 'number' },
      keyElevation: { type: 'number' },
      fillAzimuth: { type: 'number' },
      fillElevation: { type: 'number' },
      rimAzimuth: { type: 'number' },
      rimElevation: { type: 'number' },
      fillColor: { type: 'string' },
      rimColor: { type: 'string' },
    },
  },

  'lupi.set_filter_shell': {
    type: 'object',
    properties: {
      shape: { type: 'string', enum: ['off', 'sphere', 'cube'] },
      preset: { type: 'string', enum: ['haze', 'cryo', 'prism', 'graphite'] },
      opacity: { type: 'number', minimum: 0, maximum: 1 },
      radius: { type: 'number', minimum: 0.1, maximum: 4 },
    },
  },

  'lupi.set_vector_field': {
    type: 'object',
    properties: {
      fieldId: { type: 'string', description: 'Vector field layer id or null to clear.' },
      scale: { type: 'number', minimum: 0.01, maximum: 10 },
      density: { type: 'number', minimum: 0.01, maximum: 1 },
    },
  },

  'lupi.set_atom_visibility': {
    type: 'object',
    properties: {
      hiddenAtomTypes: { type: 'array', items: { type: 'number' } },
      atomTypeScales: { type: 'object', additionalProperties: { type: 'number' } },
    },
  },

  'lupi.add_annotation': {
    type: 'object',
    required: ['atomIndex', 'text'],
    properties: {
      atomIndex: { type: 'number', minimum: 0 },
      text: { type: 'string', minLength: 1 },
    },
  },

  'lupi.remove_annotation': {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', minLength: 1 },
    },
  },

  'lupi.encode_view_url': {
    type: 'object',
    properties: {},
  },

  'lupi.reset_viewer': {
    type: 'object',
    properties: {},
  },
};

export function getLupiMcpSchema(toolName: string): unknown {
  return LUPI_MCP_SCHEMAS[toolName] ?? null;
}
