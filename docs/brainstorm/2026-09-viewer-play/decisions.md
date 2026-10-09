# Owner decisions, 2026-09-28

Answers to the open questions in [README.md §8](README.md#8-decisions-only-the-owner-can-make). Where an answer overrides the report, this file wins.

## Product and feel

| Question | Decision | What changes in the plan |
|---|---|---|
| Motion on the home page | **Still until touched.** | One SVG hero on `/` that spins only when dragged and opens on tap. Zero canvases, no idle sway, no sound on `/`. |
| First molecule | **C60 buckyball.** | The Buckyball Minute is the first-minute path. No A/B arms for water or caffeine. |
| How far play may stray from molecules | **Anything goes, arcade included.** | The "real twin" rule is not a gate. The round-1 kills of arcade ideas (Periodic Pinball, Nanokart and similar) are lifted; they compete on fun like everything else. The "Illustrative" label still applies to motion that is not data. |
| Audio default | **Off; settings toggle only.** | No "♪ Hear it" chip in the first minute. Expose the existing click-sound toggle in settings; all cues stay silent until someone turns sound on there. |

## Look and UI

| Question | Decision | What changes in the plan |
|---|---|---|
| Default plate | **Dark sage, matching home (`#101817`).** | The viewer opens on the home page's plate, so the SVG hero and the first 3D frame match. |
| Brand accent | **Lime (`#d5ef9c`).** | Chips, focus rings, detent flashes and touch marks use the existing home accent. |
| Default element palette | **Keep CPK.** | House palettes, Foil finishes and Clear are opt-in Looks. |
| Chrome budget on a 390 px phone | **One pill.** | The Play chip absorbs status (illustrative/reset, sensors, replay ready). Everything else lives in its tray or in transient chips. No separate status capsule. |

## Engineering

| Question | Decision | What changes in the plan |
|---|---|---|
| Priority and staffing | **Resources are not the constraint; the R3F v10 port is the priority.** | Plan by dependency order, not engineer-weeks. The port goes first; v9-only feel work is not built separately unless it survives the port unchanged. |
| Immersive XR | **Defer.** | Remove immersive XR from the v10 viewer. iPhone AR stays on USDZ Quick Look (hosted `.usdz` behind a real tap); Android on Scene Viewer. (Amended 2026-10-04 below: native Apple AR is now a separate app.) |
| Export V2 | **Cut early, at the platform swap.** | The WebGPURenderer path ships with the V2 export profile (render-target readback, new renderer fingerprint and artifact keys); AGENTS.md's "V1 truth" is rewritten in the same change. |
| GPU Studio | **Fold into Looks + Play.** | The snowglobe becomes a Look and "shake" a Play verb in the main viewer; the modal, its second GPU device and its render loop go away. |
| Preview lane | **None; straight to production.** | This is an early site and heavy disruption is acceptable. No `/next` build. |
| Contract amendments | **Only what is needed; the bar is that it works.** | Make only the amendments the port or a shipped feature requires. Technical pins stay where the stack demands them (React below 19.3 for v10's peers). |
| Device performance data | **Not a priority; the bar is that it works.** | No thermal soaks, device-lab perf program or frame-rate budgets. The gate spike becomes a functional check: it renders and responds correctly on the WebGPU backend and the WebGL2 fallback, on desktop and phone browsers. |
| North Star metric | **The owner is the North Star.** | No metrics program or delight-event taxonomy as a prerequisite; feedback comes directly from the owner. |
| Cost and content owners | Not asked separately; covered by "resources are not the constraint". | No feature is gated on naming a cost owner. |

## Net effect on the short list

- **Prerequisites removed:** "Measure first" (device lab, telemetry, perf gate) and the metrics parts of the access contract no longer gate anything. Accessibility basics (keyboard route, reduced motion) stay as part of "it works".
- **Order:** the port (R1–R12 in the v10 brief) comes first, with Export V2 and the GPU Studio fold inside it and XR removed. The feel ideas (motion kernel, flick, gestures, detents, arrival, poke ripple) are built on the ported engine rather than as separate v9 slices.
- **Scope added back:** arcade-style games are eligible again.

## Port decisions (2026-09-28, second round)

| Question | Decision | Effect |
|---|---|---|
| GPU Studio | **Remove it now.** | The port deletes the GPU Studio modal; a Look can bring the snowglobe back later on the new engine. `/scan` and the action-light buttons keep working. |
| Sign-off on looks and export images | **None. Ship, then the owner reports feedback.** | No before/after gallery, golden-image approval or pixel thresholds gate the merge. |
| Testing | **Less testing; no new automated checks in CI.** | No new CI lanes or end-to-end specs. Existing CI stays green; tests that only assert removed internals are deleted or rewritten. The dual-backend smoke tool is a local check, not a CI gate. No real-phone checklist. |
| Export background | **Exports use the view as configured in the viewer.** | Raster exports default to whatever background (and, where feasible, look) the user set in the viewer. |
| Landing, labels, three version, axes gizmo | Decided by the lead under "it works". | All port work merges into this branch; 3D labels are canvas-texture sprites; ship on three 0.186.1; the axes gizmo becomes a small overlay. |

## Amendment 2026-10-04: native Apple AR

Owner decision ([docs/ar/decisions.md](../../ar/decisions.md), D1–D13): AR on iPhone and iPad becomes a native SwiftUI + RealityKit app at `apps/apple`, "Lupi" with bundle id `live.lupi.app`, which replaces the Expo app (`apps/mobile`, now frozen as a reference). It is a physics sandbox whose building blocks are molecules, played against the LiDAR mesh of the real room. The plan of record is [docs/ar/plan.md](../../ar/plan.md).

| Question | 2026-09-28 decision | 2026-10-04 amendment |
|---|---|---|
| Immersive XR | Defer. Remove it from the v10 viewer; iPhone AR stays on USDZ Quick Look, Android on Scene Viewer. | Unchanged for the web viewer: no WebXR, and the `/m` pages keep their USDZ Quick Look and Scene Viewer desk models. Native iPhone and iPad AR is no longer deferred: it is the `apps/apple` app above, and it does not depend on Quick Look. |
