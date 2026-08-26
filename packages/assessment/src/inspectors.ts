import type {
  AssetClass,
  AssetInspector,
  AssessmentNote,
  EvidenceItem,
  InspectionObservations,
  InspectionResult,
  InspectorInput,
} from './types';

const textDecoder = new TextDecoder('utf-8', { fatal: false });

function note(ruleId: string, message: string): AssessmentNote {
  return { ruleId, message };
}

function evidence(ruleId: string, message: string, value?: EvidenceItem['value']): EvidenceItem {
  return { ruleId, message, value, origin: 'source-data' };
}

function result(
  inspectorId: string,
  observedClass: AssetClass,
  observations: InspectionObservations,
  extras: Partial<Omit<InspectionResult, 'inspectorId' | 'observedClass' | 'observations'>> = {},
): InspectionResult {
  return {
    inspectorId,
    observedClass,
    observations,
    evidence: extras.evidence ?? [],
    strengths: extras.strengths ?? [],
    gaps: extras.gaps ?? [],
    limitations: extras.limitations ?? [],
    diagnostics: extras.diagnostics ?? [],
  };
}

const glimbinInspector: AssetInspector = {
  id: 'glimbin-header-v1',
  detect: ({ sample }) => sample.byteLength >= 4 && textDecoder.decode(sample.subarray(0, 4)) === 'GLIM' ? 1 : 0,
  async inspect({ sample, source }) {
    if (sample.byteLength < 256) {
      return result(this.id, 'unknown', { format: 'glimbin', parseable: false }, {
        diagnostics: [note('format.glimbin.truncated-header', 'GLIMBIN header is shorter than 256 bytes.')],
      });
    }
    const view = new DataView(sample.buffer, sample.byteOffset, sample.byteLength);
    const version = view.getUint16(4, true);
    const flags = view.getUint16(6, true);
    const frameCount = view.getUint32(8, true);
    const atomsPerFrame = view.getUint32(12, true);
    const hasSourceBonds = Boolean(flags & 0x0008);
    const hasProperties = Boolean(flags & 0x0010);
    const hasPerFrameCell = Boolean(flags & 0x0020);
    const frameIndexOffset = view.getBigUint64(152, true);
    const indexSampleCount = Math.min(frameCount, 4);
    let indexBytes: Uint8Array = new Uint8Array();
    let indexReadError: string | undefined;
    if (indexSampleCount > 0 && frameIndexOffset <= BigInt(Number.MAX_SAFE_INTEGER)) {
      const offset = Number(frameIndexOffset);
      const byteLength = indexSampleCount * 24;
      if (offset >= 256 && offset + byteLength <= sample.byteLength) {
        indexBytes = sample.slice(offset, offset + byteLength);
      } else if (offset >= 256) {
        try {
          indexBytes = await source.readRange(offset, offset + byteLength);
        } catch (error) {
          indexReadError = error instanceof Error ? error.message : String(error);
        }
      }
    }
    const indexStatus = inspectGlimbinIndex(indexBytes, indexSampleCount);
    const observations: InspectionObservations = {
      format: 'glimbin',
      parseable: true,
      atomCount: atomsPerFrame || undefined,
      frameCount,
      inspectedFrames: 0,
      indexEntriesSampled: indexStatus.sampled,
      frameIndexValid: indexStatus.valid,
      hasCoordinates: true,
      hasSpeciesOrTypes: sample[16] > 0,
      hasCell: true,
      hasPerFrameCell,
      hasTimesteps: frameCount > 0,
      hasSourceBonds,
      hasProperties,
      variableAtoms: Boolean(flags & 0x0004),
      compressed: Boolean(flags & 0x0001),
      formatVersion: version,
      unitStyle: sample[149],
    };
    return result(this.id, frameCount > 1 ? 'atomistic-simulation' : 'reference-structure', observations, {
      evidence: [
        evidence('format.glimbin.header', `GLIMBIN v${version} header parsed.`, version),
        evidence('data.frames.declared-binary', 'Frame count is stored in the binary header.', frameCount),
        evidence('data.properties.flag', 'Per-atom property availability is stored in the binary flags.', hasProperties),
        evidence('data.bonds.source-flag', 'Source bond availability is stored in the binary flags.', hasSourceBonds),
      ],
      strengths: [note('format.glimbin.indexed', 'Indexed binary structure supports bounded inspection without reading the trajectory body.')],
      limitations: [
        ...(!hasSourceBonds ? [note('bond.no-source-topology', 'The GLIMBIN file does not declare source bond topology; viewer-inferred bonds do not count as source data.')] : []),
        note('identity.glimbin-header-insufficient', 'The GLIMBIN header alone does not prove source-backed, unique atom identity across frames.'),
      ],
      diagnostics: indexSampleCount > 0 && !indexStatus.valid
        ? [note(
          'format.glimbin.frame-index-unavailable',
          indexReadError
            ? `The sampled frame index could not be read safely (${indexReadError}); header evidence remains available.`
            : 'The sampled frame index was missing or structurally invalid; header evidence remains available.',
        )]
        : [],
    });
  },
};

