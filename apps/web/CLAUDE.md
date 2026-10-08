# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the `apps/web` package of **Lupi**, the browser molecular viewer at lupi.live. It renders through three r186's `WebGPURenderer` on the WebGPU backend, or on its WebGL2 backend where the browser has no WebGPU adapter. The root `AGENTS.md` is the reference for the viewer, its MCP bridge, exports and checks; read it first.

## Commands

```bash
# From the repository root
pnpm install          # Install all dependencies
pnpm build:wasm       # Rebuild Rust WASM parsers (required after modifying packages/parsers/wasm/)
pnpm dev              # Start dev server (Turbo orchestrates all packages)
pnpm test:rust        # Run Rust parser tests
pnpm test             # Full test suite

# From this directory (apps/web/)
pnpm dev              # Start Vite dev server only
pnpm build            # ChatGPT widget, MCP manifest, tsc, Vite build, then the static SEO, /m, OMol25 and /daily pages
```

## Architecture

### Monorepo Structure

```
Lupi/
├── apps/web/              # This package - React app entry point
│   └── src/main.tsx       # Routes to the zero-canvas landing or the viewer (App from @atlas/ui)
├── packages/
│   ├── parsers/
│   │   ├── wasm/src/      # Rust WASM parsers (dump.rs, log.rs, data.rs)
│   │   └── pkg/           # wasm-pack output (atlas-parsers WASM module)
│   ├── renderer/          # Raw WebGPU; only the optional bond-detection compute pass is used
│   ├── scene/             # R3F components (AtomsOptimized, Bonds, SimulationCell) and TSL materials in src/tsl/
│   ├── ui/                # App shell, panels, Zustand store
│   └── core/              # Shared types, colormaps, utilities
```

### Data Flow

1. **Load** → a dropped file, URL, gallery entry or MCP call goes through `packages/ui/src/loadMoleculeSource.ts`
2. **Parsing** → `@atlas/parsers` in web workers: TypeScript byte-level parsers for dumps, XYZ and LAMMPS data; WASM for LAMMPS logs. Trajectories are stored and read as frame-indexed `.glimbin` (see `docs/trajectory-architecture.md`)
3. **State** → Zustand store (`packages/ui/src/store.ts`) holds frames, the current frame index and visualization settings
4. **Scene** → R3F v10 components consume store state inside `LupiCanvas` (`packages/ui/src/viewer/LupiCanvas.tsx`), the only `<Canvas>`
5. **Render** → atoms and bonds are TSL ray-cast impostors (`packages/scene/src/tsl/atomImpostorMaterial.ts`, `bondImpostorMaterial.ts`); the canvas draws on demand (Quiet Idle)

### Key Technical Details

- **Two backends** - `WebGPURenderer` on WebGPU, or its WebGL2 backend; `?renderer=webgl2` forces the fallback. Both must work
- **TSL for shading** - viewer materials are TSL node materials; write new shading in TSL only (no GLSL, raw WGSL or `wgslFn`)
- **Impostors** - each atom is a screen-aligned quad whose fragment ray-casts the sphere and writes per-pixel depth; bonds are ray-cast cylinders
- **Streaming parsers** - dumps parse from bytes in a worker, so atoms render before the file finishes downloading

### Path Aliases

Configured in `vite.config.ts` and root `tsconfig.json`:
- `@atlas/core` → `packages/core/src`
- `@atlas/parsers` → `packages/parsers/src`
- `atlas-parsers` → `packages/parsers/pkg` (WASM module)
- `@atlas/renderer` → `packages/renderer/src`
- `@atlas/scene` → `packages/scene/src`
- `@atlas/ui` → `packages/ui/src`

## WASM Parser Workflow

After modifying Rust code in `packages/parsers/wasm/`:
```bash
pnpm build:wasm   # Rebuilds to packages/parsers/pkg/
pnpm dev          # Vite will pick up new WASM
```

Key exports from `atlas-parsers`:
- `parseDump(content)` - parse entire dump file
- `parseDumpFrame(content, index)` - parse single frame (memory-efficient)
- `countDumpFrames(content)` - count frames without full parse
- `parseLog(content)` - parse LAMMPS log for thermo data
