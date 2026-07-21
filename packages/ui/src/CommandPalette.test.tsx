import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeferredCommandPalette, type CommandAction } from './CommandPalette';

describe('DeferredCommandPalette', () => {
  it('does not mount or group command actions while closed', () => {
    const readGroup = vi.fn(() => 'Viewer');
    const action = {
      id: 'fit-camera',
      label: 'Fit camera',
      get group() {
        return readGroup();
      },
      onSelect: vi.fn(),
    } satisfies CommandAction;

    const onClose = vi.fn();
    render(
      <DeferredCommandPalette
        open={false}
        onClose={onClose}
        actions={[action]}
      />,
    );

    expect(readGroup).not.toHaveBeenCalled();
    expect(screen.queryByText('Fit camera')).toBeNull();
  });
});