const dumpInspector: AssetInspector = {
  id: 'lammps-dump-head-v1',
  detect: ({ sampleText }) => /^\s*ITEM:\s*TIMESTEP/m.test(sampleText) ? 0.98 : 0,
  inspect({ sampleText, source }) {
    const atomCount = numberMatch(sampleText, /ITEM:\s*NUMBER OF ATOMS\s*\r?\n\s*(\d+)/i);
    const columns = sampleText.match(/ITEM:\s*ATOMS\s+([^\r\n]+)/i)?.[1]?.trim().split(/\s+/) ?? [];
    const frameMarkers = countMatches(sampleText, /^\s*ITEM:\s*TIMESTEP/mg);
    const completeSample = source.size !== undefined && source.size <= new TextEncoder().encode(sampleText).byteLength;
    const completeFrames = completeSample ? countCompleteLammpsDumpFrames(sampleText) : undefined;
    const coordinateColumns = ['x', 'y', 'z'].every((name) => columns.includes(name))
      || ['xs', 'ys', 'zs'].every((name) => columns.includes(name))
      || ['xu', 'yu', 'zu'].every((name) => columns.includes(name));
    const baseColumns = new Set(['id', 'type', 'element', 'x', 'y', 'z', 'xs', 'ys', 'zs', 'xu', 'yu', 'zu']);
    const propertyNames = columns.filter((column) => !baseColumns.has(column));
    const observations: InspectionObservations = {
      format: 'lammps-dump',
      parseable: Boolean(atomCount && coordinateColumns),
      atomCount,
      frameCount: completeFrames?.frames,
      inspectedFrames: completeSample ? completeFrames?.frames : frameMarkers,
      hasCoordinates: coordinateColumns,
      hasSpeciesOrTypes: columns.includes('type') || columns.includes('element'),
      hasSourceIdentity: columns.includes('id'),
      hasCell: /ITEM:\s*BOX BOUNDS/i.test(sampleText),
      hasPerFrameCell: frameMarkers > 0,
      hasTimesteps: frameMarkers > 0,
      hasSourceBonds: false,
      hasProperties: propertyNames.length > 0,
      propertyNames,
    };
    return result(this.id, 'atomistic-simulation', observations, {
      evidence: [
        evidence('format.lammps.dump', 'LAMMPS dump section markers were detected.'),
        evidence('data.dump.columns', 'Per-atom dump columns were read from source data.', columns),
      ],
      strengths: propertyNames.length ? [note('data.properties.named', `Named per-atom properties are available: ${propertyNames.join(', ')}.`)] : [],
      gaps: columns.includes('id') ? [] : [note('data.ids.missing', 'No source atom-ID column is present, limiting cross-frame identity checks.')],
      limitations: [
        ...(columns.includes('id') ? [note('identity.dump-not-exhaustive', 'The LAMMPS id column has source identity semantics, but bounded header inspection does not prove uniqueness or continuity across all frames.')] : []),
        note('bond.dump-no-topology', 'LAMMPS custom dumps do not carry bond topology unless a separate source artifact supplies it.'),
      ],
      diagnostics: completeFrames?.incomplete
        ? [note('format.lammps.incomplete-frame', 'The complete dump contains a frame without its declared atom rows; only complete frames were counted.')]
        : [],
    });
  },
};

