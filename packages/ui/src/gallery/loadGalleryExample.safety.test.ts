import type { Frame, Trajectory } from "@atlas/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { resetStore } from "../test-utils";
import type { GalleryExample } from "./catalog";
import { loadGalleryExample } from "./loadGalleryExample";

const parserMocks = vi.hoisted(() => ({
  canStreamDump: vi.fn(),
  parseFile: vi.fn(),
}));

const streamingMocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  fetchFrame: vi.fn(),
  fetchHeader: vi.fn(),
  fetchIndex: vi.fn(),
  getMetadata: vi.fn(),
}));

vi.mock("@atlas/parsers", () => ({
  canStreamDump: parserMocks.canStreamDump,
  parseFile: parserMocks.parseFile,
}));

vi.mock("@atlas/parsers/StreamingLoader", () => ({
  isGlimbinUrl: (url: string) => /\.glimbin(?:$|\?)/i.test(url),
  StreamingLoader: class MockStreamingLoader {
    dispose = streamingMocks.dispose;
    fetchFrame = streamingMocks.fetchFrame;
    fetchHeader = streamingMocks.fetchHeader;
    fetchIndex = streamingMocks.fetchIndex;
    getMetadata = streamingMocks.getMetadata;
  },
}));

function galleryExample(
  overrides: Partial<GalleryExample> = {},
): GalleryExample {
  return {
    id: "mobile-safety-fixture",
    title: "Mobile safety fixture",
    subtitle: "Exercises the native gallery atom ceiling.",
    domain: "Methods",
    atoms: "40,000",
    frames: "1",
    file: "gallery/mobile-safety-fixture.xyz",
    available: true,
    colors: ["#111111", "#222222", "#333333"],
    ...overrides,
  };
}

function frame(natoms: number): Frame {
  return {
    timestep: 0,
    natoms,
    boxBounds: new Float64Array(6),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ["id", "type", "x", "y", "z"],
    ids: new Int32Array(0),
    types: new Int32Array(0),
    positions: new Float32Array(0),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

function trajectory(...atomCounts: number[]): Trajectory {
  return {
    frames: atomCounts.map(frame),
    totalFrames: atomCounts.length,
    atomTypes: [],
    globalBounds: { min: [0, 0, 0], max: [1, 1, 1] },
  };
}

describe("loadGalleryExample mobile atom safety contract", () => {
  beforeEach(() => {
    resetStore();
    parserMocks.canStreamDump.mockReset();
    parserMocks.parseFile.mockReset();
    streamingMocks.dispose.mockReset();
    streamingMocks.fetchFrame.mockReset();
    streamingMocks.fetchHeader.mockReset().mockResolvedValue(undefined);
    streamingMocks.fetchIndex.mockReset().mockResolvedValue(undefined);
    streamingMocks.getMetadata.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects oversized GLIMBIN metadata before fetching or committing frame zero", async () => {
    streamingMocks.getMetadata.mockReturnValue({
      totalFrames: 12,
      atomsPerFrame: 60_000,
      atomTypes: [1],
      globalBounds: { min: [0, 0, 0], max: [1, 1, 1] },
      boxBounds: new Float64Array(6),
      boxTilt: new Float64Array(3),
      triclinic: false,
      compressed: false,
      hasBonds: false,
      hasProperties: false,
      fileSize: 1024,
      timesteps: Array.from({ length: 12 }, (_, index) => index),
    });
    streamingMocks.fetchFrame.mockResolvedValue(frame(60_000));
    const setFile = vi.spyOn(useStore.getState(), "setFile");

    const result = await loadGalleryExample(
      galleryExample({ file: "gallery/mobile-safety-fixture.glimbin" }),
      { maxAtoms: 50_000 },
    );

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringMatching(/60,000 atoms/i),
    });
    expect(streamingMocks.fetchHeader).toHaveBeenCalledOnce();
    expect(streamingMocks.fetchIndex).toHaveBeenCalledOnce();
    expect(streamingMocks.getMetadata).toHaveBeenCalledOnce();
    expect(streamingMocks.fetchFrame).not.toHaveBeenCalled();
    expect(streamingMocks.dispose).toHaveBeenCalledOnce();
    expect(setFile).not.toHaveBeenCalled();
    expect(useStore.getState().file).toBeNull();
  });

  it("rejects the largest parsed trajectory frame before committing any frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["fixture"]),
      } satisfies Partial<Response>),
    );
    parserMocks.parseFile.mockResolvedValue({
      trajectory: trajectory(40_000, 60_000),
      thermo: null,
    });
    const setFile = vi.spyOn(useStore.getState(), "setFile");

    const result = await loadGalleryExample(galleryExample(), {
      maxAtoms: 50_000,
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringMatching(/60,000 atoms/i),
    });
    expect(parserMocks.parseFile).toHaveBeenCalledOnce();
    expect(setFile).not.toHaveBeenCalled();
    expect(useStore.getState().file).toBeNull();
  });

  it("cannot publish a stale GLIMBIN metadata rejection after navigation supersedes the load", async () => {
    let current = true;
    streamingMocks.fetchIndex.mockImplementation(async () => {
      current = false;
    });
    streamingMocks.getMetadata.mockReturnValue({
      totalFrames: 1,
      atomsPerFrame: 60_000,
      atomTypes: [1],
      globalBounds: { min: [0, 0, 0], max: [1, 1, 1] },
      fileSize: 1024,
    });
    const setFile = vi.spyOn(useStore.getState(), "setFile");

    const result = await loadGalleryExample(
      galleryExample({ file: "gallery/mobile-safety-fixture.glimbin" }),
      { isCurrent: () => current, maxAtoms: 50_000 },
    );

    expect(result).toEqual({
      ok: false,
      message: "Viewer load was superseded by newer navigation.",
    });
    expect(streamingMocks.dispose).toHaveBeenCalledOnce();
    expect(streamingMocks.getMetadata).not.toHaveBeenCalled();
    expect(setFile).not.toHaveBeenCalled();
    expect(useStore.getState().error).toBeNull();
  });

  it("cannot publish a stale dump-header rejection after navigation supersedes the probe", async () => {
    let current = true;
    const header = "ITEM: NUMBER OF ATOMS\n60000\nITEM: ATOMS id type x y z\n";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 206,
      headers: new Headers({
        "content-length": String(header.length),
        "content-range": `bytes 0-${header.length - 1}/${6 * 1024 * 1024}`,
      }),
      blob: async () => {
        current = false;
        return new Blob([header]);
      },
    } satisfies Partial<Response>));
    parserMocks.canStreamDump.mockReturnValue(true);
    const setFile = vi.spyOn(useStore.getState(), "setFile");

    const result = await loadGalleryExample(
      galleryExample({ file: "gallery/mobile-safety-fixture.dump" }),
      { isCurrent: () => current, maxAtoms: 50_000 },
    );

    expect(result).toEqual({
      ok: false,
      message: "Viewer load was superseded by newer navigation.",
    });
    expect(setFile).not.toHaveBeenCalled();
    expect(useStore.getState().error).toBeNull();
  });
});
