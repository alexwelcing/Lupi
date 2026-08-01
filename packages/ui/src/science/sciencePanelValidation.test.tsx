import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateSciencePanelFixture } from './sciencePanelValidation';
import { SciencePanelDemo } from './SciencePanelDemo';
import { CANONICAL_BUNDLE_REGISTRY } from './canonicalBundleRegistry';
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

describe('SciencePanelDemo canonical bundle rendering', () => {
  afterEach(() => cleanup());

  it('renders exact manifest, bundle, run, and source identities from the canonical bundle', () => {
    const entry = CANONICAL_BUNDLE_REGISTRY[16];
    const manifest = entry.manifest as {
      bundle_id: string;
      run_id: string;
      campaign_id: string;
      source_artifacts: Array<{ role: string; sha256: string }>;
    };
    render(<SciencePanelDemo pathIndex={16} />);

    const panel = screen.getByTestId('science-path-panel');
    expect(panel.getAttribute('data-bundle-status')).toBe('active');
    expect(panel.getAttribute('data-bundle-quality')).toBe('verified');
    const provenance = screen.getByTestId('science-run-provenance').textContent ?? '';
    expect(provenance).toContain(entry.manifestSha256);
    expect(provenance).toContain(manifest.bundle_id);
    expect(provenance).toContain(manifest.run_id);
    expect(provenance).toContain(manifest.campaign_id);
    for (const source of manifest.source_artifacts.filter(
      ({ role }) => role === 'campaign_record' || role === 'barrier_panel',
    )) {
      expect(provenance).toContain(source.sha256);
    }
    expect(screen.queryByTestId('science-fixture-invalid')).toBeNull();
  });

  it('switches tabs by resolving the selected canonical path identity', () => {
    const entry = CANONICAL_BUNDLE_REGISTRY[27];
    render(<SciencePanelDemo pathIndex={16} />);
    fireEvent.click(screen.getByTestId('science-demo-tab-27'));
    expect(screen.getByTestId('science-path-panel').getAttribute('data-path-index')).toBe('27');
    expect(screen.getByTestId('science-run-provenance').textContent).toContain(entry.manifestSha256);
  });

  it('renders the invalid state, not a partial panel, for an unknown canonical path', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<SciencePanelDemo pathIndex={999} />);
    expect(screen.getByTestId('science-fixture-invalid')).toBeTruthy();
    expect(screen.queryByTestId('science-path-panel')).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      '[science-panel] canonical bundle unavailable — failing closed:',
      999,
    );
    errorSpy.mockRestore();
  });
});
