#!/usr/bin/env node
/**
 * build-z1-science-panel-fixture.mjs
 *
 * Extracts the Z1 union campaign golden set (paths 16, 0, 14, 27) into the
 * static panel fixture shipped by @atlas/ui for the SciencePathPanel
 * prototype. The fixture is deterministic: no wall-clock fields, and every
 * scalar shown by the panel is copied from — or recomputed and verified
 * against — the source records.
 *
 * Sources (all local, no network):
 *   - lupine-rhizo data/candidates/z1-union-campaign.json   (verdicts, T1, anchors)
 *   - lupine-rhizo data/candidates/z1_nebdft2k_barriers.lock.json (VASP reference series)
 *   - /tmp/z1-union-local/anchors/path-<i>/anchor-<j>.json  (GPAW anchor receipts)
 *   - /tmp/z1-union-local/inputs/<model>/cell_result.json   (model energy profiles)
 *
 * Usage:
 *   node tools/build-z1-science-panel-fixture.mjs \
 *     [--rhizo ../lupine-rhizo] [--local /tmp/z1-union-local] \
 *     [--out packages/ui/src/science/z1GoldenPanelFixture.json]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const RHIZO = path.resolve(flag('rhizo', path.join(os.homedir(), 'Dev/lupine/lupine-rhizo')));
const LOCAL = path.resolve(flag('local', '/tmp/z1-union-local'));
const OUT = path.resolve(flag('out', 'packages/ui/src/science/z1GoldenPanelFixture.json'));

const GOLDEN_PATH_INDICES = [16, 0, 14, 27];
const MODELS = ['chgnet', 'mace-mp-medium', 'mace-mp-small', 'mace-mpa-0-medium'];

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha256File = (p) => `sha256:${createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`;

/** First index wins on ties — must match the panel's displayed tie rule. */
function argminFirst(values) {
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    if (best < 0 || values[i] < values[best]) best = i;
  }
  return best;
}
function argmaxFirst(values) {
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    if (best < 0 || values[i] > values[best]) best = i;
  }
  return best;
}

const campaignPath = path.join(RHIZO, 'data/candidates/z1-union-campaign.json');
const lockPath = path.join(RHIZO, 'data/candidates/z1_nebdft2k_barriers.lock.json');
const campaign = readJson(campaignPath);
const lock = readJson(lockPath);

const lockByPathId = new Map(lock.paths.map((p) => [p.path_id, p]));
const t1ThresholdMev = campaign.thresholds.t1_gate_mev;

const ZERO_CONVENTION =
  'display zero: each series shifted to its own path minimum; absolute eV values in tooltip/readout';

