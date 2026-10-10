# Sprint S1, 2026-10-08: Shaders week

The owner handed this sprint to the lead with one steer: look at the shaders that went open source this week. The split is about 20 % creative, 30 % technical and 50 % practical. Ten tracks run in parallel, each one agent on its own branch (`s1/<track>`) in its own worktree, and the lead merges them into `claude/nifty-volta-ophavr`.

Results, screenshots and what was verified are in [status.md](status.md) once the tracks land. Screenshots for review are in [shots/](shots/).

## What went open source this week

**Shaders** ([shaders.com](https://shaders.com), [shader-effects-inc/shaders](https://github.com/shader-effects-inc/shaders)) open-sourced its WebGPU rendering engine, all 199 components and its framework bindings under MIT on 2026-10-06 (v4.0.2). It is a declarative layer library: `<Shader>` hosts a canvas and its children are layers (gradients, noise, glass, metal, halftone, engraving, dither, film grain, transitions, fluid and reaction-diffusion sims) blended on the GPU.

The lead read the whole source (read-only, nothing run) before deciding how Lupi should use it:

| Question | Finding |
|---|---|
| Backends | WebGPU only. There is no WebGL path; without WebGPU the canvas stays transparent. Lupi must also work on three's WebGL2 fallback. |
| Where it draws | Only to its own `<canvas>`. It cannot render into a three.js render target or take one as input. |
| Device sharing | It accepts an external `GPUDevice`, but then calls `preventDefault()` on every `uncapturederror` on that device, which would hide three.js's own WebGPU errors. |
| Frame loop | Renders every frame at up to 60 fps, even when nothing changes, unless paused. Lupi's viewer draws no frames on a still view (Quiet Idle). |
| Telemetry | On by default for 5 % of mounts on any production hostname: one POST to `shaders.com/api/telemetry` with performance figures, component names and the hostname. `disableTelemetry` turns it off. Lupi has no CSP to block it. |
| Size | `shaders/js` imports all 199 components (about 2 MB minified); one framework component still pulls in several hundred KB of shared engine, with `typegpu` pinned at a pre-1.0 release. |
| Licence | MIT throughout, except FilmStock's LUT data (CC BY-SA 4.0) and four files marked "adapted from paper-design/shaders" (not used here). |
| The math | Clean, stateless, single-pass per-pixel functions (smoothstep, fract, fwidth, MaterialX noise), which port directly to TSL. |

**Decision: port the math, don't ship the runtime.** The effects Lupi wants are adapted by hand into TSL inside Lupi's own impostors and post chain. That way they run on both backends, follow Quiet Idle, appear in exports under the existing artifact rules, and send nothing to a third party. `NOTICE.md` carries the MIT notice; each adapted file names the component it follows. Running the Shaders runtime as a decorative DOM layer was considered and set aside (WebGPU-only, its own frame loop, telemetry, and the zero-canvas rule on `/`, `/m` and `/daily`).

## Tracks

### Creative (about 20 %)

| Track | What a visitor gets | Ported from Shaders | Size |
|---|---|---|---|
| **c1-print-inks** | Two new Illustrate shadings: **Engrave** (banknote line engraving whose plates thicken and cross into the shade) and **Halftone** (print dots on a rotated screen). Looks grid, palette, `I` key memory, share links, saved views, MCP `inkStyle` and every raster export carry them. | Engraving, Halftone | M |
| **c2-foil-refinished** | The three Remix Foil finishes are redrawn: Holo gets glitter flakes and laminate wrinkles, Gold leaf reflects a procedural studio, Pearl gets a thin-film nacre. The code-to-finish mapping, names and odds don't change, and Foil still never reaches an export. | Holographic, Chrome (studio environment), ThinFilm | S–M |

### Technical (about 30 %)

| Track | What it does | Size |
|---|---|---|
| **t1-ink-contour** | A screen-space contour pass for the Illustrate look: ink where balls meet and sticks enter balls, plus a heavier outer silhouette, in the live view and in every raster export (assembled once at output resolution, so tiles never seam). Closes the gap named in `docs/ink-and-light.md`. Adapts Shaders' Chalkboard Sobel ring to depth. | M–L |
| **t2-light-fuse** | **Light Fuse**: Ink-to-Light and the lit⇄ink toggle travel through the molecule along its own bond graph from a seed atom (the touched or selected one), running down each stick, with a burnt-paper edge after Shaders' NoiseDissolve. Spatial wavefront for big frames; captures never see a half-fused molecule. | M |
| **t3-morph-arrival** | **Morph arrival**: switching molecules, each new atom starts where a matching atom of the old molecule was (same element first) and flies home, so C60 → caffeine rearranges its carbons. Display-only, CPU twin kept exact so overlays ride it. | M–L |

### Practical (about 50 %)

| Track | What it does | Size |
|---|---|---|
| **p1-wave3-qa** | Wave 3 was never seen in a browser. Local smoke plugins for Remix and Foil codes, Instant Replay, the phone sheets and the static pages (`/m`, `/daily`, `/scale`, `/play`), run in both backend lanes on desktop and phone profiles, plus fixes for what they find and for known bugs (the pill naming a Foil finish under ink; an MCP export moving the live camera). Writes a QA receipt. | L |
| **p2-repo-hygiene** | Builds stop dirtying the tree (the MCP manifest's `generatedAt`); the dead `vitest.workspace.ts`; root clutter (one-off scripts, a duplicate `popular_molecules/`, stale agent plans, tracked bytecode); an orphan public JSON that exposes 1,258 local `/home/...` paths; stale root notes archived under `docs/archive/`. | S–M |
| **p3-dead-code** | Verified dead code out: about 1,500 lines of orphan UI files, unused exports, the unused WGSL atom/bond pipeline in `packages/renderer`, a never-called legacy render path in the Worker; unused dependencies (Rive, mp4-muxer, gifenc) and lint noise. | M |
| **p4-docs-truth** | README stops presenting the frozen Expo app as the iPhone app and lists every app and package; AGENTS.md fixes (the 8 ms LupiScale gate, which checks CI really runs, the Remix "worlds" export claim); single-reference fixes across docs; CHANGELOG catches up on waves 1–3, OMol25, `/scale` and the Apple app. | M |
| **p5-ci-tests** | CI runs the Worker tests once instead of twice and gets a job timeout; deploy workflows pin actions by SHA like the rest; a dead actionlint filter; stale HDR network stubs in the browser tests; the `THREE_CJS_DEPRECATED` noise in unit tests. No new CI checks (owner rule). | S–M |

## Rules every track follows

- Owner decisions in `docs/brainstorm/2026-09-viewer-play/decisions.md`: the bar is "it works"; no new CI lanes or end-to-end specs (local smoke plugins are fine); `/` stays zero-canvas; illustrative motion and cosmetic effects never reach an export; Remix r1 codes resolve the same forever.
- Both backends: everything new is TSL, never raw WGSL.
- Each track ships its own local smoke plugin and 2–6 screenshots for review, and passes lint, its packages' unit tests and the web build before its last commit.

## Merge plan

The lead merges in dependency order and re-runs the gates after each merge: p2 → p5 → p4 → p3 → c2 → c1 → t2 → t3 → t1 → p1. t1 changes the export capture facts, so after the last merge the lead re-derives the V2 render-parity candidates for both backends (`pnpm verify:render-parity -- --backend=<webgpu|webgl2> --derive-candidate`), which were already stale (41 of their 82 input files have changed since 2026-10-02).

## Baseline at the start (HEAD 11d1f4f)

- Lint: 0 errors. Unit tests: core 477, scene 122, ui 824, Worker 143, all passing. Web build passes.
- Dual-backend desktop smoke (built app, SwiftShader): about 700 checks, no failure, before the run hit the lead's 15-minute cap.
- CI on `main`: green since 2026-10-05. No open issues.

## Decisions waiting on the owner

These came out of the audit and are deliberately not done in S1:

1. **Retire the old release-controller tooling** (`tools/cloudflare-release-*.mjs`, `build-cloudflare-release-package*.mjs`, `verify-release-authority-freeze*.mjs`, about 5,500 lines). The workflow it served was retired; 8 of 28 of its tests already fail and none run in CI.
2. **Leave the workspace or stay**: `apps/remotion-trailer` (48.5 MB, build is an `echo`), `apps/lupine-app` (a separate Stripe SaaS, not deployed from here) and the frozen `apps/mobile` (its Expo graph carries 4 of the 5 ignored CVEs and a 2.5-minute CI job on every PR).
3. **A Content-Security-Policy.** Lupi sends none. A report-only policy first would show what an enforced one would break (Firebase auth, HDRI fallback, analytics, Hugging Face calls).
4. **Regenerate the sphere-grid gallery labels**: the copy the gallery uses still carries 3,906 local `/home/...` paths; regenerating needs the external lupine-wiki checkout.
5. **`infra/` vs `scripts/gcs/`**: two GCS CORS configs disagree; one should go.

## Open pull requests: triage

Recommendations only; nothing was closed or merged.

| PR | Recommendation | Why |
|---|---|---|
| [alexwelcing/Lupi#126](https://github.com/alexwelcing/Lupi/pull/126) Fix native iOS and Simulator builds on Mac (draft) | **Keep** | Active Apple work from 2026-10-05; CI green. |
| [alexwelcing/Lupi#121](https://github.com/alexwelcing/Lupi/pull/121) OMol25 discovery in Lupi Dev | **Close** | It targets the Expo app, frozen by D1 the next day. |
| [alexwelcing/Lupi#120](https://github.com/alexwelcing/Lupi/pull/120) ImgBot | **Close**, and tell ImgBot to ignore `tests/fixtures/` | It recompresses the render-artifact parity candidate PNGs, whose bytes are the fixtures. |
| [alexwelcing/Lupi#107](https://github.com/alexwelcing/Lupi/pull/107) remove the merge gate | **Close** | Superseded: the 2026-09-28 decisions keep CI ("existing CI stays green"). |
| [alexwelcing/Lupi#102](https://github.com/alexwelcing/Lupi/pull/102) deploy health SHA | **Close** | `main` already passes `LUPI_BUILD_SHA` through `--var` in `deploy-cloudflare.yml`. |
| [alexwelcing/Lupi#89](https://github.com/alexwelcing/Lupi/pull/89) sphere-grid labels + SSAO fix | **Close** | The SSAO fix is merged in other form; the labels file it refreshes is the orphan p2 deletes. |
| [alexwelcing/Lupi#88](https://github.com/alexwelcing/Lupi/pull/88) VIS-2C bundle adapter | **Close after a glance** | `adaptVisualizationBundle.ts` and `canonicalBundleRegistry.ts` are on `main` already. |
| [alexwelcing/Lupi#78](https://github.com/alexwelcing/Lupi/pull/78) Firebase handler route gate | **Close after a glance** | `tools/verify-cloudflare-live.mjs` on `main` already checks `/__/firebase/init.json` and `/__/auth/handler`. |
