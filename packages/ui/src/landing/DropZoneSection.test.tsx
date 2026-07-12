import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from '../test-utils';
import { DropZoneSection } from './DropZoneSection';
import { parseFile } from '@atlas/parsers';

vi.mock('@atlas/parsers', () => ({
  detectFileType: () => 'xyz',
  parseFile: vi.fn(async () => { throw new Error('Invalid XYZ'); }),
  readDumpHead: vi.fn(),
  analyzeDumpHead: vi.fn(),
}));

describe('DropZoneSection retry behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    globalThis.IntersectionObserver = class IntersectionObserver {
      constructor(_callback: IntersectionObserverCallback) {}
      observe() {}
      unobserve() {}
      disconnect() {}
      root = null;
      rootMargin = '';
      thresholds = [];
      takeRecords() { return []; }
    };
  });

  it('lets a researcher choose the same file again after a parse error', async () => {
    const { container } = render(<DropZoneSection />);
    const file = new File(['not xyz'], 'broken.xyz', { type: 'text/plain' });

    let input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole('button', { name: 'Choose another molecular data file' });
    expect(parseFile).toHaveBeenCalledTimes(1);

    input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(parseFile).toHaveBeenCalledTimes(2));
  });
});