const fixturePaths = [];
for (const pathIndex of GOLDEN_PATH_INDICES) {
  const entry = campaign.per_path.find((p) => p.path_index === pathIndex);
  if (!entry) throw new Error(`path ${pathIndex} missing from campaign record`);
  const lockEntry = lockByPathId.get(entry.path_id);
  if (!lockEntry) throw new Error(`path ${entry.path_id} missing from barrier lock`);
  const imageCount = entry.image_count;
  if (lockEntry.reference.energies_ev.length !== imageCount) {
    throw new Error(`reference series length mismatch on path ${pathIndex}`);
  }

  // --- GPAW anchor receipts → per-image anchor series (missing stays missing).
  const anchorDir = path.join(LOCAL, 'anchors', `path-${pathIndex}`);
  const receipts = fs.existsSync(anchorDir)
    ? fs.readdirSync(anchorDir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(anchorDir, f)))
    : [];
  const gpawByImage = new Map(receipts.map((r) => [r.anchor_index, r]));
  for (const i of entry.anchors_evaluated) {
    if (!gpawByImage.has(i)) throw new Error(`evaluated anchor ${i} has no receipt on path ${pathIndex}`);
  }

  const unionNominated = new Set(entry.union_model_anchor_indices);
  const denseExtensionImages = entry.anchors_evaluated.filter((i) => !unionNominated.has(i));

  // --- T1 offsets (meV) at evaluated images only; verify wander + driver pair.
  const t1Offsets = [];
  for (let i = 0; i < imageCount; i++) {
    const r = gpawByImage.get(i);
    t1Offsets.push(r ? (r.gpaw_energy_ev - r.reference_energy_ev) * 1000 : null);
  }
  const presentOffsets = t1Offsets.filter((v) => v != null);
  const wanderMev = presentOffsets.length > 1 ? Math.max(...presentOffsets) - Math.min(...presentOffsets) : null;
  if (wanderMev != null && Math.abs(wanderMev - entry.t1_gate.wander_mev) > 1e-6) {
    throw new Error(`T1 wander mismatch on path ${pathIndex}: recomputed ${wanderMev} vs ${entry.t1_gate.wander_mev}`);
  }
  const offsetArgmin = argminFirst(t1Offsets);
  const offsetArgmax = argmaxFirst(t1Offsets);
  const [d0, d1] = entry.t1_gate.driver_pair;
  if (offsetArgmin >= 0 && !(d0 === offsetArgmin && d1 === offsetArgmax) && !(d0 === offsetArgmax && d1 === offsetArgmin)) {
    throw new Error(`T1 driver pair mismatch on path ${pathIndex}: recomputed [${offsetArgmin}, ${offsetArgmax}]`);
  }

  // --- Energy series: VASP reference (full), GPAW anchors (sparse), model profiles.
  const vaspValues = lockEntry.reference.energies_ev;
  const series = [
    {
      id: 'vasp-reference',
      label: 'VASP reference (nebDFT2k)',
      engine: 'VASP',
      role: 'cross-engine reference — secondary',
      unit: 'eV',
      zeroConvention: ZERO_CONVENTION,
      points: vaspValues.map((e, i) => ({ image: i, energyEv: e, status: 'source' })),
    },
    {
      id: 'gpaw-anchors',
      label: 'GPAW anchors (fd, h=0.2, PBE)',
      engine: 'GPAW',
      role: 'same-engine evidence — primary',
      unit: 'eV',
      zeroConvention: ZERO_CONVENTION,
      points: Array.from({ length: imageCount }, (_, i) => {
        const r = gpawByImage.get(i);
        return {
          image: i,
          energyEv: r ? r.gpaw_energy_ev : null,
          status: r ? 'evaluated' : unionNominated.has(i) ? 'nominated' : 'missing',
          denseExtension: r ? !unionNominated.has(i) : false,
        };
      }),
    },
  ];

  const cellResults = {};
  for (const model of MODELS) {
    const f = path.join(LOCAL, 'inputs', model, 'cell_result.json');
    if (!fs.existsSync(f)) continue;
    cellResults[model] = readJson(f);
  }

  const perModel = {};
  for (const model of MODELS) {
    const m = entry.per_model?.[model];
    const missingReason = entry.models_missing?.[model];
    const prediction = cellResults[model]?.predictions?.find((p) => p.path_id === entry.path_id);
    const profile = prediction?.status === 'completed' ? prediction.predicted_image_energies_ev : null;
    if (profile && profile.length !== imageCount) {
      throw new Error(`model ${model} profile length mismatch on path ${pathIndex}`);
    }
    if (profile) {
      series.push({
        id: `model-${model}`,
        label: `${model} profile`,
        engine: model,
        role: 'model profile — guidance only (cross-engine)',
        unit: 'eV',
        zeroConvention: ZERO_CONVENTION,
        points: profile.map((e, i) => ({ image: i, energyEv: e, status: 'source' })),
      });
    }
    perModel[model] = {
      status: m ? 'guided' : missingReason ?? 'absent',
      nominated: m?.anchor_indices ?? [],
      evaluated: m?.anchors_evaluated ?? [],
      complete: m?.complete ?? false,
      shortPathFallback: m?.short_path_fallback ?? null,
      window: m?.window ?? null,
      modelMinIndex: m?.model_min_index ?? null,
      modelMaxIndex: m?.model_max_index ?? null,
      sparseBarrierEv: m?.sparse_barrier_ev ?? null,
      sameEngineAbsErrorMev: m?.same_engine_abs_error_mev ?? null,
      vaspAbsErrorMev: m?.vasp_abs_error_mev ?? null,
      profileAvailable: Boolean(profile),
    };
  }

  // --- Extrema + barrier-defining pair per series, recomputed from stored values.
  const extrema = {};
  for (const s of series) {
    const values = s.points.map((p) => p.energyEv);
    const lo = argminFirst(values);
    const hi = argmaxFirst(values);
    extrema[s.id] = {
      argmin: lo,
      argmax: hi,
      barrierEv: lo >= 0 && hi >= 0 ? values[hi] - values[lo] : null,
      tieRule: 'first-index',
    };
  }
  // Verify against the campaign record: dense barrier must equal the GPAW series barrier.
  const gpawBarrier = extrema['gpaw-anchors'].barrierEv;
  if (gpawBarrier != null && Math.abs(gpawBarrier - entry.dense_barrier_ev) > 1e-9) {
    throw new Error(`dense barrier mismatch on path ${pathIndex}: recomputed ${gpawBarrier} vs ${entry.dense_barrier_ev}`);
  }
  const vaspBarrier = extrema['vasp-reference'].barrierEv;
  if (vaspBarrier != null && Math.abs(vaspBarrier - entry.reference_barrier_ev) > 1e-9) {
    throw new Error(`reference barrier mismatch on path ${pathIndex}: recomputed ${vaspBarrier} vs ${entry.reference_barrier_ev}`);
  }

  // --- Guidance misses: dense-profile extrema not covered by a model's evaluated set.
  const denseLo = extrema['gpaw-anchors'].argmin;
  const denseHi = extrema['gpaw-anchors'].argmax;
  const guidanceMisses = [];
  for (const model of MODELS) {
    const m = perModel[model];
    if (m.status !== 'guided') {
      guidanceMisses.push({ model, kind: 'model-failed', reason: m.status });
      continue;
    }
    const missed = [denseLo, denseHi].filter((i) => i >= 0 && !m.evaluated.includes(i));
    if (missed.length > 0) {
      guidanceMisses.push({ model, kind: 'extremum-missed', missedImages: missed, sameEngineAbsErrorMev: m.sameEngineAbsErrorMev });
    }
  }

  // --- Quality state, derived (no path-index special-casing).
  const guidedCount = MODELS.filter((m) => perModel[m].status === 'guided').length;
  const failedCount = MODELS.filter((m) => perModel[m].status !== 'guided').length;
  const contaminated = entry.t1_gate.verdict === 'contaminated';
  const sameEngineStrongWin =
    guidedCount > 0 &&
    MODELS.filter((m) => perModel[m].status === 'guided').every(
      (m) => (perModel[m].sameEngineAbsErrorMev ?? Infinity) <= campaign.thresholds.strong_win_mev,
    );
  const crossEngineErrorMev = Math.abs(entry.dense_vs_vasp_signed_error_mev);
  const crossEngineLooksAcceptable = crossEngineErrorMev <= campaign.thresholds.win_mev;
  let qualityState;
  if (guidedCount === 0) qualityState = 'all-guides-failed';
  else if (!contaminated) qualityState = 'clean';
  else if (sameEngineStrongWin && crossEngineLooksAcceptable) qualityState = 'strong-win-contaminated';
  else qualityState = 'contaminated';

  fixturePaths.push({
    pathIndex,
    pathId: entry.path_id,
    chemicalSystem: entry.chemical_system,
    imageCount,
    qualityState,
    quality: {
      state: qualityState,
      t1Verdict: entry.t1_gate.verdict,
      sameEngineStrongWin,
      guidedModelCount: guidedCount,
      failedModelCount: failedCount,
      modelDenominator: MODELS.length,
      crossEngineErrorMev,
      crossEngineSignedErrorMev: entry.dense_vs_vasp_signed_error_mev,
      crossEngineLooksAcceptable,
    },
    reactionCoordinate: {
      label: 'reaction-path sequence (NEB image index)',
      unit: 'image',
      definition: 'zero-based climbing-image NEB image index; an ordering along the reaction path, never elapsed time',
    },
    barriers: {
      referenceBarrierEv: entry.reference_barrier_ev,
      denseBarrierEv: entry.dense_barrier_ev,
      denseVsVaspSignedErrorMev: entry.dense_vs_vasp_signed_error_mev,
      vaspSaddleImageIndex: lockEntry.reference.saddle_image_index,
    },
    series,
    extrema,
    anchors: {
      universe: entry.anchor_universe,
      evaluated: entry.anchors_evaluated,
      unionNominated: entry.union_model_anchor_indices,
      denseExtensionImages,
      anchorsMissing: entry.anchors_missing,
      perModel,
    },
    dense: {
      applied: entry.dense_extension_applied,
      complete: entry.dense_complete,
      barrierEv: entry.dense_barrier_ev,
    },
    t1: {
      unit: 'meV',
      definition: 'E_GPAW(i) − E_VASP(i) per NEB image, at evaluated anchors only',
      offsets: t1Offsets.map((v, i) => ({ image: i, offsetMev: v, status: v == null ? 'missing' : 'evaluated' })),
      offsetMeanMev: entry.t1.offset_mean_mev,
      wanderMev: entry.t1_gate.wander_mev,
      thresholdMev: t1ThresholdMev,
      verdict: entry.t1_gate.verdict,
      driverPair: entry.t1_gate.driver_pair,
      evaluatedImageCount: entry.t1.evaluated_image_count,
    },
    guidance: {
      misses: guidanceMisses,
      subsetTheorem: 'exact barrier recovery follows when the evaluated anchor set contains both dense-profile extrema',
    },
  });
}

