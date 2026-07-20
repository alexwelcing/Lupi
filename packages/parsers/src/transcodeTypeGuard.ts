import type { Frame } from '@atlas/core/types';
import { DumpParseError } from './dumpStreamParser';

export interface GlimbinFrameWriterLike {
  readonly bytesWritten: number;
  addFrame(frame: Frame): ArrayBuffer;
}

export interface GlimbinByteSinkLike {
  write(buffer: ArrayBuffer, at: number): void;
}

/**
 * Current GLIMBIN records store atom types as u8. Direct Frame parsing can
 * truthfully retain positive Int32 LAMMPS type IDs, but the streaming
 * persistence route must stop before the core writer's legacy u8 mask can
 * alter them. This guard is removed when GLIMBIN gains Int32 type storage.
 */
export function assertGlimbinTypeStorage(frame: Frame, frameIndex: number): void {
  for (let atomRow = 0; atomRow < frame.natoms; atomRow++) {
    const value = frame.types[atomRow];
    if (!Number.isInteger(value) || value < 1 || value > 255) {
      throw new DumpParseError(
        'GLIMBIN_ATOM_TYPE_OUT_OF_RANGE',
        `LAMMPS atom type ${String(value)} at frame ${frameIndex} ` +
          `(timestep ${frame.timestep}), row ${atomRow + 1} is valid for direct ` +
          'in-memory viewing but cannot be stored by the current streaming GLIMBIN ' +
          'format, which supports type IDs 1..255. No trajectory bytes were committed.',
        {
          frameIndex,
          timestep: frame.timestep,
          atomRow: atomRow + 1,
          value,
        },
      );
    }
  }
}

/** Validate before observing the write offset, encoding, or touching the sink. */
export function writeGlimbinFrameChecked(
  frame: Frame,
  frameIndex: number,
  writer: GlimbinFrameWriterLike,
  sink: GlimbinByteSinkLike,
): void {
  assertGlimbinTypeStorage(frame, frameIndex);
  const at = writer.bytesWritten;
  const record = writer.addFrame(frame);
  sink.write(record, at);
}
