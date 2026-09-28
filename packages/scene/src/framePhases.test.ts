import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer/webgpu';
import { getScheduler, useFrame } from '@react-three/fiber/webgpu';
import { describe, expect, it } from 'vitest';
import { LUPI_JOB, LUPI_PHASE, installLupiPhases } from './framePhases';

describe('Lupi frame phases', () => {
  it('installs idempotently and every job id is unique', () => {
    installLupiPhases();
    installLupiPhases();
    const scheduler = getScheduler();
    for (const phase of Object.values(LUPI_PHASE)) expect(scheduler.hasPhase(phase)).toBe(true);
    const ids = Object.values(LUPI_JOB);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('runs jobs in the order update → canonical → uniforms → render → capture → finish', async () => {
    const order: string[] = [];
    // Registered in reverse on purpose: phases, not mount order, decide.
    const jobs: Array<[string, string]> = [
      ['finish', 'finish'],
      [LUPI_PHASE.capture, 'capture'],
      [LUPI_PHASE.uniforms, 'uniforms'],
      [LUPI_PHASE.canonical, 'canonical'],
      ['update', 'update'],
    ];
    function Job({ phase, name }: { phase: string; name: string }) {
      useFrame(() => {
        order.push(name);
      }, { phase });
      return null;
    }
    function Jobs() {
      return React.createElement(
        React.Fragment,
        null,
        ...jobs.map(([phase, name]) => React.createElement(Job, { key: name, phase, name })),
      );
    }

    const renderer = await ReactThreeTestRenderer.create(React.createElement(Jobs));
    try {
      order.length = 0;
      await ReactThreeTestRenderer.act(async () => {
        await renderer.advanceFrames(1, 1 / 60);
      });
      const frame = ['update', 'canonical', 'uniforms', 'capture', 'finish'];
      // One or more whole frames, each in phase order.
      expect(order.length).toBeGreaterThan(0);
      expect(order.length % frame.length).toBe(0);
      for (let start = 0; start < order.length; start += frame.length) {
        expect(order.slice(start, start + frame.length)).toEqual(frame);
      }
    } finally {
      await renderer.unmount();
    }
  }, 30_000);
});
