import { beforeEach, describe, expect, it } from 'vitest';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { getStoreState, resetStore } from '../test-utils';
import { LUPI_MCP_TOOL_MAP } from './tools';

describe('camera MCP tools', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns the fresh fitted camera state and retains the active preset direction', async () => {
    getStoreState().setFile({
      name: 'camera-fit.xyz',
      size: 1,
      trajectory: createMockTrajectory(1, 4),
    });
    getStoreState().setCameraPreset('iso');
    getStoreState().setCameraViewportAspect(390 / 844);
    const beforePosition = [...getStoreState().cameraPosition];
    const beforeTarget = [...getStoreState().cameraTarget];
    const beforeDirection = beforePosition.map(
      (coordinate, index) => coordinate - beforeTarget[index],
    );

    const tool = LUPI_MCP_TOOL_MAP.get('lupi.fit_camera');
    if (!tool) throw new Error('fit camera tool is not registered');
    const result = await tool.handler({
      id: 'fit-fresh-state',
      tool: 'lupi.fit_camera',
      arguments: {},
    });
    const fittedState = getStoreState();
    const fittedDirection = fittedState.cameraPosition.map(
      (coordinate, index) => coordinate - fittedState.cameraTarget[index],
    );

    expect(fittedState.cameraPosition).not.toEqual(beforePosition);
    expect(result.cameraPosition).toEqual(fittedState.cameraPosition);
    expect(result.cameraTarget).toEqual(fittedState.cameraTarget);
    expect(fittedState.cameraPreset).toBe('iso');
    expect(fittedDirection[0] / fittedDirection[2]).toBeCloseTo(
      beforeDirection[0] / beforeDirection[2],
    );
    expect(fittedDirection[1] / fittedDirection[2]).toBeCloseTo(
      beforeDirection[1] / beforeDirection[2],
    );
  });

  it('fits a named preset farther away in portrait than landscape', () => {
    getStoreState().setFile({
      name: 'preset-fit.xyz',
      size: 1,
      trajectory: createMockTrajectory(1, 4),
    });
    getStoreState().setCameraViewportAspect(390 / 844);
    getStoreState().setCameraPreset('front');
    const portrait = getStoreState();
    const portraitDistance = Math.hypot(
      ...portrait.cameraPosition.map(
        (coordinate, index) => coordinate - portrait.cameraTarget[index],
      ),
    );

    getStoreState().setCameraViewportAspect(844 / 390);
    getStoreState().setCameraPreset('front');
    const landscape = getStoreState();
    const landscapeDistance = Math.hypot(
      ...landscape.cameraPosition.map(
        (coordinate, index) => coordinate - landscape.cameraTarget[index],
      ),
    );

    expect(portraitDistance).toBeGreaterThan(landscapeDistance);
    expect(portrait.cameraPosition[0]).toBeCloseTo(portrait.cameraTarget[0]);
    expect(portrait.cameraPosition[1]).toBeCloseTo(portrait.cameraTarget[1]);
    expect(portrait.cameraPosition[2]).toBeGreaterThan(
      portrait.cameraTarget[2],
    );
  });
});
