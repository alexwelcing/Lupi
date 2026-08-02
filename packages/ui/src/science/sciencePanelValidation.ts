/**
 * Fail-closed runtime validation for the Z1 science-panel fixture.
 *
 * The fixture ships inside the bundle and is rendered as trusted science.
 * If it drifts, is regenerated incorrectly, or is corrupted, the panel must
 * NOT render guessed or partial science — it must fail closed with precise
 * error paths. This mirrors the publisher-side rule that unknown schema
 * versions and non-recomputing records go to quarantine.
 *
 * Checked contract (see sciencePanelTypes.ts):
 *   - schema version (unknown versions fail closed);
 *   - required campaign/path fields and enum-valued states;
 *   - per-series point cardinality vs imageCount, unique zero-based image
 *     coverage, finite numbers only, per-value status enums, and
 *     status/value consistency (missing ⟺ null);
 *   - anchor/extrema indices within [0, imageCount), denseExtension ⊆ evaluated;
 *   - T1 offsets cardinality, verdict enum, driver pair range, and
 *     verdict/wander/threshold consistency;
 *   - cross-field quality consistency (clean ⟺ T1 clean; all-guides-failed
 *     ⟺ zero guided models).
 */

const QUALITY_STATES = new Set(['clean', 'contaminated', 'strong-win-contaminated', 'no-guides-completed', 'all-guides-failed']);
const VALUE_STATUSES = new Set(['evaluated', 'nominated', 'missing', 'source']);
const T1_VERDICTS = new Set(['clean', 'contaminated']);
const FIXTURE_SCHEMA = 'lupi.z1-science-panel-fixture.v1';

export interface FixtureValidation {
  ok: boolean;
  /** Precise machine-readable error paths, e.g. "paths[0].series[1].points[3].energyEv: expected finite number". */
  errors: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);

