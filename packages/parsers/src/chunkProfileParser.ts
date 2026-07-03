/**
 * Parser for LAMMPS `fix ave/chunk` output files — the spatial-profile
 * time series real research runs produce (temperature / density /
 * velocity profiles from thermal-conductivity and viscosity studies,
 * e.g. MaginnGroup/Validation-of-HFC-FFs).
 *
 * The dialect (written by LAMMPS's FixAveChunk):
 *
 *   # Chunk-averaged data for fix temp_profile and group all
 *   # Timestep Number-of-chunks Total-count
 *   # Chunk Coord1 Ncount v_temp
 *   1000 20 10000
 *     1 0.025 472.11 286.389
 *     2 0.075 497.84 272.509
 *     ...
 *   2000 20 10000
 *     ...
 *
 * Three comment header lines, then repeating snapshot blocks: one
 * "<timestep> <nchunks> <total-count>" line followed by `nchunks` rows.
 * `bin/2d`/`bin/3d` chunking adds Coord2/Coord3 columns; `compress yes`
 * adds OrigID. Every column that isn't Chunk, OrigID, Coord1..3, or
 * Ncount is a value column (v_*, c_*, f_*, temp, density/mass, vx, ...).
 */

export interface ChunkProfileSnapshot {
  timestep: number;
  nchunks: number;
  /** Total atom count in the fix's group at this snapshot (3rd header number). */
  totalCount: number;
  /** Bin coordinates, one Float64Array per Coord* column, each length nchunks. */
  coords: Float64Array[];
  /** Per-chunk atom counts (Ncount), length nchunks. */
  counts: Float64Array;
  /** Per-chunk averaged values, one Float64Array per value column. */
  values: Float64Array[];
}

export interface ChunkProfileData {
  kind: 'chunk-profile';
  /** Fix ID from the first header line, e.g. "temp_profile". */
  fixName: string | null;
  /** Names of the Coord* columns (1–3 of them). */
  coordColumns: string[];
  /** Names of the value columns, e.g. ["v_temp"] or ["vx"]. */
  valueColumns: string[];
  snapshots: ChunkProfileSnapshot[];
  /** Global min/max per value column across all snapshots (for stable color/axis scales). */
  valueRanges: { min: number; max: number }[];
}

const HEADER_RE = /^#\s*Chunk-averaged data for fix\s+(\S+)/;

/**
 * Sniff whether text looks like `fix ave/chunk` output. Cheap enough for
 * content-based format detection — inspects only the first line.
 */
export function looksLikeChunkProfile(head: string): boolean {
  const firstLine = head.slice(0, head.indexOf('\n') + 1 || head.length);
  return HEADER_RE.test(firstLine.trimStart());
}

/** Column names with special (non-value) meaning in ave/chunk output. */
function classifyColumns(perRowColumns: string[]): {
  chunkIdx: number;
  origIdIdx: number;
  coordIdxs: number[];
  ncountIdx: number;
  valueIdxs: number[];
} {
  let chunkIdx = -1;
  let origIdIdx = -1;
  let ncountIdx = -1;
  const coordIdxs: number[] = [];
  const valueIdxs: number[] = [];
  perRowColumns.forEach((name, i) => {
    if (name === 'Chunk') chunkIdx = i;
    else if (name === 'OrigID') origIdIdx = i;
    else if (name === 'Ncount') ncountIdx = i;
    else if (/^Coord[123]$/.test(name)) coordIdxs.push(i);
    else valueIdxs.push(i);
  });
  return { chunkIdx, origIdIdx, coordIdxs, ncountIdx, valueIdxs };
}

/**
 * Parse a complete ave/chunk profile file. Tolerant of a truncated final
 * snapshot (dropped) and of blank lines. Throws only when the three-line
 * header is absent or no complete snapshot exists.
 */
