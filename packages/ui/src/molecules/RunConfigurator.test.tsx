/**
 * RunConfigurator tests — pure request shaping plus the modal flow against the
 * store flag and a mocked viewer MCP bridge.
 */
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RunConfigurator, buildRunRequest, MAX_PROCEDURAL_ATOMS, type RunSelections } from './RunConfigurator';
import { resetStore, getStoreState } from '../test-utils';

const baseSelections: RunSelections = {
  elements: ['Cu', 'Al'],
  lattice: 'fcc',
  atomCount: 10_000,
  spacing: null,
  showBonds: true,
  colorScheme: 'element',
  atomScale: 1.0,
};

describe('buildRunRequest', () => {
  it('shapes a multi-element procedural request with the viewer patch', () => {
    const request = buildRunRequest(baseSelections);

    expect(request.tool).toBe('lupi.generate_molecule');
    expect(request.arguments.inputType).toBe('procedural');
    expect(request.arguments.elements).toEqual(['Cu', 'Al']);
    expect(request.arguments.lattice).toBe('fcc');
    expect(request.arguments.atomCount).toBe(10_000);
    expect(request.arguments.viewer).toEqual({ showBonds: true, colorScheme: 'element', atomScale: 1.0 });
  });

  it('clamps the atom count to the 1,000,000 procedural cap', () => {
    expect(MAX_PROCEDURAL_ATOMS).toBe(1_000_000);
    const request = buildRunRequest({ ...baseSelections, atomCount: 2_000_000 });
    expect(request.arguments.atomCount).toBe(1_000_000);
    const low = buildRunRequest({ ...baseSelections, atomCount: 0.4 });
    expect(low.arguments.atomCount).toBe(1);
  });

  it('omits spacing when auto and includes it when explicit', () => {
    expect(buildRunRequest(baseSelections).arguments).not.toHaveProperty('spacing');
    const request = buildRunRequest({ ...baseSelections, spacing: 3.6 });
    expect(request.arguments.spacing).toBe(3.6);
  });

  it('rejects an empty element selection', () => {
    expect(() => buildRunRequest({ ...baseSelections, elements: [] })).toThrow(/1–4 elements/);
    expect(() => buildRunRequest({ ...baseSelections, elements: ['Cu', 'Al', 'Ni', 'Fe', 'Co'] })).toThrow(/1–4 elements/);
  });
});

describe('RunConfigurator modal', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    delete (window as { __lupiViewerMcp?: unknown }).__lupiViewerMcp;
  });

  it('renders nothing while the store flag is closed', () => {
    render(<RunConfigurator />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gates the Structure step on at least one selected element', () => {
    getStoreState().openRunConfigurator();
    render(<RunConfigurator />);

    const next = screen.getByRole('button', { name: 'Next →' });
    expect(next).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Copper, atomic number 29' }));
    expect(screen.getByRole('button', { name: 'Next →' })).toHaveProperty('disabled', false);
  });

  it('seeds the element selection from the store seed', () => {
    getStoreState().openRunConfigurator({ elements: ['Cu'] });
    render(<RunConfigurator />);

    expect(screen.getByRole('button', { name: 'Copper, atomic number 29' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Next →' })).toHaveProperty('disabled', false);
  });

  it('executes the built request through the bridge and closes on ok', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    (window as { __lupiViewerMcp?: unknown }).__lupiViewerMcp = { execute };

    getStoreState().openRunConfigurator();
    render(<RunConfigurator />);

    fireEvent.click(screen.getByRole('button', { name: 'Copper, atomic number 29' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next →' })); // → Size
    fireEvent.click(screen.getByRole('button', { name: 'Next →' })); // → Look
    fireEvent.click(screen.getByRole('button', { name: 'Next →' })); // → Review
    fireEvent.click(screen.getByRole('button', { name: 'Run →' }));

    await waitFor(() => expect(getStoreState().runConfiguratorOpen).toBe(false));
    expect(execute).toHaveBeenCalledTimes(1);
    const request = execute.mock.calls[0][0];
    expect(request.tool).toBe('lupi.generate_molecule');
    expect(request.arguments).toMatchObject({
      inputType: 'procedural',
      elements: ['Cu'],
      lattice: 'fcc',
      atomCount: 10_000,
      viewer: { showBonds: false, colorScheme: 'element', atomScale: 1.0 },
    });
    expect(request.arguments).not.toHaveProperty('spacing');
  });

  it('stays open with an inline error when the bridge reports failure', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: false, error: { message: 'boom' } });
    (window as { __lupiViewerMcp?: unknown }).__lupiViewerMcp = { execute };

    getStoreState().openRunConfigurator({ elements: ['Cu'] });
    render(<RunConfigurator />);

    fireEvent.click(screen.getByRole('button', { name: 'Next →' })); // → Size
    fireEvent.click(screen.getByRole('button', { name: 'Next →' })); // → Look
    fireEvent.click(screen.getByRole('button', { name: 'Next →' })); // → Review
    fireEvent.click(screen.getByRole('button', { name: 'Run →' }));

    await screen.findByRole('alert');
    expect(getStoreState().runConfiguratorOpen).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('boom');
  });
});
