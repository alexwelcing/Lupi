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
| Immersive XR | **Defer.** | Remove immersive XR from the v10 viewer. iPhone AR stays on USDZ Quick Look (hosted `.usdz` behind a real tap); Android on Scene Viewer. |
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