export function parseChunkProfile(text: string): ChunkProfileData {
  const lines = text.split('\n');
  let i = 0;

  // ── Three-line comment header ──
  while (i < lines.length && lines[i].trim() === '') i++;
  const h1 = lines[i]?.trimStart() ?? '';
  const fixMatch = h1.match(HEADER_RE);
  if (!fixMatch) {
    throw new Error('Not a LAMMPS ave/chunk profile: missing "# Chunk-averaged data for fix ..." header');
  }
  const fixName = fixMatch[1] ?? null;
  i++;
  // Line 2 ("# Timestep Number-of-chunks Total-count") is fixed-form; skip.
  if (lines[i]?.trimStart().startsWith('#')) i++;
  const h3 = lines[i]?.trimStart() ?? '';
  if (!h3.startsWith('#')) {
    throw new Error('Malformed ave/chunk profile: missing per-row column header line');
  }
  const perRowColumns = h3.slice(1).trim().split(/\s+/);
  i++;

  const { chunkIdx, coordIdxs, ncountIdx, valueIdxs } = classifyColumns(perRowColumns);
  if (valueIdxs.length === 0) {
    throw new Error(`ave/chunk profile has no value columns (row columns: ${perRowColumns.join(' ')})`);
  }

  const coordColumns = coordIdxs.map((idx) => perRowColumns[idx]);
  const valueColumns = valueIdxs.map((idx) => perRowColumns[idx]);

  // ── Snapshot blocks ──
  const snapshots: ChunkProfileSnapshot[] = [];
  const mins = valueColumns.map(() => Infinity);
  const maxs = valueColumns.map(() => -Infinity);

  while (i < lines.length) {
    // Snapshot header: "<timestep> <nchunks> <total-count>"
    let line = lines[i]?.trim();
    if (line === undefined) break;
    if (line === '' || line.startsWith('#')) { i++; continue; }
    const headParts = line.split(/\s+/);
    if (headParts.length < 2) break;
    const timestep = Number(headParts[0]);
    const nchunks = Number(headParts[1]);
    const totalCount = headParts.length > 2 ? Number(headParts[2]) : NaN;
    if (!Number.isFinite(timestep) || !Number.isInteger(nchunks) || nchunks <= 0) break;
    i++;

    // Guard against a truncated final block.
    if (i + nchunks > lines.length) break;

    const coords = coordIdxs.map(() => new Float64Array(nchunks));
    const counts = new Float64Array(nchunks);
    const values = valueIdxs.map(() => new Float64Array(nchunks));

    let ok = true;
    for (let r = 0; r < nchunks; r++) {
      const row = lines[i + r]?.trim().split(/\s+/);
      if (!row || row.length !== perRowColumns.length) { ok = false; break; }
      for (let c = 0; c < coordIdxs.length; c++) coords[c][r] = Number(row[coordIdxs[c]]);
      if (ncountIdx >= 0) counts[r] = Number(row[ncountIdx]);
      for (let v = 0; v < valueIdxs.length; v++) {
        const num = Number(row[valueIdxs[v]]);
        values[v][r] = num;
        if (Number.isFinite(num)) {
          if (num < mins[v]) mins[v] = num;
          if (num > maxs[v]) maxs[v] = num;
        }
      }
      // The Chunk column is 1-based and monotonic; we don't need it, but a
      // mismatch means the block structure drifted — treat as truncation.
      if (chunkIdx >= 0 && Number(row[chunkIdx]) !== r + 1) { ok = false; break; }
    }
    if (!ok) break;
    i += nchunks;

    snapshots.push({ timestep, nchunks, totalCount, coords, counts, values });
  }

  if (snapshots.length === 0) {
    throw new Error('ave/chunk profile contains no complete snapshot blocks');
  }

  return {
    kind: 'chunk-profile',
    fixName,
    coordColumns,
    valueColumns,
    snapshots,
    valueRanges: valueColumns.map((_, v) => ({
      min: mins[v] === Infinity ? 0 : mins[v],
      max: maxs[v] === -Infinity ? 0 : maxs[v],
    })),
  };
}
