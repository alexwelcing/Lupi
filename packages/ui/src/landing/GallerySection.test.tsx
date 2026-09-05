import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GallerySection } from './GallerySection';
afterEach(cleanup);

describe('student collection', () => {
  it('publishes only the 12 selected models with real viewer links', () => {
    render(<GallerySection />);
    expect(screen.getAllByRole('article')).toHaveLength(12);
    expect(screen.getByRole('link', { name: 'Explore Water' }).getAttribute('href')).toBe('/?sim=water');
    expect(screen.queryByText(/Research Payload|Potential Benchmark|OMol25|Sphere Grid/)).toBeNull();
  });
  it('filters by learner topic and can return to all examples', () => {
    render(<GallerySection />);
    fireEvent.click(screen.getByRole('button', { name: 'Start small' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Carbon structures' }));
    expect(screen.getAllByRole('article')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'All examples' }));
    expect(screen.getAllByRole('article')).toHaveLength(12);
  });
  it('makes search scope and empty-state recovery explicit', () => {
    render(<GallerySection />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find an example' }), {
      target: { value: 'CAFFEINE' },
    });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'unobtainium' },
    });
    expect(screen.getByText('No matching examples')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('article')).toHaveLength(12);
  });
});
