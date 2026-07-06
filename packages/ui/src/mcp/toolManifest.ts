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