const profileInspector: AssetInspector = {
  id: 'lammps-profile-head-v1',
  detect: ({ sampleText }) => /^\s*#\s*Chunk-averaged data for fix\s+/m.test(sampleText) ? 0.97 : 0,
  inspect({ sampleText }) {
    const columns = sampleText.split(/\r?\n/).find((line) => /^\s*#\s*Chunk\s+/i.test(line))?.replace(/^\s*#\s*/, '').split(/\s+/) ?? [];
    return result(this.id, 'atomistic-simulation', {
      format: 'lammps-profile', parseable: true, hasProfiles: true, hasProperties: columns.length > 0, propertyNames: columns,
    }, {
      evidence: [evidence('format.lammps.profile', 'LAMMPS fix ave/chunk profile header was detected.')],
      limitations: [note('data.sidecar-only', 'This profile is a simulation sidecar and needs a linked structure or trajectory for complete assessment.')],
    });
  },
};

const dataInspector: AssetInspector = {
  id: 'lammps-data-head-v1',
  detect: ({ sampleText }) => /^\s*\d+\s+atoms\b/m.test(sampleText) && /^\s*(Atoms|Masses|Velocities)\b/m.test(sampleText) ? 0.96 : 0,
  inspect({ sampleText }) {
    const atomCount = numberMatch(sampleText, /^\s*(\d+)\s+atoms\b/m);
    const hasAtoms = /^\s*Atoms(?:\s+#.*)?\s*$/m.test(sampleText);
    const hasBonds = /^\s*Bonds(?:\s+#.*)?\s*$/m.test(sampleText);
    const hasCell = /^\s*[-+\deE.]+\s+[-+\deE.]+\s+xlo\s+xhi\s*$/m.test(sampleText)
      && /^\s*[-+\deE.]+\s+[-+\deE.]+\s+ylo\s+yhi\s*$/m.test(sampleText)
      && /^\s*[-+\deE.]+\s+[-+\deE.]+\s+zlo\s+zhi\s*$/m.test(sampleText);
    return result(this.id, 'reference-structure', {
      format: 'lammps-data', parseable: Boolean(atomCount && hasAtoms), atomCount, frameCount: hasAtoms ? 1 : undefined, inspectedFrames: hasAtoms ? 1 : 0,
      hasCoordinates: hasAtoms, hasSpeciesOrTypes: /^\s*Masses(?:\s+#.*)?\s*$/m.test(sampleText),
      hasSourceIdentity: hasAtoms, hasCell, hasSourceBonds: hasBonds,
    }, {
      evidence: [evidence('format.lammps.data', 'LAMMPS data-file sections were detected.'), evidence('data.bonds.section', 'Bond topology section presence was inspected.', hasBonds)],
      limitations: [note('identity.data-not-exhaustive', 'LAMMPS atom IDs have source identity semantics, but header inspection does not prove ID uniqueness.')],
    });
  },
};

const logInspector: AssetInspector = {
  id: 'lammps-log-head-v1',
  detect: ({ sampleText, source }) => (/LAMMPS \(/.test(sampleText) && /\bStep\s+Temp\b/.test(sampleText)) || /^log\./i.test(source.name) ? 0.85 : 0,
  inspect() {
    return result(this.id, 'atomistic-simulation', { format: 'lammps-log', parseable: true, hasThermo: true }, {
      evidence: [evidence('format.lammps.log', 'LAMMPS thermo/log content was detected.')],
      limitations: [note('data.sidecar-only', 'A thermo log needs a linked structure or trajectory for complete assessment.')],
    });
  },
};

const xyzInspector: AssetInspector = {
  id: 'xyz-head-v1',
  detect: ({ sampleText }) => {
    const lines = nonEmptyLines(sampleText);
    return lines.length >= 2 && /^\d+$/.test(lines[0]) && !/^ITEM:/.test(lines[1]) ? 0.94 : 0;
  },
  inspect({ sampleText, source }) {
    const lines = sampleText.split(/\r?\n/);
    const firstIndex = lines.findIndex((line) => line.trim().length > 0);
    const atomCount = firstIndex >= 0 ? Number(lines[firstIndex].trim()) : NaN;
    const comment = lines[firstIndex + 1] ?? '';
    const completeSample = source.size !== undefined && source.size <= new TextEncoder().encode(sampleText).byteLength;
    const frameCount = completeSample ? countXyzFrames(lines) : undefined;
    const propertyMatch = comment.match(/Properties=([^\s"]+)/i)?.[1];
    const propertyNames = propertyMatch
      ? propertyMatch.split(':').filter((_part, index) => index % 3 === 0)
      : [];
    const elementSymbols = new Set<string>();
    const sampleAtoms = Number.isInteger(atomCount) ? Math.min(atomCount, Math.max(0, lines.length - firstIndex - 2), 256) : 0;
    let finiteCoordinates = true;
    for (let i = 0; i < sampleAtoms; i++) {
      const parts = lines[firstIndex + 2 + i]?.trim().split(/\s+/) ?? [];
      if (/^[A-Z][a-z]?$/.test(parts[0] ?? '')) elementSymbols.add(parts[0]);
      if (parts.length < 4 || parts.slice(1, 4).some((value) => !Number.isFinite(Number(value)))) finiteCoordinates = false;
    }
    const resolvedFrames = frameCount && frameCount > 0 ? frameCount : undefined;
    return result(this.id, resolvedFrames && resolvedFrames > 1 ? 'atomistic-simulation' : 'reference-structure', {
      format: 'xyz', parseable: Number.isInteger(atomCount) && atomCount > 0,
      atomCount: Number.isInteger(atomCount) ? atomCount : undefined,
      frameCount: resolvedFrames,
      inspectedFrames: resolvedFrames ?? (Number.isInteger(atomCount) ? 1 : 0),
      hasCoordinates: true,
      finiteCoordinates,
      hasSpeciesOrTypes: elementSymbols.size > 0 || propertyNames.includes('species'),
      hasSourceIdentity: propertyNames.includes('id'),
      hasCell: /\bLattice=/i.test(comment),
      hasTimesteps: resolvedFrames !== undefined && resolvedFrames > 1,
      hasSourceBonds: false,
      hasProperties: propertyNames.length > 2,
      propertyNames,
      elementSymbols: [...elementSymbols].sort(),
    }, {
      evidence: [evidence('format.xyz', 'XYZ or extended-XYZ structure header was detected.'), evidence('structure.elements.sampled', 'Element symbols were sampled from coordinate rows.', [...elementSymbols].sort())],
      limitations: [
        ...(propertyNames.includes('id') ? [note('identity.xyz-not-exhaustive', 'An extended-XYZ id property is present, but bounded inspection does not prove uniqueness or continuity across all frames.')] : []),
        note('bond.xyz-no-topology', 'XYZ coordinates do not encode source bond order or topology.'),
      ],
    });
  },
};

const jsonInspector: AssetInspector = {
  id: 'lupi-json-v1',
  detect: ({ sampleText, source }) => /^[\s\uFEFF]*[\[{]/.test(sampleText) || /\.json(?:$|\?)/i.test(source.name) ? 0.6 : 0,
  inspect({ sampleText, source }) {
    const completeSample = source.size === undefined || source.size <= new TextEncoder().encode(sampleText).byteLength;
    let payload: unknown;
    if (completeSample) {
      try { payload = JSON.parse(sampleText); } catch { /* handled below */ }
    }
    if (!payload || typeof payload !== 'object') {
      return result(this.id, 'unknown', { format: 'lupi-json', parseable: false }, {
        diagnostics: [note('format.json.partial-or-invalid', completeSample ? 'JSON could not be parsed.' : 'JSON exceeds the fast sample; use deep mode or provide an assessment envelope.')],
      });
    }
    const record = payload as Record<string, unknown>;
    const frames = Array.isArray(record.frames)
      ? record.frames
      : isRecord(record.trajectory) && Array.isArray(record.trajectory.frames) ? record.trajectory.frames : [];
    const first = isRecord(frames[0]) ? frames[0] : undefined;
    const positions = first && (Array.isArray(first.positions_angstrom) ? first.positions_angstrom : Array.isArray(first.positions) ? first.positions : undefined);
    const species = first && Array.isArray(first.species) ? first.species : undefined;
    const natoms = first && typeof first.natoms === 'number'
      ? first.natoms
      : species?.length ?? (positions ? Math.floor(positions.length / 3) : undefined);
    const properties = first && isRecord(first.properties) ? Object.keys(first.properties) : [];
    const bonds = first && Array.isArray(first.bonds) ? first.bonds : [];
    const ids = first && Array.isArray(first.ids) ? first.ids : undefined;
    const procedural = record.procedural === true || record.kind === 'procedural';
    const metadata = isRecord(record.metadata) ? record.metadata : undefined;
    const nonScientific = record.scientific === false || metadata?.scientific === false || metadata?.domain === 'visualization';
    const metadataText = JSON.stringify(record.metadata ?? record.provenance ?? '').toLowerCase();
    const mlipEvidence = /mlip|chgnet|mace|nequip|gap/.test(metadataText);
    return result(this.id, nonScientific ? 'visualization-demo' : procedural ? 'procedural-scientific-model' : frames.length > 1 ? 'atomistic-simulation' : natoms ? 'reference-structure' : 'unknown', {
      format: 'lupi-json', parseable: Boolean(natoms || procedural), atomCount: natoms, frameCount: frames.length || undefined,
      inspectedFrames: frames.length, hasCoordinates: Boolean(positions), finiteCoordinates: positions?.every((value) => Number.isFinite(Number(value))),
      hasSpeciesOrTypes: Boolean(species?.length || (first && Array.isArray(first.types))),
      hasUniqueIds: ids ? new Set(ids.map((value) => String(value))).size === ids.length : undefined,
      hasSourceIdentity: false,
      hasStableIds: false,
      hasCell: Boolean(first && (Array.isArray(first.boxBounds) || Array.isArray(first.cell))), hasTimesteps: frames.length > 1,
      hasSourceBonds: false, hasInferredBonds: bonds.length > 0, hasProperties: properties.length > 0, propertyNames: properties, mlipEvidence,
    }, {
      evidence: [evidence('format.lupi.json', 'Structured Lupi JSON payload was parsed.')],
      limitations: [
        ...(ids?.length ? [note('identity.json-provenance-unverified', 'JSON atom IDs do not encode source-backed identity semantics, so their stability is not claimed.')] : []),
        ...(bonds.length ? [note('bond.json-provenance-unverified', 'JSON bond arrays do not encode independently inspectable source-topology provenance and are not graded as source bonds.')] : []),
        ...(mlipEvidence ? [note('method.mlip-not-dft', 'MLIP output is model evidence and is not labeled as DFT or experiment.')] : []),
      ],
    });
  },
};

const htmlInspector: AssetInspector = {
  id: 'html-response-v1',
  detect: ({ sampleText }) => /<!doctype html|<html\b/i.test(sampleText) ? 0.99 : 0,
  inspect() {
    return result(this.id, 'unknown', { format: 'html', parseable: false }, {
      diagnostics: [note('format.html-not-asset', 'The input is HTML, not a materialized molecular or atomistic asset.')],
    });
  },
};

const unknownInspector: AssetInspector = {
  id: 'unknown-v1',
  detect: () => 0.001,
  inspect() {
    return result(this.id, 'unknown', { format: 'unknown', parseable: false }, {
      diagnostics: [note('format.unsupported', 'No registered inspector recognized the sampled bytes.')],
    });
  },
};

export const BUILT_IN_INSPECTORS: AssetInspector[] = [
  glimbinInspector,
  dumpInspector,
  profileInspector,
  dataInspector,
  logInspector,
  xyzInspector,
  jsonInspector,
  htmlInspector,
  unknownInspector,
];

export function decodeSample(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function numberMatch(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern)?.[1];
  if (!match) return undefined;
  const value = Number(match);
  return Number.isFinite(value) ? value : undefined;
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function nonEmptyLines(text: string): string[] {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function countXyzFrames(lines: string[]): number {
  let index = 0;
  let frames = 0;
  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) index++;
    if (index >= lines.length) break;
    const atoms = Number(lines[index].trim());
    if (!Number.isInteger(atoms) || atoms <= 0 || index + atoms + 1 >= lines.length) return 0;
    frames++;
    index += atoms + 2;
  }
  return frames;
}

function countCompleteLammpsDumpFrames(text: string): { frames: number; incomplete: boolean } {
  const lines = text.split(/\r?\n/);
  const starts = lines
    .map((line, index) => /^\s*ITEM:\s*TIMESTEP\s*$/.test(line) ? index : -1)
    .filter((index) => index >= 0);
  let frames = 0;
  let incomplete = false;
  for (let frameIndex = 0; frameIndex < starts.length; frameIndex++) {
    const start = starts[frameIndex];
    const end = starts[frameIndex + 1] ?? lines.length;
    const countHeader = lines.findIndex((line, index) => index > start && index < end && /^\s*ITEM:\s*NUMBER OF ATOMS\s*$/.test(line));
    const atomHeader = lines.findIndex((line, index) => index > start && index < end && /^\s*ITEM:\s*ATOMS\s+/.test(line));
    const atomCount = countHeader >= 0 ? Number(lines[countHeader + 1]?.trim()) : Number.NaN;
    if (!Number.isSafeInteger(atomCount) || atomCount < 0 || atomHeader < 0) {
      incomplete = true;
      continue;
    }
    let rows = 0;
    for (let index = atomHeader + 1; index < end && rows < atomCount; index++) {
      if (/^\s*ITEM:/.test(lines[index])) break;
      if (lines[index].trim()) rows++;
    }
    if (rows === atomCount) frames++;
    else incomplete = true;
  }
  return { frames, incomplete };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function inspectGlimbinIndex(bytes: Uint8Array, expectedEntries: number): { sampled: number; valid: boolean } {
  const sampled = Math.min(expectedEntries, Math.floor(bytes.byteLength / 24));
  if (sampled === 0) return { sampled, valid: expectedEntries === 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let previousOffset = 0n;
  for (let index = 0; index < sampled; index++) {
    const base = index * 24;
    const offset = view.getBigUint64(base, true);
    const compressedSize = view.getUint32(base + 8, true);
    const rawSize = view.getUint32(base + 12, true);
    const natoms = view.getUint32(base + 20, true);
    if (offset < 256n || offset < previousOffset || compressedSize === 0 || rawSize === 0 || natoms === 0) {
      return { sampled, valid: false };
    }
    previousOffset = offset;
  }
  return { sampled, valid: sampled === expectedEntries };
}
