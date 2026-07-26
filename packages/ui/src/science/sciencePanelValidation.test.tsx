import { describe, expect, it } from 'vitest';
import { validateSciencePanelFixture } from './sciencePanelValidation';
import fixtureJson from './z1GoldenPanelFixture.json';

/** Deep clone so each corruption case starts from the real, valid fixture. */
const freshFixture = () => JSON.parse(JSON.stringify(fixtureJson));

describe('validateSciencePanelFixture', () => {
  it('accepts the shipped golden-set fixture', () => {
    const result = validateSciencePanelFixture(fixtureJson);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects a truncated energy series (cardinality vs imageCount)', () => {
    const fixture = freshFixture();
    fixture.paths[0].series[0].points.pop();
    const result = validateSciencePanelFixture(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('series[0].points') && e.includes('imageCount'))).toBe(true);
  });

  it('rejects an out-of-range anchor index', () => {
    const fixture = freshFixture();
    const n = fixture.paths[1].imageCount;
    fixture.paths[1].anchors.evaluated.push(n);
    const result = validateSciencePanelFixture(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('anchors.evaluated') && e.includes('outside [0,'))).toBe(true);
  });

  it('rejects a NaN energy value', () => {
    const fixture = freshFixture();
    fixture.paths[0].series[1].points[2].energyEv = Number.NaN;
    const result = validateSciencePanelFixture(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('energyEv') && e.includes('finite'))).toBe(true);
  });

  it('rejects an unknown quality state', () => {
    const fixture = freshFixture();
    fixture.paths[0].qualityState = 'probably-fine';
    const result = validateSciencePanelFixture(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('.qualityState'))).toBe(true);
  });

  it('rejects dense-extension images that were never evaluated', () => {
    const fixture = freshFixture();
    fixture.paths[1].anchors.denseExtensionImages.push(fixture.paths[1].anchors.evaluated[0]);
    fixture.paths[1].anchors.evaluated.shift();
    const result = validateSciencePanelFixture(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('denseExtensionImages') && e.includes('not evaluated'))).toBe(true);
  });

  it('rejects a T1 verdict that contradicts the wander gate', () => {
    const fixture = freshFixture();
    const contaminated = fixture.paths.find((p: { t1: { verdict: string } }) => p.t1.verdict === 'contaminated');
    contaminated.t1.verdict = 'clean';
    const result = validateSciencePanelFixture(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('.t1.verdict') && e.includes('contradicts'))).toBe(true);
  });

  it('fails closed on an unknown schema version', () => {
    const fixture = freshFixture();
    fixture.schema = 'lupi.z1-science-panel-fixture.v999';
    const result = validateSciencePanelFixture(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('$.schema'))).toBe(true);
  });

  it('rejects a missing value smuggled in as an observation', () => {
    const fixture = freshFixture();
    const point = fixture.paths[0].series[1].points[0];
    point.status = 'missing';
    const result = validateSciencePanelFixture(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('null energy'))).toBe(true);
  });
});