const fixture = {
  schema: 'lupi.z1-science-panel-fixture.v1',
  generatedBy: 'tools/build-z1-science-panel-fixture.mjs',
  provenance: {
    campaignFile: sha256File(campaignPath),
    barrierLockFile: sha256File(lockPath),
    anchorReceiptDir: path.join(LOCAL, 'anchors'),
    modelInputDir: path.join(LOCAL, 'inputs'),
  },
  campaign: {
    id: campaign.schema,
    sha256: campaign.campaign_sha256,
    recordedAt: campaign.recorded_at,
    preregistration: campaign.preregistration,
    amendment: campaign.amendment,
    thresholds: {
      strongWinMev: campaign.thresholds.strong_win_mev,
      winMev: campaign.thresholds.win_mev,
      t1GateMev: campaign.thresholds.t1_gate_mev,
      basis: campaign.thresholds.basis,
    },
    gpawParams: campaign.gpaw_params,
    t1Summary: {
      pathsWithOffsets: campaign.t1_summary.paths_with_offsets,
      pathsContaminated: campaign.t1_summary.paths_contaminated,
      maxOffsetWanderMev: campaign.t1_summary.max_offset_wander_mev,
      meanOffsetWanderMev: campaign.t1_summary.mean_offset_wander_mev,
    },
    citation:
      'Z1 union campaign, lupine-rhizo ' +
      `${campaign.campaign_sha256.slice(0, 19)}… (recorded ${campaign.recorded_at.slice(0, 10)}). ` +
      `Reference barriers: ${lock.reference_provenance.dataset} (${lock.reference_provenance.source_repository} @ ${lock.reference_provenance.source_revision.slice(0, 7)}), ` +
      `doi:${lock.reference_provenance.doi}, license ${lock.reference_provenance.license}.`,
  },
  paths: fixturePaths,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(fixture, null, 1)}\n`);
console.log(`wrote ${OUT} (${fixturePaths.length} paths, ${fs.statSync(OUT).size} bytes)`);
for (const p of fixturePaths) {
  console.log(
    `  path ${p.pathIndex}: ${p.qualityState} · images ${p.imageCount} · series ${p.series.map((s) => s.id).join(', ')}`,
  );
}
