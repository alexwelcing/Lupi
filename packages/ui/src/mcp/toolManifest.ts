/**
 * Declarative, serializable definitions of every MCP tool exposed by the
 * Lupi viewer. This module has no browser dependencies and can be imported
 * by build-time generators (e.g. the manifest generator) as well as by the
 * runtime registry in `tools.ts`.
 */

import { LUPI_MCP_SCHEMAS } from './schemas';

export interface McpToolManifestEntry {
  name: string;
  description: string;
  parameters: unknown;
}

export const MCP_TOOL_DEFINITIONS: McpToolManifestEntry[] = [
  {
    name: 'lupi.generate_molecule',
    description: 'Load or procedurally generate a molecule into the viewer from a name, template, SMILES, XYZ, URL-derived payload, or lattice request.',
    parameters: LUPI_MCP_SCHEMAS['lupi.generate_molecule'],
  },
  {
    name: 'lupi.load_molecule_url',
    description: 'Load a molecule or trajectory from a URL into the viewer.',
    parameters: LUPI_MCP_SCHEMAS['lupi.load_molecule_url'],
  },
  {
    name: 'lupi.open_saved_view',
    description: 'Open a saved Lupi view by slug.',
    parameters: LUPI_MCP_SCHEMAS['lupi.open_saved_view'],
  },
  {
    name: 'lupi.search_molecules',
    description: 'Search known molecule/catalog providers and return load specs agents can execute.',
    parameters: LUPI_MCP_SCHEMAS['lupi.search_molecules'],
  },
  {
    name: 'lupi.set_viewer',
    description: 'Apply a broad viewer patch for common display, coloring, camera, and style settings.',
    parameters: LUPI_MCP_SCHEMAS['lupi.set_viewer'],
  },
  {
    name: 'lupi.export_xyz',
    description: 'Serialize the active molecule frame as XYZ text.',
    parameters: LUPI_MCP_SCHEMAS['lupi.export_xyz'],
  },
  {
    name: 'lupi.export_asset',
    description: 'Render the active viewer as an inline PNG/JPEG/WebP image or deterministic GLB model asset.',
    parameters: LUPI_MCP_SCHEMAS['lupi.export_asset'],
  },
  {
    name: 'lupi.viewer_state',
    description: 'Return the current viewer state summary.',
    parameters: LUPI_MCP_SCHEMAS['lupi.viewer_state'],
  },
  {
    name: 'lupi.knowledge_graph',
    description: 'Query the currently loaded knowledge-graph labels in the viewer.',
    parameters: LUPI_MCP_SCHEMAS['lupi.knowledge_graph'],
  },
  {
    name: 'lupi.status',
    description: 'Report MCP bridge readiness and viewer health.',
    parameters: LUPI_MCP_SCHEMAS['lupi.status'],
  },
  {
    name: 'lupi.set_frame',
    description: 'Jump to a specific trajectory frame.',
    parameters: LUPI_MCP_SCHEMAS['lupi.set_frame'],
  },
  {
    name: 'lupi.play',
    description: 'Start trajectory playback.',
    parameters: LUPI_MCP_SCHEMAS['lupi.play'],
  },
  {
    name: 'lupi.pause',
    description: 'Pause trajectory playback.',
    parameters: LUPI_MCP_SCHEMAS['lupi.pause'],
  },
  {
    name: 'lupi.set_playback_speed',
    description: 'Set playback speed multiplier.',
    parameters: LUPI_MCP_SCHEMAS['lupi.set_playback_speed'],
  },
  {
    name: 'lupi.set_camera_preset',
    description: 'Apply a named camera preset (top, side, front, iso, free).',
    parameters: LUPI_MCP_SCHEMAS['lupi.set_camera_preset'],
  },
  {
    name: 'lupi.set_camera',
    description: 'Set camera position, target, and/or FOV directly.',
    parameters: LUPI_MCP_SCHEMAS['lupi.set_camera'],
  },
  {
    name: 'lupi.fit_camera',
    description: 'Fit the camera to the loaded molecule bounds.',
    parameters: LUPI_MCP_SCHEMAS['lupi.fit_camera'],
  },
  {
    name: 'lupi.set_background',
    description: 'Set background preset, style, motion, and adjustments.',
    parameters: LUPI_MCP_SCHEMAS['lupi.set_background'],
  },
  {
    name: 'lupi.set_postprocess',
    description: 'Set the postprocess preset and intensity.',
    parameters: LUPI_MCP_SCHEMAS['lupi.set_postprocess'],
  },
  {
    name: 'lupi.set_material',
    description: 'Set material preset, scene, intensity, and atom texture.',
    parameters: LUPI_MCP_SCHEMAS['lupi.set_material'],
  },
  {
    name: 'lupi.set_lighting',
    description: 'Set lighting intensities, angles, and colors.',
    parameters: LUPI_MCP_SCHEMAS['lupi.set_lighting'],
  },
  {
    name: 'lupi.set_filter_shell',
    description: 'Set the filter shell shape, preset, opacity, and radius.',
    parameters: LUPI_MCP_SCHEMAS['lupi.set_filter_shell'],
  },
  {
    name: 'lupi.set_vector_field',
    description: 'Set the active vector field glyph layer.',
    parameters: LUPI_MCP_SCHEMAS['lupi.set_vector_field'],
  },
  {
    name: 'lupi.set_atom_visibility',
    description: 'Hide atom types or scale per-type radii.',
    parameters: LUPI_MCP_SCHEMAS['lupi.set_atom_visibility'],
  },
  {
    name: 'lupi.add_annotation',
    description: 'Add an etched annotation to a specific atom.',
    parameters: LUPI_MCP_SCHEMAS['lupi.add_annotation'],
  },
  {
    name: 'lupi.remove_annotation',
    description: 'Remove an annotation by id.',
    parameters: LUPI_MCP_SCHEMAS['lupi.remove_annotation'],
  },
  {
    name: 'lupi.encode_view_url',
    description: 'Serialize the current viewer state to a shareable URL.',
    parameters: LUPI_MCP_SCHEMAS['lupi.encode_view_url'],
  },
  {
    name: 'lupi.reset_viewer',
    description: 'Reset the viewer to default state.',
    parameters: LUPI_MCP_SCHEMAS['lupi.reset_viewer'],
  },
];

export const MCP_TOOL_DEFINITIONS_MAP = new Map(
  MCP_TOOL_DEFINITIONS.map((t) => [t.name, t]),
);
