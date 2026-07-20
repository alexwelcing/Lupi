import { describe, expect, it, vi } from 'vitest';
import type { Frame } from '@atlas/core/types';
import { writeGlimbinFrameChecked } from './transcodeTypeGuard';

function frameWithType(type: number): Frame {
  return {
    timestep: 50,
    natoms: 1,
    boxBounds: new Float64Array(6),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array([1]),
    identity: { kind: 'source-id', unique: true },
    types: new Int32Array([type]),
    typeSemantics: { kind: 'opaque', provenance: 'lammps-type-id' },
    distanceSemantics: { kind: 'unknown', provenance: 'lammps-dump' },
    positions: new Float32Array(3),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

describe('GLIMBIN transcode type guard', () => {
  it('fails before writer or sink mutation when a valid Int32 type cannot fit u8 storage', () => {
    const writer = {
      bytesWritten: 256,
      addFrame: vi.fn(() => new ArrayBuffer(8)),
    };
    const sink = { write: vi.fn() };

    expect(() => writeGlimbinFrameChecked(frameWithType(256), 3, writer, sink))
      .toThrow(expect.objectContaining({
        name: 'DumpParseError',
        code: 'GLIMBIN_ATOM_TYPE_OUT_OF_RANGE',
        frameIndex: 3,
        timestep: 50,
        atomRow: 1,
        value: 256,
      }));
    expect(writer.addFrame).not.toHaveBeenCalled();
    expect(sink.write).not.toHaveBeenCalled();
  });

  it('writes representable type 255 at the pre-write offset', () => {
    const record = new ArrayBuffer(8);
    const writer = {
      bytesWritten: 256,
      addFrame: vi.fn(() => record),
    };
    const sink = { write: vi.fn() };
    const frame = frameWithType(255);

    writeGlimbinFrameChecked(frame, 0, writer, sink);
    expect(writer.addFrame).toHaveBeenCalledWith(frame);
    expect(sink.write).toHaveBeenCalledWith(record, 256);
  });
});