export function validateSciencePanelFixture(input: unknown): FixtureValidation {
  const errors: string[] = [];
  const fail = (path: string, message: string) => errors.push(`${path}: ${message}`);

  if (!isObj(input)) {
    return { ok: false, errors: ['$: expected an object'] };
  }
  if (input.schema !== FIXTURE_SCHEMA) {
    fail('$.schema', `unknown fixture schema ${JSON.stringify(input.schema)} — failing closed (expected ${FIXTURE_SCHEMA})`);
    return { ok: false, errors }; // unknown schema versions quarantine immediately
  }

  // ---- campaign block ----
  const campaign = input.campaign;
  if (!isObj(campaign)) {
    fail('$.campaign', 'missing campaign block');
  } else {
    if (!isNonEmptyString(campaign.id)) fail('$.campaign.id', 'missing');
    if (!isNonEmptyString(campaign.sha256) || !campaign.sha256.startsWith('sha256:')) {
      fail('$.campaign.sha256', 'expected "sha256:…" digest string');
    }
    if (!isNonEmptyString(campaign.recordedAt)) fail('$.campaign.recordedAt', 'missing');
    if (!isNonEmptyString(campaign.citation)) fail('$.campaign.citation', 'missing — citation must come from the record, never be synthesized');
    const th = campaign.thresholds;
    if (!isObj(th) || !isFiniteNumber(th.t1GateMev) || (th.t1GateMev as number) <= 0) {
      fail('$.campaign.thresholds.t1GateMev', 'expected positive finite number');
    }
    const t1s = campaign.t1Summary;
    if (!isObj(t1s) || !isInt(t1s.pathsWithOffsets) || !isInt(t1s.pathsContaminated)) {
      fail('$.campaign.t1Summary', 'expected pathsWithOffsets/pathsContaminated integers');
    }
  }

  // ---- paths ----
  const paths = input.paths;
  if (!Array.isArray(paths) || paths.length === 0) {
    fail('$.paths', 'expected a non-empty array');
    return { ok: false, errors };
  }

  paths.forEach((path, pi) => {
    const P = (suffix: string) => `$.paths[${pi}]${suffix}`;
    if (!isObj(path)) {
      fail(P(''), 'expected an object');
      return;
    }
    if (!isInt(path.pathIndex) || (path.pathIndex as number) < 0) fail(P('.pathIndex'), 'expected non-negative integer');
    if (!isNonEmptyString(path.pathId)) fail(P('.pathId'), 'missing — do not coerce to a number');
    if (!isNonEmptyString(path.chemicalSystem)) fail(P('.chemicalSystem'), 'missing');
    const imageCount = path.imageCount;
    if (!isInt(imageCount) || (imageCount as number) < 2) {
      fail(P('.imageCount'), 'expected integer ≥ 2');
      return; // every per-image check below depends on this
    }
    const n = imageCount as number;
    const inRange = (v: unknown): v is number => isInt(v) && (v as number) >= 0 && (v as number) < n;

    // reaction coordinate: NEB framing, never time/temperature
    const rc = path.reactionCoordinate;
    if (!isObj(rc) || !isNonEmptyString(rc.label) || !isNonEmptyString(rc.definition)) {
      fail(P('.reactionCoordinate'), 'missing label/definition');
    } else if (/\b(time|temperature|elapsed)\b/i.test(`${rc.label} ${(rc as { unit?: unknown }).unit ?? ''}`)) {
      fail(P('.reactionCoordinate'), 'label/unit must never name time or temperature for an NEB sequence');
    }

    // quality state
    const quality = path.quality;
    if (!QUALITY_STATES.has(path.qualityState as string)) {
      fail(P('.qualityState'), `unknown state ${JSON.stringify(path.qualityState)}`);
    }
    if (!isObj(quality)) {
      fail(P('.quality'), 'missing');
    } else {
      const g = quality.guidedModelCount;
      const f = quality.failedModelCount;
      const m = quality.missingModelCount ?? 0;
      const d = quality.modelDenominator;
      if (!isInt(d) || (d as number) < 1) fail(P('.quality.modelDenominator'), 'expected integer ≥ 1 (honest denominators)');
      if (!isInt(g) || (g as number) < 0 || !isInt(f) || (f as number) < 0 || !isInt(m) || (m as number) < 0) {
        fail(P('.quality'), 'guided/failed/missing model counts must be non-negative integers');
      } else if (isInt(d) && (g as number) + (f as number) + (m as number) !== (d as number)) {
        fail(P('.quality'), `guided (${g}) + failed (${f}) + missing (${m}) must equal denominator (${d})`);
      }
      if (!isFiniteNumber(quality.crossEngineErrorMev) || (quality.crossEngineErrorMev as number) < 0) {
        fail(P('.quality.crossEngineErrorMev'), 'expected non-negative finite number');
      }
      if ('crossEngineSignedErrorMev' in quality && !isFiniteNumber(quality.crossEngineSignedErrorMev)) {
        fail(P('.quality.crossEngineSignedErrorMev'), 'expected finite number (sign carries direction)');
      }
    }

    // series
    const series = path.series;
    const seriesIds = new Set<string>();
    if (!Array.isArray(series) || series.length === 0) {
      fail(P('.series'), 'expected a non-empty array');
    } else {
      series.forEach((s, si) => {
        const S = P(`.series[${si}]`);
        if (!isObj(s)) {
          fail(S, 'expected an object');
          return;
        }
        if (!isNonEmptyString(s.id)) fail(`${S}.id`, 'missing');
        else seriesIds.add(s.id);
        if (!isNonEmptyString(s.label) || !isNonEmptyString(s.engine) || !isNonEmptyString(s.role)) {
          fail(S, 'missing label/engine/role');
        }
        if (s.unit !== 'eV') fail(`${S}.unit`, `expected "eV", got ${JSON.stringify(s.unit)}`);
        if (!isNonEmptyString(s.zeroConvention)) fail(`${S}.zeroConvention`, 'missing — every series states its zero convention');
        const points = s.points;
        if (!Array.isArray(points)) {
          fail(`${S}.points`, 'expected an array');
          return;
        }
        if (points.length !== n) {
          fail(`${S}.points`, `cardinality ${points.length} does not match imageCount ${n}`);
          return;
        }
        points.forEach((p, idx) => {
          const PT = `${S}.points[${idx}]`;
          if (!isObj(p)) {
            fail(PT, 'expected an object');
            return;
          }
          if (p.image !== idx) {
            fail(`${PT}.image`, `expected unique zero-based coverage (image ${idx}), got ${JSON.stringify(p.image)}`);
          }
          if (!VALUE_STATUSES.has(p.status as string)) {
            fail(`${PT}.status`, `unknown status ${JSON.stringify(p.status)}`);
          }
          const hasValue = p.energyEv !== null;
          if (hasValue && !isFiniteNumber(p.energyEv)) {
            fail(`${PT}.energyEv`, `expected finite number or null, got ${JSON.stringify(p.energyEv)}`);
          }
          // status/value consistency: missing values stay missing; observations carry finite values
          if ((p.status === 'missing' || p.status === 'nominated') && hasValue) {
            fail(PT, `status ${JSON.stringify(p.status)} must carry a null energy, not an observation`);
          }
          if ((p.status === 'evaluated' || p.status === 'source') && !hasValue) {
            fail(PT, `status ${JSON.stringify(p.status)} must carry a finite energy`);
          }
        });
      });
    }

    // extrema per series
    const extrema = path.extrema;
    if (!isObj(extrema)) {
      fail(P('.extrema'), 'missing');
    } else {
      for (const id of seriesIds) {
        const ex = extrema[id];
        if (!isObj(ex)) {
          fail(P(`.extrema.${id}`), 'missing extrema for series');
          continue;
        }
        if (!inRange(ex.argmin)) fail(P(`.extrema.${id}.argmin`), `expected integer in [0, ${n}), got ${JSON.stringify(ex.argmin)}`);
        if (!inRange(ex.argmax)) fail(P(`.extrema.${id}.argmax`), `expected integer in [0, ${n}), got ${JSON.stringify(ex.argmax)}`);
        if (ex.barrierEv !== null && (!isFiniteNumber(ex.barrierEv) || (ex.barrierEv as number) < 0)) {
          fail(P(`.extrema.${id}.barrierEv`), `expected non-negative finite number or null, got ${JSON.stringify(ex.barrierEv)}`);
        }
        if (ex.tieRule !== 'first-index') fail(P(`.extrema.${id}.tieRule`), `expected "first-index"`);
      }
    }

    // anchors
    const anchors = path.anchors;
    if (!isObj(anchors)) {
      fail(P('.anchors'), 'missing');
    } else {
      const checkIndexArray = (key: string) => {
        const arr = anchors[key];
        if (!Array.isArray(arr)) {
          fail(P(`.anchors.${key}`), 'expected an array');
          return [] as number[];
        }
        arr.forEach((v, i) => {
          if (!inRange(v)) fail(P(`.anchors.${key}[${i}]`), `index ${JSON.stringify(v)} outside [0, ${n})`);
        });
        return arr.filter(inRange);
      };
      const evaluated = checkIndexArray('evaluated');
      checkIndexArray('universe');
      checkIndexArray('unionNominated');
      const denseExt = checkIndexArray('denseExtensionImages');
      checkIndexArray('anchorsMissing');
      const evaluatedSet = new Set(evaluated);
      denseExt.forEach((v) => {
        if (!evaluatedSet.has(v)) fail(P('.anchors.denseExtensionImages'), `image ${v} tagged dense-extension but not evaluated`);
      });
      if (!isObj(anchors.perModel)) {
        fail(P('.anchors.perModel'), 'missing');
      } else {
        for (const [model, m] of Object.entries(anchors.perModel)) {
          if (!isObj(m)) {
            fail(P(`.anchors.perModel.${model}`), 'expected an object');
            continue;
          }
          for (const key of ['nominated', 'evaluated'] as const) {
            const arr = m[key];
            if (!Array.isArray(arr)) {
              fail(P(`.anchors.perModel.${model}.${key}`), 'expected an array');
              continue;
            }
            arr.forEach((v, i) => {
              if (!inRange(v)) fail(P(`.anchors.perModel.${model}.${key}[${i}]`), `index ${JSON.stringify(v)} outside [0, ${n})`);
            });
          }
          if (m.sameEngineAbsErrorMev !== null && !isFiniteNumber(m.sameEngineAbsErrorMev)) {
            fail(P(`.anchors.perModel.${model}.sameEngineAbsErrorMev`), `expected finite number or null`);
          }
        }
      }
    }

    // T1 block
    const t1 = path.t1;
    if (!isObj(t1)) {
      fail(P('.t1'), 'missing');
    } else {
      if (!T1_VERDICTS.has(t1.verdict as string)) fail(P('.t1.verdict'), `unknown verdict ${JSON.stringify(t1.verdict)}`);
      if (!isFiniteNumber(t1.wanderMev) || (t1.wanderMev as number) < 0) {
        fail(P('.t1.wanderMev'), `expected non-negative finite number`);
      }
      if (!isFiniteNumber(t1.thresholdMev) || (t1.thresholdMev as number) <= 0) {
        fail(P('.t1.thresholdMev'), `expected positive finite number`);
      }
      const dp = t1.driverPair;
      if (!Array.isArray(dp) || dp.length !== 2 || !inRange(dp[0]) || !inRange(dp[1])) {
        fail(P('.t1.driverPair'), `expected two image indices in [0, ${n})`);
      }
      const offsets = t1.offsets;
      if (!Array.isArray(offsets) || offsets.length !== n) {
        fail(P('.t1.offsets'), `cardinality must match imageCount ${n}`);
      } else {
        offsets.forEach((o, i) => {
          const O = P(`.t1.offsets[${i}]`);
          if (!isObj(o)) {
            fail(O, 'expected an object');
            return;
          }
          if (o.image !== i) fail(`${O}.image`, `expected ${i}, got ${JSON.stringify(o.image)}`);
          if (o.offsetMev !== null && !isFiniteNumber(o.offsetMev)) {
            fail(`${O}.offsetMev`, `expected finite number or null, got ${JSON.stringify(o.offsetMev)}`);
          }
        });
      }
      // verdict must agree with the gate
      if (T1_VERDICTS.has(t1.verdict as string) && isFiniteNumber(t1.wanderMev) && isFiniteNumber(t1.thresholdMev)) {
        const shouldBeContaminated = (t1.wanderMev as number) > (t1.thresholdMev as number);
        const declaredContaminated = t1.verdict === 'contaminated';
        if (shouldBeContaminated !== declaredContaminated) {
          fail(P('.t1.verdict'), `verdict ${JSON.stringify(t1.verdict)} contradicts wander ${t1.wanderMev} meV vs gate ${t1.thresholdMev} meV`);
        }
      }
    }

    // cross-field quality consistency
    if (isObj(t1) && T1_VERDICTS.has(t1.verdict as string) && QUALITY_STATES.has(path.qualityState as string) && isObj(quality)) {
      if (t1.verdict === 'clean' && path.qualityState !== 'clean') {
        fail(P('.qualityState'), `T1-clean path must not be marked ${JSON.stringify(path.qualityState)}`);
      }
      if (t1.verdict === 'contaminated' && path.qualityState === 'clean') {
        fail(P('.qualityState'), 'T1-contaminated path must not be marked clean');
      }
      if (path.qualityState === 'all-guides-failed' && quality.guidedModelCount !== 0) {
        fail(P('.qualityState'), 'all-guides-failed requires guidedModelCount 0');
      }
      if (path.qualityState === 'all-guides-failed' && quality.failedModelCount !== quality.modelDenominator) {
        fail(P('.qualityState'), 'all-guides-failed requires every model state to be failed');
      }
      if (path.qualityState === 'no-guides-completed' && (quality.guidedModelCount !== 0 || (quality.missingModelCount ?? 0) === 0)) {
        fail(P('.qualityState'), 'no-guides-completed requires zero guided models and at least one missing model');
      }
    }

    // barriers + guidance blocks exist and are finite where required
    const barriers = path.barriers;
    if (!isObj(barriers) || !isFiniteNumber(barriers.denseBarrierEv) || !isFiniteNumber(barriers.referenceBarrierEv)) {
      fail(P('.barriers'), 'missing dense/reference barrier values');
    }
    if (!isObj(path.guidance) || !Array.isArray((path.guidance as { misses?: unknown }).misses)) {
      fail(P('.guidance.misses'), 'expected an array (empty means no misses, with the subset theorem stated)');
    }
  });

  return { ok: errors.length === 0, errors };
}
