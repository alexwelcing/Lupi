# Million-atom molecules in AR on iPhone and iPad: research report and recommended architecture

Scope: how to show and lightly interact with a structure of about 1,000,000 atoms in AR. The targets are an A17 Pro, A18 Pro, A19 Pro or A20 Pro iPhone and an M4 or M5 iPad Pro, at 60 fps, with occlusion and good lighting. The date is 2026-10-04. Every external claim has a URL. Anything I could not confirm is marked **UNCONFIRMED**. Numbers marked **estimate** are my own arithmetic, not measurements.

---

## 0. Summary

1. **A million atoms is a culling and data problem, not a shading problem.** At trophy scale (a 25 nm assembly shown 25 cm across, so 1 Å = 1 mm) only about 1–3 % of atoms are visible from any one viewpoint. Precomputed exterior visibility plus per-cluster GPU culling brings the drawn set to roughly **50–150k atoms**. Lupi's web impostor renderer already handles counts like that. The packed data is only **about 8–16 MB**. Drawing all 1M impostor quads every frame is the thing to avoid: about 2M triangles per frame strains the tile-based GPU's binning ("Tiled Vertex Buffer … may cause a Partial Render if full") ([WWDC20 10602](https://developer.apple.com/videos/play/wwdc2020/10602/)).
2. **RealityKit alone cannot draw pixel-exact sphere impostors.** `CustomMaterial` surface shaders can set colour, normal, opacity and so on, and can `discard_fragment()`. They have **no depth output** ([Metal-RealityKit APIs PDF](https://developer.apple.com/metal/Metal-RealityKit-APIs.pdf), [custom materials article](https://developer.apple.com/documentation/realitykit/modifying-realitykit-rendering-using-custom-materials)). Billboards therefore intersect like flat coins. That is fine at 2–4 px per atom and wrong up close.
3. **Recommended: a hybrid.**
   - **RealityKit (`RealityView`, iOS 26+)** owns the world: anchors, the shelf, physics, occlusion from scene understanding, small trophies and UI.
   - A **Lupi-owned Metal "molecule engine"** draws big structures inside RealityView's `customPostProcessing` hook (iOS 26). That hook hands you RealityKit's `sourceColorTexture`, `sourceDepthTexture`, `projection` and `commandBuffer` ([PostProcessEffectContext](https://developer.apple.com/documentation/realitykit/postprocesseffectcontext), [RealityViewPostProcessEffect](https://developer.apple.com/documentation/realitykit/realityviewpostprocesseffect)), so the molecule can be depth-tested against RealityKit's depth.
   - **Small molecules** (OMol25 rows are at most a few hundred atoms) stay native RealityKit entities so they get RealityKit's lighting, shadows and physics for free.
4. **Physics happens at chunk level, never atom level.** Rigid whole bodies, subunits joined by `PhysicsJoint` (iOS 18), and elastic-network or cloth deformation for "flexible" personalities. Per-atom motion stays visual only: Lupi's existing Tug, Burst and Heat display motion, ported to Metal compute.
5. **Minimum OS: iOS/iPadOS 26.** Post-process, `MeshInstancesComponent` and `GestureComponent` need it. iOS 27 adds `LevelOfDetailComponent`, `GaussianSplatComponent` and `ClothBodyComponent`.
6. Four spikes (section 9) de-risk the parts I could not confirm from documentation. The biggest: whether camera pose and depth semantics line up inside the post-process hook.

---

## 1. Platform facts as of 2026-10-04

### Devices and GPU families

| Chip | Devices | Metal GPU family | Notes |
|---|---|---|---|
| A17 Pro | iPhone 15 Pro | Apple9 | 6-core GPU, hardware ray tracing "4x faster than software-based" ([Apple newsroom](https://www.apple.com/newsroom/2023/09/apple-unveils-iphone-15-pro-and-iphone-15-pro-max/)); family per [Metal Feature Set Tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf) |
| A18 / A18 Pro | iPhone 16 family | Apple9 | [Feature Set Tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf) |
| A19 / A19 Pro | iPhone 17 family | Apple10 | 6-core GPU with Neural Accelerators per core; vapor chamber, "up to 40 percent better sustained performance" ([newsroom](https://www.apple.com/newsroom/2025/09/apple-unveils-iphone-17-pro-and-iphone-17-pro-max/)) |
| A20 Pro | iPhone 18 Pro / Pro Max (on sale 2026-09-18) | **UNCONFIRMED** (the tables are dated 2026-05-21 and predate it) | 7-core GPU "up to 40 percent faster than A19 Pro", "50 percent more memory bandwidth than A19 Pro" ([newsroom](https://www.apple.com/newsroom/2026/09/apple-debuts-iphone-18-pro-and-iphone-18-pro-max/)); 2622×1206 at 460 ppi, LiDAR ([specs](https://www.apple.com/iphone-18-pro/specs/)) |
| M4 | iPad Pro (2024) | Apple9 | [Feature Set Tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf) |
| M5 | iPad Pro (Oct 2025) | Apple10 | 10-core GPU with a Neural Accelerator per core; 12 GB (256/512 GB models), 16 GB (1/2 TB); ">150GB/s" bandwidth ([newsroom](https://www.apple.com/newsroom/2025/10/apple-introduces-the-powerful-new-ipad-pro-with-the-m5-chip/)); 13" is 2752×2064, LiDAR, 10–120 Hz ProMotion ([specs](https://www.apple.com/ipad-pro/specs/)) |

iPhone RAM is not published on Apple's spec pages, so 8 GB (15/16 Pro) and 12 GB (17 Pro) are **UNCONFIRMED** (12 GB is developer-reported in [forum thread 834805](https://developer.apple.com/forums/thread/834805)). A-series memory bandwidth is also **UNCONFIRMED**.

### Metal features that matter here

All from the [Metal Feature Set Tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf), dated 2026-05-21:

| Feature | Minimum family |
|---|---|
| Mesh shading | Apple7 |
| Indirect mesh draw arguments / ICBs containing mesh draws | Apple9 |
| Full 64-bit atomics on iOS (Apple8 has ulong min/max only on macOS) | Apple9 |
| Floating-point atomics | Apple7 |
| Texture atomics | Apple6 |
| Ray tracing in compute and render pipelines | Apple6 |
| MetalFX temporal upscaling | Apple7 |
| MetalFX denoised upscaling | Apple9 |
| Sampler min/max reduction (useful for a Hi-Z pyramid) | Apple10 |
| Depth bounds test | Apple10 |
| Metal 4 programming model | Apple7 |

Limits from the same tables:

- Mesh-shader payload 16,384 B.
- Threadgroups per mesh grid: 1,024 (Apple7/8), 1,048,575 (Apple9), 4,194,303 (Apple10).
- Threadgroup memory 32 KB.
- Maximum point size 511 px.
- Footnote 6: ray tracing and function pointers in render pipelines are **incompatible with mesh shading**.

The per-meshlet output maxima of 256 vertices and 512 primitives come from a third-party summary ([Linebender](https://linebender.org/wiki/gpu/mesh-shaders/)). The MSL spec only defines the `mesh<V,P,NV,NP,t>` template, with topology `point`, `line` or `triangle` ([MSL 4.1 spec](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf)). Exact maxima are **UNCONFIRMED** from Apple.

MSL lets a fragment shader declare `[[depth(any|greater|less)]]` (conservative depth), and `[[early_fragment_tests]]` cannot be combined with depth output ([MSL 4.1 spec](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf)). Apple's GPU guidance: "if we discard or update the depth, we will need to go back to HSR". Draw opaque first, then alpha-test/discard/depth-feedback geometry, then translucent ([WWDC20 10602](https://developer.apple.com/videos/play/wwdc2020/10602/)). Whether `depth(greater)` recovers hidden-surface-removal efficiency on Apple GPUs is **UNCONFIRMED**; measure it.

### RealityKit and ARKit API availability

| API | iOS/iPadOS | What it gives us |
|---|---|---|
| `ARView` + `renderCallbacks.postProcess` (`ARView.PostProcessContext`) | 15 | color, depth, projection, commandBuffer ([doc](https://developer.apple.com/documentation/realitykit/arview/postprocesscontext)); `ARView` itself is iOS 13 and not deprecated ([doc](https://developer.apple.com/documentation/realitykit/arview)) |
| `CustomMaterial` (surface shader + geometry modifier) | 15 | no depth output (see summary) |
| `ARView` scene understanding `.occlusion` / `.physics` / `.collision` | 13.4 | LiDAR mesh ([doc](https://developer.apple.com/documentation/realitykit/arview/environment-swift.struct/sceneunderstanding-swift.struct/options-swift.struct)) |
| `LowLevelMesh`, `LowLevelTexture` | 18 | GPU-writable buffers: `replace(bufferIndex:using:)` returns an `MTLBuffer` written from a command buffer ([LowLevelMesh](https://developer.apple.com/documentation/realitykit/lowlevelmesh), [WWDC24 10104](https://developer.apple.com/videos/play/wwdc2024/10104/)) |
| `RealityViewCameraContent` (RealityView on iOS) | 18 | `renderingEffects` toggles AA, grain, DoF, motion blur ([doc](https://developer.apple.com/documentation/realitykit/realityviewrenderingeffects)) |
| `SpatialTrackingSession` | 18 | scene-understanding `.occlusion/.physics/.collision/.shadow` on iOS 18 ([doc](https://developer.apple.com/documentation/realitykit/spatialtrackingsession/configuration/sceneunderstandingcapability)) |
| `SpatialTrackingSession.run(_:session:arConfiguration:)` | 18 | you own the `ARSession`, which is needed for `ARWorldMap` persistence ([doc](https://developer.apple.com/documentation/realitykit/spatialtrackingsession/run(_:session:arconfiguration:))) |
| `PhysicsJoint`, `ForceEffect`, `PhysicsSimulationComponent` | 18 | fixed, spherical, revolute, prismatic, distance and custom joints ([doc](https://developer.apple.com/documentation/realitykit/physicsjoint)) |
| `GroundingShadowComponent`, `ImageBasedLightComponent` | 18 | [doc](https://developer.apple.com/documentation/realitykit/groundingshadowcomponent) |
| `RealityRenderer` | 18 | renders RealityKit into your own Metal workflow, but its output descriptor exposes only `colorTextures`, no depth ([doc](https://developer.apple.com/documentation/realitykit/realityrenderer)) |
| `MeshInstancesComponent` + `LowLevelInstanceData` | 26 | GPU instancing; transforms writable from Metal via `replace(using:)`; per-instance data to `CustomMaterial` via `LowLevelBuffer` on iOS ([doc](https://developer.apple.com/documentation/realitykit/meshinstancescomponent), [WWDC25 287](https://developer.apple.com/videos/play/wwdc2025/287/)) |
| `RealityViewPostProcessEffect`, `PostProcessEffectContext` | 26 | `sourceColorTexture`, `sourceDepthTexture`, `targetColorTexture`, `projection`, `commandBuffer` |
| `GestureComponent` | 26 | SwiftUI gestures on entities ([doc](https://developer.apple.com/documentation/realitykit/gesturecomponent)) |
| `ARKitAnchorComponent` | 26 | `arAnchor` on iOS ([doc](https://developer.apple.com/documentation/realitykit/arkitanchorcomponent)) |
| `ManipulationComponent` | **visionOS 26 only** | not available on iOS ([doc](https://developer.apple.com/documentation/realitykit/manipulationcomponent)) |
| `EnvironmentBlendingComponent` | **visionOS only** | [doc](https://developer.apple.com/documentation/realitykit/environmentblendingcomponent) |
| `LevelOfDetailComponent` | 27 | distance- or screen-area-based LOD ([doc](https://developer.apple.com/documentation/realitykit/levelofdetailcomponent), [WWDC26 279](https://developer.apple.com/videos/play/wwdc2026/279/)) |
| `GaussianSplatComponent` / `GaussianSplatResource` | 27 | buffers of position, scale, rotation, opacity, SH ([doc](https://developer.apple.com/documentation/realitykit/gaussiansplatcomponent), [WWDC26 279](https://developer.apple.com/videos/play/wwdc2026/279/)) |
| `ClothBodyComponent` | 27 | particle cloth with target shapes, inflation and external forces ([doc](https://developer.apple.com/documentation/realitykit/clothbodycomponent)) |
| `LowLevelMesh.Descriptor.instanceCapacity`, `allowsPrimitiveRestart` | 27 | DocC JSON for those members |
| ARKit `ARWorldMap` / `getCurrentWorldMap` | 12 | [doc](https://developer.apple.com/documentation/arkit/arworldmap), [sample](https://developer.apple.com/documentation/arkit/saving-and-loading-world-data) |
| ARKit `AREnvironmentProbeAnchor`, `environmentTexturing` | 12 | [doc](https://developer.apple.com/documentation/arkit/arenvironmentprobeanchor) |
| ARKit `sceneReconstruction` | 13.4 | [doc](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/scenereconstruction) |
| ARKit `sceneDepth`, `smoothedSceneDepth` | 14 | LiDAR, every frame, lower resolution than the camera image ([doc](https://developer.apple.com/documentation/arkit/arframe/scenedepth), [WWDC20 10611](https://developer.apple.com/videos/play/wwdc2020/10611/)). 256×192 is **UNCONFIRMED** |
| MetalFX spatial and temporal / frame interpolator | 16 / 26 | [MetalFX](https://developer.apple.com/documentation/metalfx), [MTLFXFrameInterpolator](https://developer.apple.com/documentation/metalfx/mtlfxframeinterpolator) |
| `MTLIOCommandQueue` (zlib / LZFSE / LZ4 / LZMA / LZBitmap) | 16 | [doc](https://developer.apple.com/documentation/metal/mtliocommandqueue), [codecs](https://developer.apple.com/documentation/metal/mtliocompressionmethod) |

WWDC26 had no iOS ARKit session I could find. On iOS 27 the visionOS-27 guide only notes that ARKit object tracking is available on iOS ([WWDC26 visionOS guide](https://developer.apple.com/wwdc26/guides/visionos/)).

---

## 2. The scale math (all estimates)

- **Size of a 1M-atom assembly.** Protein is about 1.35 g/cm³ and averages about 6.9 Da per atom including H, which gives about 0.118 atoms/Å³. 1M atoms is about 8.5×10⁶ Å³, a solid sphere about **25 nm** across. A real reference: the STMV whole-virus MD system is about 1M atoms including solvent ([Freddolino et al. 2006](https://doi.org/10.1016/j.str.2005.11.014)).
- **Trophy scale.** 25 nm shown as 25 cm means 1 Å = 1 mm, and a carbon atom (vdW radius 1.7 Å) becomes a 3.4 mm bead.
- **On-screen size.** iPhone 18 Pro is 2622×1206 px ([specs](https://www.apple.com/iphone-18-pro/specs/)). Assuming about 50° horizontal field of view across 1206 px in portrait (about 1,380 px/rad; **UNCONFIRMED**, it depends on the camera crop), one atom is **about 9 px at 0.5 m, 5 px at 1 m and 2.3 px at 2 m**. The whole molecule at 0.5 m is about 690 px wide and covers about 0.37 MP.
- **Visible atoms per view.** Projected cross-section is π·126² ≈ 50,000 Å². At about 5–8 Å² per frontmost atom that is 6–10k frontmost atoms, and about 15–30k at least partly visible: **1.5–3 %**.
- **Atoms that can be seen from any outside viewpoint** (structure intact). A shell about 6 Å thick holds 4π·126²·6·0.118 ≈ **140k atoms (14 %)**. About half face the camera, so roughly 70k.
- **Fragment cost is not the problem.** 0.37 MP × 2–4× overdraw is about 1–1.5M fragment invocations of a ray-sphere test. The real costs are primitive count, tiling and memory traffic, which is why culling comes first.
- **Bandwidth.** 1M atoms × 16 B is 16 MB. Even read twice per frame that is about 2 GB/s at 60 fps. The M5 iPad Pro has >150 GB/s ([newsroom](https://www.apple.com/newsroom/2025/10/apple-introduces-the-powerful-new-ipad-pro-with-the-m5-chip/)); the phone figure is **UNCONFIRMED** but certainly tens of GB/s.

Lupi already contains most of the algorithms:

- `/home/user/Lupi/packages/scene/src/AtomsOptimized.tsx`: 12 B position plus a packed 4 B word per atom, palette textures, sub-pixel culling, "far-LOD cluster splats carry the silhouette".
- `/home/user/Lupi/packages/scene/src/BillionAtomBlock.tsx`: four LOD tiers over 9,261 bricks (atoms, then 2³-cell, 6³-cell and per-brick splats). Positions are derived from the instance index, so there is no per-atom data.
- `/home/user/Lupi/packages/scene/src/atomOcclusion.ts`: density AO bake in the QuteMol style.
- `/home/user/Lupi/packages/scene/src/atomContactOcclusion.ts`: contact AO.

The current mobile AR draws one `ViroSphere` per atom (`/home/user/Lupi/apps/mobile/src/features/ar/molecule-ar-surface.native.tsx`, React Native with `@reactvision/react-viro`). That is the "slapped on" part, and it cannot scale.

---

## 3. Rendering techniques (question 1)

### 3.1 Primitive options

| Technique | Per atom | Strengths | Weaknesses / Apple notes |
|---|---|---|---|
| **Ray-cast sphere impostor** (billboard quad, per-pixel ray-sphere, writes depth) | 4 verts / 2 tris, or 1 point | Pixel-exact spheres and intersections; the standard in VMD, PyMOL, Mol* and VTX ([Mol*](https://doi.org/10.1093/nar/gkab314), [VTX](https://doi.org/10.3389/fbinf.2025.1588661)) | A depth write sends fragments back through hidden-surface removal ([WWDC20 10602](https://developer.apple.com/videos/play/wwdc2020/10602/)); use `depth(greater)` and front-to-back cluster order |
| **Point sprite impostor** | 1 vert | 4× less vertex work; max 511 px ([tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf)) | Clipped by the point centre at screen edges; good for 2–32 px atoms |
| **Mesh shaders** (object stage culls a cluster, mesh stage emits ≤64 quads = 256 verts) | via cluster | Culling and expansion in one pass, no intermediate buffers ([WWDC22 10162](https://developer.apple.com/videos/play/wwdc2022/10162/), [LOD sample](https://developer.apple.com/documentation/metal/adjusting-the-level-of-detail-using-metal-mesh-shaders)) | Apple7+; indirect mesh draws Apple9+; incompatible with ray tracing in render pipelines |
| **Compute ("software") rasterization** into a 64-bit depth\|id visibility buffer | 1 atomic | Cost almost independent of primitive count; 2 billion points at 60 fps on desktop with 4-byte adaptive-precision points ([Schütz et al. 2022](https://doi.org/10.1145/3543863), [arXiv](https://arxiv.org/abs/2204.01287)) | Needs 64-bit atomics (Apple9+ on iOS); ideal for atoms of 2 px or less; shade in a resolve pass |
| **Cluster splats** (one sphere or ellipsoid per N atoms) | 1/N | Silhouette at distance; cellVIEW and Mesoscale Explorer merge "multiple adjacent spheres into a single sphere" ([Mesoscale Explorer](https://doi.org/10.1002/pro.5177)) | Loses atomic texture; only for clusters a few px wide |
| **Triangle-mesh spheres** (instanced icosphere) | 80–320 tris | True geometry, so RealityKit lights, shadows and depth just work | Does not scale. ChimeraX VR: "more than a few thousand atoms render too slowly" ([ChimeraX VR docs](https://www.cgl.ucsf.edu/chimerax/docs/user/vr.html)) |
| **Gaussian splats** (RealityKit iOS 27) | 1 splat | Built into RealityKit; soft "mesoscale haze" look | Alpha blending needs sorting, which Mobile-GS identifies as the main mobile bottleneck ([arXiv 2603.11531](https://arxiv.org/abs/2603.11531)). Atoms are opaque, so impostors avoid the sort. iPhone performance at 1M is **UNCONFIRMED** |
| **Hardware ray tracing** of sphere bounding boxes | BVH | Exact shadows and AO in the near field; Apple9+ ([BoundingBox geometry](https://developer.apple.com/documentation/metal/mtlaccelerationstructureboundingboxgeometrydescriptor)) | BVH build cost for 1M boxes and per-ray cost are **UNCONFIRMED**; a stretch goal |

### 3.2 GPU-driven culling and LOD pipeline

All of this is precomputed except the per-frame compute pass.

1. **Spatial ordering and clusters (bake).** Sort atoms in Morton order inside each chunk (chain or subunit), then cut runs of 64 atoms into clusters: 1M atoms become **15,625 clusters**. 64 atoms × 4 verts = 256 is exactly one mesh-shader meshlet.
2. **Exterior visibility (bake).** Flood-fill "outside" on a 1–2 Å occupancy grid, dilated by a 1.4 Å probe (solvent-accessible-surface style). Flag atoms within r + probe of an outside voxel. This is linear in N plus the grid size, well under a second (**estimate**), and treats sealed cavities as interior. Store two bits per atom: *visible when intact* and *visible when its chunk is alone*, so the exterior set can switch when chunks fly apart.
3. **Normal cones (bake).** A per-cluster outward-normal cone allows meshlet-style cone culling of the back half: about −50 % in the intact view.
4. **Per-frame compute cull** over 15.6k clusters (each thread: frustum, cone, exterior flag, clipping plane, two-phase Hi-Z against last frame's depth). Two-phase Hi-Z is from GPU-driven pipelines ([Haar and Aaltonen 2015](https://advances.realtimerendering.com/s2015/aaltonenhaar_siggraph2015_combined_final_footer_220dpi.pdf)) and Nanite ([SIGGRAPH 2021 course](https://advances.realtimerendering.com/s2021/index.html)). The pass also chooses a tier from projected size:
   - **L0**, atom radius ≥ 1.5 px: impostor quads through mesh shader or indirect instanced draw, with bonds in the near field only.
   - **L1**, 0.5–1.5 px: compute raster as points into the visibility buffer (Apple9+); points or splats on Apple7/8.
   - **L2**, cluster under about 3 px: one cluster splat.
   - **L3**, chunk under about 3 px: one chunk splat. Every trophy you are not looking at costs KB, not MB.

   Grounding: Grottel et al. culled and deferred-shaded 100M-atom MD ([CGF 2010](https://doi.org/10.1111/j.1467-8659.2009.01698.x)). Lindow et al. ([CGF 2012](https://doi.org/10.1111/j.1467-8659.2012.03128.x)) and Falk et al. ([CGF 2013](https://doi.org/10.1111/cgf.12197)) ray-cast instanced atomistic cells. cellVIEW renders "up to 15 billion atoms smoothly at 60Hz" with an LOD scheme in Unity ([VCBM 2015](https://doi.org/10.2312/vcbm.20151209)). Mesoscale Explorer runs ray-cast impostors with frustum and occlusion culling, instancing and SSAO up to 3 billion atoms in a browser ([Protein Science 2024](https://doi.org/10.1002/pro.5177)). VTX is "meshless … impostor-based … adaptive LOD", benchmarked on 114M beads ([Frontiers 2025](https://doi.org/10.3389/fbinf.2025.1588661)).
5. **Hi-Z from final depth** for the next frame. Apple10's sampler min/max reduction makes the mip build cheaper. A bonus: if RealityKit's depth contains the LiDAR occlusion mesh, clusters hidden behind the real shelf get culled too (**UNCONFIRMED**, spike S1).
6. **Display-motion bounds.** Tug, Burst, Heat and physics deformation inflate cluster bounds by the maximum offset, the same idea as `CustomMaterial.boundsMargin`.

### 3.3 Shading, AO and lighting

- **Per-atom AO** baked at import (QuteMol: [Tarini et al. 2006](https://doi.org/10.1109/TVCG.2006.115); Lupi `atomOcclusion.ts`), 1 byte per atom. **Edge cueing** in post (QuteMol, or Lupi's Ink outline) costs about 0.3 ms (**estimate**).
- **Contact AO** (Lupi's K-nearest-neighbour bake) costs 8×4–8 B per atom, which is 32–64 MB at 1M. Use it only for L0 clusters near the camera, or drop it at colossus scale.
- **AR lighting:**
  - RealityKit content gets ARKit environment texturing automatically.
  - For the custom pass, use `AREnvironmentProbeAnchor.environmentTexture` as image-based lighting, plus ARKit light estimation ([probe anchor](https://developer.apple.com/documentation/arkit/arenvironmentprobeanchor)).
  - Draw a Lupi-style contact shadow on the anchor plane (RealityKit's `GroundingShadowComponent` cannot see post-process content).
  - Set `renderingEffects.cameraGrain` and `motionBlur` off, or reproduce them, so RealityKit content and the molecule match ([RealityViewRenderingEffects](https://developer.apple.com/documentation/realitykit/realityviewrenderingeffects)).
- **Occlusion:**
  - LiDAR devices: scene-understanding `.occlusion` (iOS 18 `SpatialTrackingSession`, or `ARView` since 13.4).
  - Custom pass: `sceneDepth` / `smoothedSceneDepth` (iOS 14), as in Apple's [fog](https://developer.apple.com/documentation/arkit/creating-a-fog-effect-using-scene-depth) and [point-cloud](https://developer.apple.com/documentation/arkit/displaying-a-point-cloud-using-scene-depth) samples.
  - People occlusion in custom renderers: [sample](https://developer.apple.com/documentation/arkit/effecting-people-occlusion-in-custom-renderers).
  - Non-LiDAR iPads and iPhones get people occlusion only.
- **Bonds at scale.** Default colossi to space-filling (no bonds); about 1 bond per atom would double the primitive count. Show ball-and-stick only for L0 clusters near the camera, in a selected region, or on a cut face.
- **Upscaling.** If thermals force it, render the molecule pass at 0.67–0.75× and upscale with MetalFX spatial (Apple3+) or temporal (Apple7+, needs our motion vectors). Avoid MetalFX frame interpolation in AR: it adds latency against a live camera feed (my reasoning, not an Apple statement).

### 3.4 Procedural colossi are free

A 1M- or 1B-atom crystal needs no per-atom data at all: positions come from the instance index, as in `BillionAtomBlock.tsx`. That is the fastest honest demo of "a million atoms in AR". The HUD should say "1,000,000 atoms · 84,212 drawn", the same as the web's honest stats.

---

## 4. RealityKit vs custom Metal vs hybrid (question 2)

| | A. RealityKit only | B. Custom Metal + ARKit | **C. Hybrid (recommended)** |
|---|---|---|---|
| How the molecule draws | `LowLevelMesh` filled by our compute cull; a `CustomMaterial` geometry modifier billboards using `vertex_id`, `world_to_view` and `custom_attribute`; the surface shader computes the normal and discards outside the disc ([PDF](https://developer.apple.com/metal/Metal-RealityKit-APIs.pdf)). Or `MeshInstancesComponent` spheres | Own render passes: camera YCbCr via `CVMetalTextureCache` ([Apple sample](https://developer.apple.com/documentation/arkit/displaying-an-ar-experience-with-metal)), mesh shaders, compute raster | Big molecules: our Metal passes inside `customPostProcessing` (iOS 26) or `ARView.renderCallbacks.postProcess` (iOS 15), depth-tested against `sourceDepthTexture`. Small molecules: native entities |
| Exact sphere depth | **No** (no depth output) | Yes | Yes |
| Mesh shaders, indirect draws, 64-bit-atomic raster | No (RealityKit issues the draws; the CPU must know index counts, so a 1-frame-late GPU-to-CPU count readback) | Yes | Yes, inside post |
| Anchors, physics, scene-mesh collision, gestures, grounding shadows | Free | Rebuild everything (Jolt etc.: [JoltPhysics](https://github.com/jrouwe/JoltPhysics)) | Free for the world; molecule gets an invisible RealityKit physics proxy |
| Real-world occlusion | Free (scene mesh) | `sceneDepth` sampling | Via RealityKit depth if it includes the occlusion mesh (**UNCONFIRMED**); otherwise sample `sceneDepth` |
| Lighting match | Free IBL | Own (probe anchors) | Own for the molecule; RealityKit for the rest |
| Picking | Compound `CollisionComponent` with `CollisionCastHit.shapeIndex` ([doc](https://developer.apple.com/documentation/realitykit/collisioncasthit)) plus CPU per-atom test | GPU ID buffer | Both |
| Main risks | "Coin" intersections up close; draw-count plumbing | Months of engine work; ARKit integration details | Camera-pose sync in post (only `projection` is provided), depth format and MSAA, translucent RealityKit content drawn under us |

Things ruled out:

- `RealityRenderer` (iOS 18) runs inverted (RealityKit inside our Metal), but its output has **no depth texture** ([doc](https://developer.apple.com/documentation/realitykit/realityrenderer)), so correct inter-occlusion is impossible.
- `ManipulationComponent` is visionOS only, so grab and throw on iOS is ours to build (GestureComponent, kinematic while held, then a dynamic release).

**Fallback ladder.**

1. **Post-process engine.** iOS 26 RealityView, or `ARView` on iOS 15+ if spike S1 shows that `ARView.cameraTransform` and `session` give better sync.
2. **LowLevelMesh impostor discs** (option A). Acceptable at 2–4 px per atom.
3. **iOS 27 `GaussianSplatComponent` or `LevelOfDetailComponent` proxies** for the far field.

---

## 5. Data, memory, thermals (question 3)

### Formats and sizes

| Format | Notes |
|---|---|
| PDB | Limited to 99,999 atoms and 62 chains; large assemblies exist **only as PDBx/mmCIF** ([PDBj large structures](https://pdbj.org/help/large-structures?lang=en)). At 81 B per line, 1M atoms would be about 81 MB anyway (**estimate**) |
| mmCIF | About 100–150 B per atom as text, so about 100–150 MB for 1M atoms (**estimate**) |
| BinaryCIF | More than 2× smaller than gzipped CIF; for the largest structures "factor ten and four versus CIF … and gzipped CIF" ([Sehnal et al. 2020](https://doi.org/10.1371/journal.pcbi.1008247)). Best import format for the server bake |
| **LupiPack v1** (proposal) | Device-native, mmap-able, about 13–16 MB for 1M atoms (layout below) |

LupiPack v1 layout (little-endian, 16 KB page-aligned sections):

```
Header 64 B     magic 'LUPK', version, atom/cluster/bond/chunk counts, Å-per-unit, bbox, section offsets
Clusters 48 B×C center f32×3, radius f32, aabbHalf f16×3, coneAxis oct16, coneCos f16,
                firstAtom u32, count u16, flags u16 (exterior bits), splatRGBA8, chunkId u16, lodParent u32, pad
Atoms 8 B×N     pos u16×3 (normalized in cluster AABB → <0.001 Å for a 32 Å cluster), typeSlot u8, exposure u8
Bonds           intra-cluster (u8 a, u8 b, u8 kind) + inter-cluster (u32, u32, u8 kind); kinds from lupi-bonds.molecular.v1
LOD splats      L2 per cluster (16 B), L3 per chunk (16 B)
Chunks          id, atom range, mass, inertia tensor, collision spheres (≤64), interface table (for joints/breaking)
Cold (lazy)     original serials, residue/chain ids (≈4 B/atom), only for the atom card
```

For 1M atoms: about 8 MB atoms, 0.75 MB clusters, 3–5 MB bonds, under 1 MB LOD and chunks. Loading:

- `mmap` plus `makeBuffer(bytesNoCopy:)` gives zero-copy GPU buffers ([doc](https://developer.apple.com/documentation/metal/mtldevice/makebuffer(bytesnocopy:length:options:deallocator:))).
- Or stream compressed sections through `MTLIOCommandQueue` with LZ4 or LZFSE (iOS 16).
- Load time is tens of ms for a cached pack (**estimate**).

**Import cost.** Parsing a 100–150 MB mmCIF on device is about 0.5–2 s, plus a 1–3 s bake (bond perception with a spatial hash, Morton sort, clusters, exterior flood fill, AO) (**estimates**). Do this once and cache. For gallery colossi, bake at web build time; the build already writes OG cards, ink drawings and desk models.

### Memory

- Resident per colossus is about **30–60 MB**: pack, GPU working sets, a Hi-Z pyramid of about 3–13 MB, and an R32Uint ID target of about 12.6 MB at 2622×1206 (**estimate**).
- Apple publishes no per-device limits. "This limit varies by device model" ([Metal memory doc](https://developer.apple.com/documentation/metal/reducing-the-memory-footprint-of-metal-apps)); use `os_proc_available_memory` ([doc](https://developer.apple.com/documentation/os/os_proc_available_memory)) and jetsam reports ([doc](https://developer.apple.com/documentation/xcode/identifying-high-memory-use-with-jetsam-event-reports)).
- The `increased-memory-limit` entitlement is iOS 15+ and only on some devices ([doc](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.kernel.increased-memory-limit)). One developer measured about **6 GB per process** on a 12 GB iPhone 17 Pro Max even with it, and noted iPads expose more ([forum 834805](https://developer.apple.com/forums/thread/834805); not Apple-confirmed).
- We are one to two orders of magnitude under that. Keep one colossus at full detail and the rest at L3.

### Thermals

- Sustained AR (camera, tracking, LiDAR, rendering) is the real limit. Observe `ProcessInfo.thermalState` ([doc](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum)). Apple's WWDC26 RealityKit session recommends exactly this: at `.serious` or `.critical`, use "more aggressive LOD switching" and "lower shadow quality" ([WWDC26 279](https://developer.apple.com/videos/play/wwdc2026/279/)).
- Policy:
  - `fair`: unchanged.
  - `serious`: LOD bias +1, molecule pass at 0.75× with MetalFX spatial upscaling, bonds only at L0 within 30 cm, contact AO off.
  - `critical`: also a 30 fps ARKit video format (`ARConfiguration.VideoFormat.framesPerSecond`, [doc](https://developer.apple.com/documentation/arkit/arconfiguration/videoformat-swift.class)), with physics and display motion paused.
- The iPhone 17 Pro and 18 Pro vapor chambers claim up to 40 % better sustained performance ([17 Pro](https://www.apple.com/newsroom/2025/09/apple-unveils-iphone-17-pro-and-iphone-17-pro-max/), [18 Pro](https://www.apple.com/newsroom/2026/09/apple-debuts-iphone-18-pro-and-iphone-18-pro-max/)).

---

## 6. Interaction at a million atoms (question 4)

| Layer | Physical or visual | Mechanism | Budget (**estimate**) |
|---|---|---|---|
| Whole structure: grab, throw, land on a real shelf | Physical | One `PhysicsBodyComponent` with a compound collision of ≤64–256 spheres from the cluster hierarchy; real mass and inertia from atomic masses, scaled to toy units; collides with the LiDAR scene mesh (`SpatialTrackingSession` `.collision/.physics`, iOS 18) | <0.2 ms |
| Chunks: capsid subunits, chains, domains, crystal grains | Physical | One body per chunk (60–180 for a capsid) plus `PhysicsJoint` (fixed or spherical, iOS 18); "breakable" means our code removes a joint when relative impulse or separation crosses a threshold scaled from interface chemistry (covalent ≫ coordination > ionic contact > H-bond; Lupi's molecular.v1 bond kinds) | ≤200 bodies, about 0.5–1 ms CPU (**UNCONFIRMED**) |
| Rigid vs flexible personality | Derived from data | Rigidity analysis of the bond graph (FIRST pebble game: [Jacobs et al. 2001](https://doi.org/10.1002/prot.1081)) yields rigid clusters and hinges, which become bodies and joints | Offline bake |
| Flexible: stretch, wobble, breathe | Physical-ish | Elastic-network normal modes on coarse beads ([Atilgan et al. 2001](https://doi.org/10.1016/S0006-3495(01)76033-X)); project the user's drag onto 10–20 modes; GPU-skin atoms to 1–4 beads. Sheets (graphene, membranes) can use `ClothBodyComponent` (iOS 27) with target shapes as the rest pose. Coarse-graining at about 4 heavy atoms per bead follows Martini ([Souza et al. 2021](https://doi.org/10.1038/s41592-021-01098-3)) | Skinning 1M atoms <0.5 ms GPU |
| Poke, Tug, Burst, Heat, Scatter | Visual only | Port Lupi's `/home/user/Lupi/packages/scene/src/tsl/displayMotion.ts` and its CPU twin to Metal compute, applied to atoms in touched clusters only; keep the "Illustrative" labelling | <0.3 ms |
| True interactive dynamics | Out of scope at 1M | Interactive MD in VR has been run server-side ([O'Connor et al. 2018](https://doi.org/10.1126/sciadv.aat2731)); on device only for small molecules | — |

**Picking:**

- **Synchronous, at gesture start.** A CPU BVH over the 15.6k cluster AABBs, then ray-sphere tests on that cluster's 64 atoms, adjusted by the display-motion twin. About 16 levels plus at most a few hundred sphere tests: tens of µs (**estimate**). It returns an answer in the same frame, which grab and throw need.
- **Hover, selection, fat-finger.** An R32Uint ID attachment written by impostors and the visibility-buffer resolve; blit a 9×9 window to a shared buffer, available 1–2 frames later.
- **RealityKit proxies.** Compound collision with `shapeIndex` gives the chunk ([doc](https://developer.apple.com/documentation/realitykit/collisioncasthit)).

**Grab and throw on iOS.** `ManipulationComponent` is visionOS only. Use `GestureComponent` (iOS 26): kinematic while held, release velocity from the last 80–120 ms of hand pose in world space, then dynamic.

---

## 7. Frame budget at 60 fps (16.7 ms)

All numbers are **estimates** to validate in spike S2. Scene: one 1M-atom colossus on a shelf at 0.5–1.5 m, plus a few small trophies, on an A17 Pro-class iPhone at 2622×1206.

| Stage | Unit | GPU ms |
|---|---|---|
| Camera background, RealityKit scene (shelf, small trophies, occlusion mesh, grounding shadows) | RealityKit | 3.0–4.5 (**UNCONFIRMED**) |
| Cluster cull (15.6k clusters: frustum, cone, exterior, Hi-Z, tier) + compaction | compute | 0.2–0.4 |
| L0 impostors (≤150k atoms, mesh shader or indirect instanced, `depth(greater)`) | render | 2.0–3.0 |
| L0 bonds (≤50k cylinder impostors, near field) | render | 0.5–1.0 |
| L1 and L2 compute raster + resolve, L3 splats | compute | 0.3–0.6 |
| Hi-Z build | compute | 0.2 |
| Contact shadow, edge cue, analytic edge AA, composite into the RealityKit target | render | 0.6–1.0 |
| ID-window readback | blit | <0.05 |
| **Total** | | **about 7–10.5 ms, leaving 35–55 % thermal headroom** |

CPU side:

- ARKit, RealityKit and SwiftUI: about 3–6 ms (**UNCONFIRMED**).
- Our encode: under 0.5 ms and O(1) in atom count; no per-cluster CPU work.
- Physics: ≤1 ms for ≤200 bodies.

The M5 iPad Pro 13" draws about 1.8× the pixels (5.7 MP) on a 10-core GPU with >150 GB/s; expect a similar budget. Target 60 fps even on the 120 Hz panel, because the camera feed sets the cadence.

---

## 8. Recommended architecture

```
SwiftUI app (or Expo native module hosting a SwiftUI view)
└─ RealityView (iOS/iPadOS 26+)
   ├─ SpatialTrackingSession.run(config, session: ownARSession, arConfiguration:)   // iOS 18; we own ARSession → ARWorldMap
   │    sceneUnderstanding: [.occlusion, .collision, .physics, .shadow]           // LiDAR devices
   ├─ World layer (RealityKit): shelf anchors, trophies ≤ ~5k atoms as native entities
   │    (MeshInstancesComponent spheres + bond cylinders, LevelOfDetailComponent on 27),
   │    physics bodies, joints, GroundingShadow, GestureComponent
   ├─ Colossus proxies (RealityKit): per-chunk PhysicsBody + compound sphere collision, no visible mesh
   └─ renderingEffects.customPostProcessing = LupiMoleculeEngine                    // iOS 26
        per frame, on the RealityKit command buffer:
        1 read chunk transforms (from proxies) + camera pose + projection
        2 compute: cluster cull → per-tier compacted lists → indirect args
        3 render: depth = copy(sourceDepthTexture); L0 impostors + bonds (mesh shaders, depth(greater)), ID target
        4 compute: L1/L2 64-bit visibility raster (Apple9+) → resolve into color/depth/ID
        5 contact shadow on the anchor plane, edge cue, AA → targetColorTexture
        6 Hi-Z from final depth (next frame); ID window → shared buffer
Data: LupiPack (server-baked for gallery, device-baked + cached for user imports), mmap + bytesNoCopy / MTLIO
Fallback renderer: LowLevelMesh impostor discs + CustomMaterial (no depth) for pre-26 or if S1 fails
```

Other choices:

- **Tiers by atom count:**
  - ≤5k: native RealityKit.
  - 5k–200k: Metal engine, L0 plus cluster culling.
  - 200k–1M+: full pipeline including L1–L3 and the exterior bake.
  - Procedural crystals of any size: index-derived positions.
- **Apple7/8 devices (A14–A16).** No 64-bit atomics on iOS, so L1 uses point sprites or cluster splats instead of compute raster. Mesh shaders still work.
- **Shader parity with the web.** Port Lupi's TSL impostor maths, palettes and looks (Ink, Remix, Foil) to MSL once, behind one parameter block, so AR and web read the same.

---

## 9. Spikes before committing (with acceptance criteria)

- **S1, post-process composition (the biggest risk).**
  - In iOS 26 RealityView `customPostProcessing`, establish `sourceDepthTexture`'s format, reverse-Z or not, MSAA, and whether it contains the scene-understanding occlusion mesh and people occlusion.
  - Get a camera pose for the frame being post-processed: only `projection` is provided.
  - Pass if a Metal-drawn cube and a RealityKit cube at the same pose stay within 1 px during fast pans, and a real object occludes the molecule.
  - Repeat with `ARView.renderCallbacks.postProcess` on iOS 15+ for comparison.
- **S2, 1M-atom throughput.**
  - Procedural 1M copper plus one real mmCIF capsid on the owner's iPhone and iPad.
  - Measure per-stage GPU ms with Metal counters and Instruments ([WWDC26 388](https://developer.apple.com/videos/play/wwdc2026/388/)).
  - Pass at ≤8 ms molecule GPU, 60 fps sustained for 10 minutes with thermal state ≤ `fair`.
  - Also measure `depth(greater)` vs `depth(any)`, and points vs quads.
- **S3, RealityKit-only fallback.** `LowLevelMesh` plus `CustomMaterial` billboards fed by compute at 150k quads: cost, look, and the 1-frame-late count plumbing.
- **S4, physics.** 60–180 chunk bodies with joints, thrown onto the LiDAR scene mesh, joint breaking. Measure CPU ms and stability.
- **S5 (optional, iOS 27).** `GaussianSplatComponent` with 1M isotropic, degree-0 splats: cost and look as a "haze" far tier.

---

## 10. Questions for the owner (they change the design)

1. **Which exact iPhone and iPad?** This decides Apple9 vs Apple10 features, LiDAR (scene-mesh occlusion and physics) and RAM.
2. **What are the million-atom showpieces?** PDB assemblies (mmCIF only), MD snapshots, procedural crystals? Hydrogens shown? Bonds required at that scale?
3. **What does "play" mean at 1M?** Throw the whole thing, shatter into subunits, or zoom in and tug locally? Pick one hero interaction for v1.
4. **Scale.** A desk-trophy size (25 cm), or also a walk-in scale (1 Å = 1 cm makes a 2.5 m virus)? Walk-in changes the LOD regime: huge near-field atom counts.
5. **Is requiring iOS 26 acceptable?** And is iOS 27 acceptable for cloth and splats?
6. **App shape.** Keep the Expo/React Native shell with a Swift native module hosting RealityView, or a new SwiftUI target? The current Viro path cannot carry this.
7. **Server-side baking of gallery colossi into LupiPack**, alongside the existing web-build bakes: OK?
8. **Must the Lupi looks (Ink, Remix codes, Foil, Instant Replay) exist in AR v1**, or after?

---

## 11. UNCONFIRMED items (verify, do not assume)

- iPhone RAM per model and A-series memory bandwidth.
- The A20 Pro GPU family.
- Default (non-entitlement) memory limits.
- Whether RealityKit's post-process depth includes scene-understanding occlusion and people occlusion; its format and convention.
- How to get a frame-synchronous camera pose inside `PostProcessEffect`.
- RealityKit's own GPU and CPU cost in AR.
- RealityKit physics body and joint counts at 60 fps, and whether joints report forces.
- `GaussianSplatComponent` cost on iPhone.
- Whether `depth(greater)` helps hidden-surface removal on Apple GPUs.
- Mesh-shader 256-vertex / 512-primitive maxima (third-party source).
- LiDAR depth-map resolution (256×192 commonly reported).
- Display field of view in portrait AR.
- Whether RealityView applies ARKit environment texturing automatically.
- All timing numbers marked as estimates.

---

## Sources

Apple documentation:
- RealityKit: [LowLevelMesh](https://developer.apple.com/documentation/realitykit/lowlevelmesh) · [LowLevelTexture](https://developer.apple.com/documentation/realitykit/lowleveltexture) · [MeshInstancesComponent](https://developer.apple.com/documentation/realitykit/meshinstancescomponent) · [LowLevelInstanceData](https://developer.apple.com/documentation/realitykit/lowlevelinstancedata) · [LowLevelBuffer](https://developer.apple.com/documentation/realitykit/lowlevelbuffer) · [RealityViewPostProcessEffect](https://developer.apple.com/documentation/realitykit/realityviewpostprocesseffect) · [PostProcessEffect](https://developer.apple.com/documentation/realitykit/postprocesseffect) · [PostProcessEffectContext](https://developer.apple.com/documentation/realitykit/postprocesseffectcontext) · [ARView.PostProcessContext](https://developer.apple.com/documentation/realitykit/arview/postprocesscontext) · [ARView](https://developer.apple.com/documentation/realitykit/arview) · [CustomMaterial](https://developer.apple.com/documentation/realitykit/custommaterial) · [Custom materials article](https://developer.apple.com/documentation/realitykit/modifying-realitykit-rendering-using-custom-materials) · [Metal-RealityKit APIs PDF](https://developer.apple.com/metal/Metal-RealityKit-APIs.pdf) · [RealityRenderer](https://developer.apple.com/documentation/realitykit/realityrenderer) · [RealityViewCameraContent](https://developer.apple.com/documentation/realitykit/realityviewcameracontent) · [RealityViewRenderingEffects](https://developer.apple.com/documentation/realitykit/realityviewrenderingeffects) · [SpatialTrackingSession](https://developer.apple.com/documentation/realitykit/spatialtrackingsession) · [run(_:session:arConfiguration:)](https://developer.apple.com/documentation/realitykit/spatialtrackingsession/run(_:session:arconfiguration:)) · [SceneUnderstandingCapability](https://developer.apple.com/documentation/realitykit/spatialtrackingsession/configuration/sceneunderstandingcapability) · [ARView scene understanding options](https://developer.apple.com/documentation/realitykit/arview/environment-swift.struct/sceneunderstanding-swift.struct/options-swift.struct) · [PhysicsBodyComponent](https://developer.apple.com/documentation/realitykit/physicsbodycomponent) · [PhysicsJoint](https://developer.apple.com/documentation/realitykit/physicsjoint) · [PhysicsSimulationComponent](https://developer.apple.com/documentation/realitykit/physicssimulationcomponent) · [ForceEffect](https://developer.apple.com/documentation/realitykit/forceeffect) · [ClothBodyComponent](https://developer.apple.com/documentation/realitykit/clothbodycomponent) · [LevelOfDetailComponent](https://developer.apple.com/documentation/realitykit/levelofdetailcomponent) · [GaussianSplatComponent](https://developer.apple.com/documentation/realitykit/gaussiansplatcomponent) · [GroundingShadowComponent](https://developer.apple.com/documentation/realitykit/groundingshadowcomponent) · [GestureComponent](https://developer.apple.com/documentation/realitykit/gesturecomponent) · [ManipulationComponent](https://developer.apple.com/documentation/realitykit/manipulationcomponent) · [EnvironmentBlendingComponent](https://developer.apple.com/documentation/realitykit/environmentblendingcomponent) · [ARKitAnchorComponent](https://developer.apple.com/documentation/realitykit/arkitanchorcomponent) · [CollisionCastHit](https://developer.apple.com/documentation/realitykit/collisioncasthit) · [RealityKit updates](https://developer.apple.com/documentation/updates/realitykit)
- ARKit: [ARWorldMap](https://developer.apple.com/documentation/arkit/arworldmap) · [Saving and loading world data](https://developer.apple.com/documentation/arkit/saving-and-loading-world-data) · [sceneDepth](https://developer.apple.com/documentation/arkit/arframe/scenedepth) · [sceneReconstruction](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/scenereconstruction) · [AREnvironmentProbeAnchor](https://developer.apple.com/documentation/arkit/arenvironmentprobeanchor) · [VideoFormat](https://developer.apple.com/documentation/arkit/arconfiguration/videoformat-swift.class) · [AR with Metal sample](https://developer.apple.com/documentation/arkit/displaying-an-ar-experience-with-metal) · [People occlusion in custom renderers](https://developer.apple.com/documentation/arkit/effecting-people-occlusion-in-custom-renderers) · [Fog with scene depth](https://developer.apple.com/documentation/arkit/creating-a-fog-effect-using-scene-depth) · [Point cloud with scene depth](https://developer.apple.com/documentation/arkit/displaying-a-point-cloud-using-scene-depth)
- Metal: [Metal Feature Set Tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf) · [MSL 4.1 spec](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf) · [Mesh-shader LOD sample](https://developer.apple.com/documentation/metal/adjusting-the-level-of-detail-using-metal-mesh-shaders) · [GPU-encoded ICB sample](https://developer.apple.com/documentation/metal/encoding-indirect-command-buffers-on-the-gpu) · [MetalFX](https://developer.apple.com/documentation/metalfx) · [MTLFXFrameInterpolator](https://developer.apple.com/documentation/metalfx/mtlfxframeinterpolator) · [MTLIOCommandQueue](https://developer.apple.com/documentation/metal/mtliocommandqueue) · [MTLIOCompressionMethod](https://developer.apple.com/documentation/metal/mtliocompressionmethod) · [makeBuffer(bytesNoCopy:)](https://developer.apple.com/documentation/metal/mtldevice/makebuffer(bytesnocopy:length:options:deallocator:)) · [Bounding-box acceleration structures](https://developer.apple.com/documentation/metal/mtlaccelerationstructureboundingboxgeometrydescriptor) · [Reducing Metal memory footprint](https://developer.apple.com/documentation/metal/reducing-the-memory-footprint-of-metal-apps)
- System: [increased-memory-limit](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.kernel.increased-memory-limit) · [os_proc_available_memory](https://developer.apple.com/documentation/os/os_proc_available_memory) · [Jetsam reports](https://developer.apple.com/documentation/xcode/identifying-high-memory-use-with-jetsam-event-reports) · [ThermalState](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum) · [Developer forum 834805](https://developer.apple.com/forums/thread/834805)

WWDC sessions:
[WWDC26 279 Explore advances in RealityKit](https://developer.apple.com/videos/play/wwdc2026/279/) · [WWDC26 388 Find and fix performance issues in your Metal games](https://developer.apple.com/videos/play/wwdc2026/388/) · [WWDC26 359 Build real-time neural rendering pipelines with Metal](https://developer.apple.com/videos/play/wwdc2026/359/) · [WWDC25 287 What's new in RealityKit](https://developer.apple.com/videos/play/wwdc2025/287/) · [WWDC25 205 Discover Metal 4](https://developer.apple.com/videos/play/wwdc2025/205/) · [WWDC24 10104 Build a spatial drawing app with RealityKit](https://developer.apple.com/videos/play/wwdc2024/10104/) · [WWDC24 10103 Discover RealityKit APIs for iOS, macOS and visionOS](https://developer.apple.com/videos/play/wwdc2024/10103/) · [WWDC22 10162 Transform your geometry with Metal mesh shaders](https://developer.apple.com/videos/play/wwdc2022/10162/) · [WWDC21 10075 Explore advanced rendering with RealityKit 2](https://developer.apple.com/videos/play/wwdc2021/10075/) · [WWDC20 10602 Harness Apple GPUs with Metal](https://developer.apple.com/videos/play/wwdc2020/10602/) · [WWDC20 10611 Explore ARKit 4](https://developer.apple.com/videos/play/wwdc2020/10611/) · [WWDC26 visionOS 27 guide](https://developer.apple.com/wwdc26/guides/visionos/)

Devices:
[iPhone 15 Pro newsroom](https://www.apple.com/newsroom/2023/09/apple-unveils-iphone-15-pro-and-iphone-15-pro-max/) · [iPhone 17 Pro newsroom](https://www.apple.com/newsroom/2025/09/apple-unveils-iphone-17-pro-and-iphone-17-pro-max/) · [iPhone 18 Pro newsroom](https://www.apple.com/newsroom/2026/09/apple-debuts-iphone-18-pro-and-iphone-18-pro-max/) · [iPhone 18 Pro specs](https://www.apple.com/iphone-18-pro/specs/) · [iPad Pro M5 newsroom](https://www.apple.com/newsroom/2025/10/apple-introduces-the-powerful-new-ipad-pro-with-the-m5-chip/) · [iPad Pro specs](https://www.apple.com/ipad-pro/specs/)

Papers and tools:
[QuteMol, Tarini 2006](https://doi.org/10.1109/TVCG.2006.115) · [Grottel 2010](https://doi.org/10.1111/j.1467-8659.2009.01698.x) · [Lindow 2012](https://doi.org/10.1111/j.1467-8659.2012.03128.x) · [Falk 2013](https://doi.org/10.1111/cgf.12197) · [cellVIEW 2015](https://doi.org/10.2312/vcbm.20151209) · [HyperBalls, Chavent 2011](https://doi.org/10.1002/jcc.21861) · [Mol* 2021](https://doi.org/10.1093/nar/gkab314) · [Mesoscale Explorer 2024](https://doi.org/10.1002/pro.5177) · [VTX 2025](https://doi.org/10.3389/fbinf.2025.1588661) · [Schütz 2022](https://doi.org/10.1145/3543863) · [Mobile-GS 2026](https://arxiv.org/abs/2603.11531) · [BinaryCIF 2020](https://doi.org/10.1371/journal.pcbi.1008247) · [PDBj large structures](https://pdbj.org/help/large-structures?lang=en) · [ChimeraX VR docs](https://www.cgl.ucsf.edu/chimerax/docs/user/vr.html) · [Goddard 2018 Holodeck](https://doi.org/10.1016/j.jmb.2018.06.040) · [iMD-VR, O'Connor 2018](https://doi.org/10.1126/sciadv.aat2731) · [STMV MD, Freddolino 2006](https://doi.org/10.1016/j.str.2005.11.014) · [FIRST rigidity, Jacobs 2001](https://doi.org/10.1002/prot.1081) · [ANM, Atilgan 2001](https://doi.org/10.1016/S0006-3495(01)76033-X) · [Martini 3, Souza 2021](https://doi.org/10.1038/s41592-021-01098-3) · [GPU-driven pipelines, Haar and Aaltonen 2015](https://advances.realtimerendering.com/s2015/aaltonenhaar_siggraph2015_combined_final_footer_220dpi.pdf) · [Nanite course, SIGGRAPH 2021](https://advances.realtimerendering.com/s2021/index.html) · [Linebender mesh-shader notes](https://linebender.org/wiki/gpu/mesh-shaders/) · [Jolt Physics](https://github.com/jrouwe/JoltPhysics)

Repo files referenced:
- /home/user/Lupi/packages/scene/src/AtomsOptimized.tsx
- /home/user/Lupi/packages/scene/src/BillionAtomBlock.tsx
- /home/user/Lupi/packages/scene/src/atomOcclusion.ts
- /home/user/Lupi/packages/scene/src/atomContactOcclusion.ts
- /home/user/Lupi/packages/scene/src/tsl/displayMotion.ts
- /home/user/Lupi/apps/mobile/src/features/ar/molecule-ar-surface.native.tsx
- /home/user/Lupi/apps/mobile/package.json