# Molecule physics for native iPhone/iPad AR: playful and true to nature

Scope: this covers only the physics layer for the native AR trophy case: grab, throw, stretch, break, heat, and molecules from H₂ to million-atom structures. Persistence, anchoring and rendering are separate work. Every external claim has a URL. Anything I could not confirm is marked **UNCONFIRMED**. Numbers I worked out myself are marked **computed**, with their inputs.

---

## 0. Bottom line

1. **"True to nature" cannot mean true trajectories.** Real bond vibrations take 8–38 fs and molecules tumble every 0.2–30 ps at 300 K (computed, §4.6). Any motion a person can see in AR is slowed 10¹¹–10¹³×. What we can make true:
   - **the parameters**: mass, inertia tensor, bond energies, stiffness ratios, torsion barriers, normal modes;
   - **the ordering**: which bond snaps first, which molecule is floppiest, which tumbles end over end;
   - **the labels**, which state the time and amplitude scaling honestly.
2. **Compute the chemistry off the device and run cheap physics on it.** Build a per-molecule "physics card" at build time or on the edge, from OMol25-trained ML potentials (UMA, OrbMol, AIMNet2) or GFN-FF. The card holds the Hessian and normal modes, Morse bond parameters, torsion barriers, rigid clusters, strain, mass and inertia. The phone runs one XPBD solver driven by the card.
3. **Morse bonds fit XPBD exactly** (my derivation, §5.2). Use the constraint C = 1 − e^(−a(r−rₑ)) with compliance α = 1/(2Dₑ); its energy is exactly Dₑ(1−e^(−a(r−rₑ)))². The bond breaks when C > ½, which is past the inflection point where the force peaks. Set one calibrated strength scale so the ratios stay real: C–C snaps at about 5 nN-equivalent, O–O at about 3, N≡N at about 21 (computed).
4. **Throws use the true inertia tensor.** Lupi's web `trueSpinCoast.ts` already integrates the torque-free Euler equations and reproduces the Dzhanibekov flip, so it can be ported. RealityKit's `PhysicsMassProperties` takes principal moments plus a principal-axis orientation (iOS 13+).
5. **On-device ML potentials are not on the critical path.** I found no published benchmark of an ML potential running on an iPhone, so on-device feasibility is UNCONFIRMED. The licences differ, and running a potential on the phone gains little because of the time-scale problem. Use the potentials on the server for the card and for optional "verdict" calls. Spike on-device OrbMol (Apache-2.0) or AIMNet2 (MIT) through Core AI or MLX later.
6. **RealityKit gives you the macro "desk model" layer**: rigid body, gravity, collisions with planes or the LiDAR mesh. Its joints only have hard limits; no stiffness, compliance or break force is documented. So the molecular internals must be a custom ECS `System`. iOS 27's cloth simulation works on triangle meshes only, not bond graphs.
7. **Million atoms is feasible if no atom is simulated individually.** Combine one rigid body, K ≈ 10–20 precomputed low-frequency modes (ANM or RTB elastic network models), and a local XPBD "focus window" under the finger, with linear response everywhere else.
8. **Extend Lupi's existing honesty labels into a four-step ladder:** Illustrative (today's toys) → Chemistry-tuned (card-driven, time scaled) → Simulated (named method and units) → Verdict (one edge model call). Snapshots and exports keep the rest pose, as the web capture guard does today.

---

## 1. What Lupi already has to reuse

| Asset | Where | Use in AR physics |
|---|---|---|
| `lupi.object-facts.v1`: centre of mass, principal `moments`, `axes`, `principalQuat`, rotor type, rings, symmetry axes, detents | `/home/user/Lupi/packages/core/src/objectFacts/types.ts` | Mass properties for RealityKit; rigidity hints from rings; symmetry detents |
| `trueSpinCoast.ts`: torque-free Euler equations (RK4, 1/240 s substep), Dzhanibekov flip detection, inertia floor at 0.02·I_max for linear rotors | `/home/user/Lupi/packages/ui/src/camera/trueSpinCoast.ts` | In-flight tumble after a throw; port as is |
| Display-only motion with the capture guard (weights zeroed in every capture; ripple bounded to 0.3 Å) | `/home/user/Lupi/packages/scene/src/tsl/displayMotion.ts` | The rule that snapshots and exports show the rest pose |
| Honesty labels "Illustrative · Reset", "Illustrative motion, your atoms haven't moved"; Heat tooltip "Illustrative heat … Not a simulation."; thermometer reads 300 K at rest | `/home/user/Lupi/packages/ui/src/play/PlayPill.tsx` | Bottom step of the honesty ladder (§6) |
| `lupi-bonds.molecular.v1` (inferred bonds, coordination dashed, ionic contacts dotted) | `/home/user/Lupi/docs/omol25-bonds-and-discovery.md` | The bond graph the card is built on |
| `lupi-bond-orders.v1`: specified (phase B, opt-in) but **no code references found** | same doc §2.6 | **Dependency.** BDE by bond order, rotatable-bond detection and amide or double-bond locking all need it |
| Instant Replay tape: inputs plus 0.5 s camera keyframes | `packages/ui/src/replay` | The replay model for AR (§5.7) |

---

## 2. Apple platform facts, with versions

The SDK-to-Xcode pairing (Xcode 16 → iOS 18, Xcode 26 → iOS 26, Xcode 27 → iOS 27) follows Apple's versioning, but I did not re-verify it here. WWDC26 has a "What's new in Xcode 27" session ([WWDC26 index](https://developer.apple.com/wwdc/2026/)).

| API | What it gives the physics layer | Availability | Source |
|---|---|---|---|
| `PhysicsBodyComponent`, `PhysicsMotionComponent` | Rigid body with damping, CCD, gravity flag. Dynamic bodies overwrite velocities you write, so apply impulses instead | iOS 13.0 | [body](https://developer.apple.com/documentation/realitykit/physicsbodycomponent), [motion](https://developer.apple.com/documentation/realitykit/physicsmotioncomponent) |
| `PhysicsMassProperties(mass:inertia:centerOfMass:(position, orientation))` | Principal moments plus "orientation of the principal axes" | iOS 13.0 | [doc](https://developer.apple.com/documentation/realitykit/physicsmassproperties) |
| `System` (ECS `update(context:)`) | Custom per-frame simulation in dependency order | iOS 15.0 | [doc](https://developer.apple.com/documentation/realitykit/system) |
| `PhysicsJointsComponent`, plus Fixed, Spherical, Revolute, Prismatic, Distance and Custom joints | Hard motion limits per degree of freedom. **No stiffness, compliance or break force documented** | iOS 18.0 | [joints](https://developer.apple.com/documentation/realitykit/physics-joints-and-pins), [custom](https://developer.apple.com/documentation/realitykit/physicscustomjoint), [WWDC24 10103](https://developer.apple.com/videos/play/wwdc2024/10103/) |
| `ForceEffect` / `ForceEffectProtocol` | Custom force fields applied to bodies | iOS 18.0 | [doc](https://developer.apple.com/documentation/realitykit/forceeffect) |
| `PhysicsSimulationComponent` | Gravity, `solverIterations`, `clock`. A fixed-timestep setting is not documented (UNCONFIRMED) | iOS 18.0 | [doc](https://developer.apple.com/documentation/realitykit/physicssimulationcomponent) |
| `LowLevelMesh` | Vertex buffers updated from Swift or from Metal compute | iOS 18.0 | [doc](https://developer.apple.com/documentation/realitykit/lowlevelmesh) |
| `MTLCompileOptions.mathMode` | Choice of safe, relaxed or fast floating point; matters for determinism | iOS 18.0 | [doc](https://developer.apple.com/documentation/metal/mtlcompileoptions/mathmode) |
| `MeshInstancesComponent` and `LowLevelInstanceData` | GPU instancing with per-instance transforms | iOS 26.0 | [doc](https://developer.apple.com/documentation/realitykit/meshinstancescomponent) |
| Metal tensors / TensorOps | int4 and int8 types in iOS 26; fp8, fp4 and MX formats in iOS 27; custom ML kernels in MSL | iOS 26 / 27 | [WWDC26 330](https://developer.apple.com/videos/play/wwdc2026/330/) |
| `ClothSimulationComponent`, `ClothBodyComponent`, `ClothMeshResource` | Particles joined by springs, kinematic pins, target shapes, inflation constraint, external forces in newtons. **Triangle meshes only.** The docs advise throttling on `thermalState` | iOS 27.0 | [sim](https://developer.apple.com/documentation/realitykit/clothsimulationcomponent), [body](https://developer.apple.com/documentation/realitykit/clothbodycomponent), [mesh](https://developer.apple.com/documentation/realitykit/clothmeshresource), [WWDC26 279](https://developer.apple.com/videos/play/wwdc2026/279/) |
| `ManipulationComponent` (grab, throw, hand-off) | **visionOS 26 only; not on iOS** | visionOS 26 | [doc](https://developer.apple.com/documentation/realitykit/manipulationcomponent) |
| LiDAR scene reconstruction, `sceneUnderstanding` `.physics` | Real-world mesh for collisions on LiDAR devices | iOS 13.4 | [ARKit](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/scenereconstruction), [RealityKit](https://developer.apple.com/documentation/realitykit/arview/environment-swift.struct/sceneunderstanding-swift.struct/options-swift.struct/physics) |
| Core AI | "the inference framework powering on-device Apple Intelligence". PyTorch conversion via `coreai-torch`, dynamic shapes, custom Metal kernels, runs on CPU, GPU and Neural Engine. **Minimum OS UNCONFIRMED** (the doc page did not render) | WWDC26 | [WWDC26 324](https://developer.apple.com/videos/play/wwdc2026/324/) |
| Core ML on the Neural Engine | `EnumeratedShapes` for best performance; range shapes need `ReshapeFrequency.Infrequent` (iOS 17.4+) to reach the Neural Engine. The Neural Engine prefers 4D channel-first tensors and 64-byte-aligned buffers | iOS 17.4 | [coremltools](https://apple.github.io/coremltools/docs-guides/source/flexible-inputs.html), [Apple ML research](https://machinelearning.apple.com/research/neural-engine-transformers) |
| MLX Swift | iOS 17+, MIT licence | iOS 17 | [Package.swift](https://raw.githubusercontent.com/ml-explore/mlx-swift/main/Package.swift), [LICENSE](https://raw.githubusercontent.com/ml-explore/mlx-swift/main/LICENSE) |
| A19 Pro (iPhone 17 Pro) and M5 (iPad Pro) | Neural Accelerators in every GPU core | hardware | [Apple newsroom](https://www.apple.com/newsroom/2025/09/apple-unveils-iphone-17-pro-and-iphone-17-pro-max/), [M5](https://www.allaboutcircuits.com/news/apple-looks-to-the-future-of-ai-with-new-m5-processor/) |

Three things about RealityKit I could not confirm:
- whether its rigid-body solver includes gyroscopic terms, which the Dzhanibekov flip needs;
- whether it is deterministic;
- which engine it is built on.

---

## 3. Question 1: the options and what they cost

### 3a. Toy mechanics with personalities derived from chemistry

- **Model:** each molecule is split into rigid clusters (ring systems, amide planes, groups locked by double or triple bonds). The clusters are joined by torsion hinges at rotatable bonds, which click between conformer minima. Bonds are Morse springs with a break threshold.
- **Cost:** microseconds per step for 300 atoms on the CPU.
- **Truth:** fully illustrative unless the parameters come from data. Driven by a physics card it becomes "Chemistry-tuned" (§6).
- **Prior art for the rigid-cluster idea:** FIRST, the pebble-game rigidity analysis (Jacobs, Rader, Kuhn, Thorpe 2001, *Proteins* 44:150; used in [Gohlke et al. 2004](https://bmb.natsci.msu.edu/_assets/files/labs/kuhn-lab/Gohlke_etal_Proteins04.pdf)).

### 3b. A classical force field on the device

| Engine | Licence | Language and iOS path | Can bonds break? | Notes |
|---|---|---|---|---|
| RDKit UFF and MMFF94/94s | BSD-3 ([licence](https://github.com/rdkit/rdkit/blob/master/license.txt)) | C++ with Boost. No official iOS build found (effort UNCONFIRMED) | No: fixed topology, harmonic bonds | UFF: [Rappé 1992, *JACS* 114:10024](https://researchportal.ip-paris.fr/en/publications/uff-a-full-periodic-table-force-field-for-molecular-mechanics-and/). MMFF94: Halgren 1996, *J Comput Chem* 17:490 ([Open Babel note](https://openbabel.org/docs/Forcefields/mmff94.html)) |
| Open Babel force fields | GPL-2 | C++ | No | GPL conflicts with App Store terms; VLC was pulled in 2011 ([Computerworld](https://www.computerworld.com/article/1347653/gplv2-blocks-vlc-from-apple-s-app-store.html)). **Avoid** |
| OpenMM | "MIT or LGPL" by component ([repo](https://github.com/openmm/openmm)) | C++. Its GPU platforms are not available on iOS (UNCONFIRMED); the CPU platform may build | Only with custom forces | Philip Turner's MM4 (Swift, MIT) runs on it but covers only H, C, Si, P, S and Ge ([MM4](https://github.com/philipturner/MM4)) |
| GFN-FF (in xtb) | LGPL-3.0 / GPL-3.0 ([xtb](https://github.com/grimme-lab/xtb)) | Fortran with a C API. A standalone Fortran/C library exists ([pprcht/gfnff](https://github.com/pprcht/gfnff)); its licence is UNCONFIRMED. A Fortran toolchain for iOS is UNCONFIRMED. LGPL inside the App Store needs legal review | No: topology is derived from the input geometry | "Quadratic scaling … not much slower than established force fields"; covers elements up to radon ([Spicher & Grimme 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7267649/)). **Good offline card generator** |
| Our own Swift/Metal kernel (harmonic + Morse + torsions from the card) | Ours | Swift SIMD / Metal | Yes (Morse) | Parameters come from the card |

- **Speed (ESTIMATE):** 1,000 atoms means about 5×10⁵ non-bonded pairs, roughly 1 ms per force evaluation on one performance core. 50 atoms takes microseconds.
- **The real limit is visible time.** 1,000 steps of 0.5 fs per frame is 0.5 ps per frame. That shows vibrations, but conformational change on the ps–ns scale stays mostly out of reach in real-time units.
- **Every standard force field keeps its topology fixed.** "Breakable" needs Morse (ours), a reactive force field, or an ML potential.

### 3c. Machine-learned potentials trained on OMol25

OMol25 itself: more than 140 million ωB97M-V/def2-TZVPD calculations, 2–350 atoms per system, the first 83 elements, charge −10 to +10, spin multiplicity 1–11, CC BY 4.0. Its baselines include eSEN-sm at 6.3M parameters and eSEN-md at 50.7M ([OMol25 paper](https://arxiv.org/html/2505.08762)).

| Model | Size | Licence | Published speed | Fit for Lupi |
|---|---|---|---|---|
| UMA-S 1.1 / 1.2 | 150M total, ~6M active. Mixture-of-linear-experts weights "precomputed before running simulations" for a fixed composition, giving a dense model. Checkpoints 1.17 GB (1.1) and 2.33 GB (1.2) | FAIR Chemistry License v1: commercial use allowed, gated, Acceptable Use Policy (bans e.g. "illegal drugs" and weapons uses), not available in China, Russia or Belarus ([HF card](https://huggingface.co/facebook/UMA)) | 16 steps/s at 1,000 atoms on an H100; 24 for UMA-S-1.2 ([UMA paper](https://arxiv.org/html/2506.23971)) | Server-side cards and verdicts. Shipping the weights inside the app hits the redistribution, geography and AUP terms |
| UMA-M | 1.4B total / 50M active | same | 3 steps/s | Server only |
| OrbMol | Parameter count UNCONFIRMED (Orb-v3 family ≈ 25M, [Orb-v3](https://arxiv.org/html/2504.06231v2)) | **Apache-2.0**; takes charge and spin ([HF](https://huggingface.co/Orbital-Materials/OrbMol)) | Orb-v3 conservative: 28–41 steps/s at 1,000 atoms on an H200; direct: 125–216 | **Best on-device candidate by licence** |
| AIMNet2 | ? | **MIT**; 14 elements, neutral and charged closed-shell, predicts Hessians ([HF](https://huggingface.co/isayevlab/aimnet2-wb97m-d3), [paper](https://pubs.rsc.org/en/content/articlehtml/2025/sc/d4sc08572h)) | — | Small organics; analytic Hessians for cards |
| ANI-2x (TorchANI) | Ensemble of 8 | MIT; H, C, N, O, F, S, Cl ([SCM](https://scm.com/doc/MLPotential/ModelsAndBackends.html)) | — | Fixed descriptors plus per-element MLPs; probably the friendliest to the Neural Engine (my inference) |
| MACE-OFF / MACE-OMol | — | Academic Software License ([MACE docs](https://mace-docs.readthedocs.io/en/latest/guide/foundation_models.html)) | — | Not for a commercial app |

**Can these run on a phone?**
- **No published iPhone or iPad benchmark of an ML potential was found** ([search result](https://cactuscompute.com/compare/coreml-vs-mlx) was generic), so feasibility is UNCONFIRMED.
- Message-passing networks need dynamic neighbour lists, scatter/gather, and, for equivariant models, tensor products. The Neural Engine prefers static 4D channel-first tensors, so it is a poor fit.
- The realistic path is the GPU: Core AI with custom Metal kernels (WWDC26), or MLX Swift. On A19 Pro and M5 the per-core Neural Accelerators should help the matmul-heavy layers.
- My ESTIMATE is tens of milliseconds per force call for 50 atoms or fewer, after significant kernel work.
- Even at 100 steps/s and 0.5 fs per step you see 50 fs per wall-clock second, i.e. a few C–H vibrations. So an ML potential on the phone buys accuracy for **quasi-static relaxation under the finger** (a few gradient steps per frame) and for **verdicts**, not for dynamics anyone can watch.

**Where the ML potentials earn their keep (offline or on the edge):**
- Hessians and normal modes, via ASE's finite-difference `Vibrations` with any calculator ([ASE](https://docs.ase-lib.org/ase/vibrations/modes.html)) or AIMNet2's analytic Hessian;
- bond-stretch scans fitted to per-bond Morse (rₑ, k, Dₑ);
- torsion scans giving barriers and detent angles;
- strain energies;
- release-time "verdict" calls: "UMA-S: this pose is +38 kJ/mol above rest". Lupi already proxies Hugging Face Spaces through the edge with `HF_TOKEN`.

### 3d. Hybrids

A hybrid is the recommendation; the tiers are in §7. The principle: **the more atoms, the fewer independent degrees of freedom, and the more of the physics is computed ahead of time.**

---

## 4. Question 2: mapping real properties to how the molecule feels

### 4.1 Bonds: strength, stiffness, the stretch-and-snap curve

BDE is the LibreTexts mean bond enthalpy ([table](https://chem.libretexts.org/Courses/City_College_of_San_Francisco/Chemistry_101A/Topic_F%3A_Molecular_Structure/09%3A_Basic_Concepts_of_Covalent_Bonding/9.05%3A_Strength_of_Covalent_Bonds)). Wavenumbers are typical IR or Raman values:
- C–H ≈ 3000, O–H ≈ 3600, C=O 1710–1740, C=C 1600–1680 and C≡C 2100–2260 cm⁻¹ come from [IR notes](https://reusch-archive.organicchemistrydata.org/Spectrpy/InfraRed/irspec1.htm) and [here](https://davuniversity.org/images/files/study-material/CHE155%20Factors%20affecting%20IR%20frequncies.pdf).
- C–C ≈ 1000, O–O ≈ 880, N≡N ≈ 2330 and H–H ≈ 4160 cm⁻¹ are standard spectroscopic values I did not re-verify here.

All derived columns are **computed** with a diatomic two-body approximation: k = μ(2πcν̃)², and the Morse parameter a = √(kₑ/2Dₑ) ([Morse potential](https://en.wikipedia.org/wiki/Morse_potential)). Column meanings:
- **k**: stretch force constant;
- **Inflection**: how far past rₑ the bond is at its maximum force;
- **Max force**: the force at the inflection, a·Dₑ/2;
- **Period**: one vibration;
- **RMS 300 K**: classical thermal amplitude;
- **Zero-point RMS**: quantum ground-state amplitude.

| Bond | BDE kJ/mol | k (N/m) | a (Å⁻¹) | Inflection (Å) | Max force (nN) | Period (fs) | RMS 300 K (Å) | Zero-point RMS (Å) |
|---|---|---|---|---|---|---|---|---|
| C–H | 411 | 477 | 1.87 | 0.37 | 6.4 | 11.3 | 0.029 | 0.078 |
| C–C | 346 | 354 | 1.75 | 0.40 | 5.0 | 33 | 0.034 | 0.053 |
| C=C | 614 | 963 | 2.17 | 0.32 | 11.1 | 20 | 0.021 | 0.041 |
| C≡C | 839 | 1636 | 2.42 | 0.29 | 16.9 | 15.5 | 0.016 | 0.036 |
| C=O | 745 | 1189 | 2.19 | 0.32 | 13.6 | 19.4 | 0.019 | 0.038 |
| O–H | 459 | 724 | 2.18 | 0.32 | 8.3 | 9.3 | 0.024 | 0.070 |
| O–O | 142 | 365 | 2.78 | 0.25 | 3.3 | 38 | 0.034 | 0.049 |
| N≡N | 941 | 2240 | 2.68 | 0.26 | 20.9 | 14.3 | 0.014 | 0.032 |
| H–H | 432 | 514 | 1.89 | 0.37 | 6.8 | 8.0 | 0.028 | 0.090 |

Other reference points:
- Weakest single bonds: F–F 155, I–I 149, N–N ≈ 167 kJ/mol. Strongest: C≡O 1072 (same LibreTexts table).
- **Cross-check of the "snap" force:** AFM measured a Si–C bond rupturing at 2.0 ± 0.3 nN at 10 nN/s loading (Grandbois 1999, *Science* 283:1727, [record](https://www.citedrive.com/en/discovery/how-strong-is-a-covalent-bond)). DFT constrained-geometry calculations give 6–8 nN for single covalent bonds ([review, arXiv:1605.03441](https://arxiv.org/pdf/1605.03441)). The 5 nN Morse estimate for C–C sits in the right range.
- **Caveats:** a mean bond enthalpy is not the BDE of a specific bond, and D₀ = Dₑ − zero-point energy ([BDE](https://en.wikipedia.org/wiki/Bond-dissociation_energy)). Ethane's C–C is 347–377 kJ/mol against the mean of 346. **Cards should use model scans, not table lookups, where possible.**

### 4.2 Torsions and rings: what is rigid and what is floppy

Thermal energy at 300 K is kT = 2.49 kJ/mol (computed).

| Motion | Barrier | Feel |
|---|---|---|
| sp³–sp³ rotation (ethane) | 12.5 kJ/mol, about 5 kT ([Conformational isomerism](https://en.wikipedia.org/wiki/Conformational_isomerism)) | Free hinge with soft 120° clicks |
| Butane gauche vs anti | 0.9 kcal/mol (same source) | Two near-equal detents |
| Cyclohexane ring flip | 10 kcal/mol, about 10⁵ flips/s (same source) | A ring that pops between chairs |
| Amide C–N | 15–20 kcal/mol ([Peptide bond](https://en.wikipedia.org/wiki/Peptide_bond)) | Locked plane (rigid cluster) |
| C=C cis/trans | 65 kcal/mol, ethylene-d₂ ([MIT OCW](https://www.ocw.mit.edu/courses/10-675j-computational-quantum-mechanics-of-molecular-and-extended-systems-fall-2004/b4f3634708ef25282b572b5fb7475e49_ps3.pdf)) | Locked |
| Ring strain | Cyclopropane 27.5, cyclobutane 26.3, cyclopentane 7.4, cyclohexane 1.3, bicyclobutane 63.9–66.3 kcal/mol ([Ring strain](https://en.wikipedia.org/wiki/Ring_strain)) | Strained bonds snap earlier. Cubane is "quite kinetically stable" despite its strain ([Cubane](https://en.wikipedia.org/wiki/Cubane)): a good "tense but tough" personality |

### 4.3 Personality rules (measurable input → feel)

- **Rigid:**
  - Inputs: no rotatable bonds, a high share of atoms in fused or aromatic rings, cages (C₆₀, adamantane), locked amides, linear triple bonds.
  - Feel: one rigid body plus vibration modes.
- **Flexible:**
  - Inputs: number and chain length of rotatable bonds (single, not in a ring, not terminal, not an amide), each weighted by its barrier from a scan.
  - Feel: a hinged chain that settles into detents.
- **Breakable or fragile:**
  - Inputs: the weakest bond's Dₑ below about 200 kJ/mol (peroxide O–O, N–N, halogens), or high strain.
  - Feel: snaps at a gentle pull. **Ordering is true**: the weakest bond goes first.
- **Unbreakable:**
  - Inputs: no bond weaker than about 800 kJ/mol (N₂, CO).
  - Feel: will not snap at maximum effort.
- **Proteins unzip, they do not snap:**
  - Titin immunoglobulin domains unfold at 150–300 pN ([Rief 1997](https://www.biophysik.physik.lmu.de/download/biopheinf/seminar/Rief_Science_1997.pdf)), about 10× below covalent rupture.
  - Honest feel: the protein tears into its domains while the covalent backbone holds.
- **Crystals and lattices:**
  - Inputs: bulk modulus B and shear modulus G from the Materials Project elastic database ([de Jong 2015](https://dspace.mit.edu/handle/1721.1/98423)).
  - Pugh's ratio: B/G < 1.75 is brittle and shatters; above 1.75 is ductile and dents ([arXiv:1505.05443](https://arxiv.org/pdf/1505.05443)).
- **Coordination and ionic contacts** (Lupi's dashed and dotted bonds): weaker than covalent bonds, so they should give way first. The magnitudes come from card scans; no table value is sourced here (UNCONFIRMED).

### 4.4 Mass, inertia, and what happens on a throw

- **Mass:** real molar mass. H₂ is 2.016 Da and hemoglobin about 64.5 kDa, a ratio of about 3×10⁴.
- **Weight feel is a design choice, not sourced.** Map felt mass as m_feel ∝ M^γ with γ ≈ 0.3–0.5, so the ordering stays true. Show the real number ("64.5 kDa") on the card and say in Learn that the feel is compressed.
- **Flight:** RealityKit's `PhysicsMassProperties` takes the principal moments and axes from `objectFacts` directly. Inside flight, the torque-free Euler equations conserve angular momentum:
  - symmetric tops precess;
  - linear rotors spin like a baton;
  - asymmetric tops flip about their middle axis — the tennis-racket or Dzhanibekov effect ([Tennis racket theorem](https://en.wikipedia.org/wiki/Tennis_racket_theorem)).
- **Engine choice:** whether RealityKit's solver reproduces the flip is UNCONFIRMED. Fallback: run the ported `trueSpinCoast` while the molecule is in the air, then hand the body to RealityKit on contact.

### 4.5 Stretching: harmonic or Morse

- A harmonic spring never breaks and grows stiffer without limit.
- A Morse bond softens and its force peaks at rₑ + ln2/a, which is +0.25 to +0.40 Å, or 17–26% strain (computed, §4.1). Beyond that it gives way.
- Use **Morse for every covalent bond** and harmonic springs for angles. Angles never break by themselves; their bonds do.

### 4.6 Heat

- **True amplitudes are invisible at true scale.** Classical RMS at 300 K is 0.014–0.034 Å, about 2% of a bond length.
- **Zero-point motion is larger than thermal motion for X–H bonds** (C–H 0.078 Å against 0.029 Å, computed). That is an honest and surprising fact worth teaching: "it jiggles even at absolute zero".
- **Time scales differ by phenomenon** (computed):
  - vibration periods are 8–38 fs, so showing them at about 1 Hz means slowing them ~10¹³×;
  - rotations at 300 K take about 0.2 ps per turn for H₂, about 4 ps for benzene and about 30 ps for C₆₀, so showing them needs ~10¹¹–10¹²×.
  - One honest clock cannot show both, so give each phenomenon its own scale factor and label it.
- **Proposed honest Heat:** excite the card's normal modes with classical Boltzmann amplitudes, qₖ ∝ √(kT)/ωₖ. Low-frequency modes (twists, floppy chains) then dominate visibly, as in reality. Compress frequencies monotonically, for example as a root map into 0.5–8 Hz. Exaggerate amplitude by a stated factor.

### 4.7 Two scales, two clocks

- **The trophy as a desk model** (macroscopic): falls under gravity, lands on the real shelf, can be thrown. This is honest about the object you hold. A plastic model kit would fall.
- **The molecule inside** (microscopic): slowed, amplitude-exaggerated, with true ratios.

Keeping the two layers separate avoids implying that molecules feel gravity or shatter like glass.

---

## 5. Question 3: integrators and stability at 60–120 Hz

### 5.1 The stiffness problem

- Bond stiffness ranges from 354 to 2,240 N/m (§4.1). Angles are softer and torsions much softer.
- Velocity Verlet is stable only while ω·Δt < 2, a standard result.
- Two ways out:
  - **Compress the frequencies.** At ≤ 8 Hz with a fixed 1/240 s substep, ω·Δt ≈ 0.21 (computed), so explicit integration is safe.
  - **Treat stiff bonds as constraints.** This is classical SHAKE ([Ryckaert, Ciccotti, Berendsen 1977](https://papers.mewayz.com/paper/oa_W2106140689)), which XPBD generalises.

### 5.2 XPBD as the one solver

- **XPBD** (Macklin, Müller, Chentanez, MIG 2016, [PDF](https://matthias-research.github.io/pages/publications/XPBD.pdf)): compliance α = 1/k and α̃ = α/Δt², with Δλ = (−C − α̃λ)/(Σ wᵢ|∇ᵢC|² + α̃). The paper reports stiffness independent of iteration count and timestep.
  - The PDF was retrieved but its text would not extract here, so this equation is quoted from the published method rather than freshly read.
- **"Small Steps"** (Macklin et al., SCA 2019, [PDF](https://mmacklin.com/smallsteps.pdf)): many substeps with one iteration each beat many iterations. Same extraction caveat.
- **Rigid bodies in XPBD:** [Müller et al. 2020](https://diglib.eg.org/handle/10.1111/cgf14105). Rigid clusters joined by hinge constraints at rotatable bonds remove most of the stiff degrees of freedom.
- **Morse as an XPBD constraint** (my derivation):
  - Constraint: C = 1 − e^(−a(r−rₑ)), with α = 1/(2Dₑ). Then U = C²/(2α) = Dₑ(1 − e^(−a(r−rₑ)))², exactly Morse.
  - The gradient a·e^(−aΔr)·n̂ fades towards zero, so the bond naturally lets go.
  - **Break rule:** C > ½ (past the inflection), held for more than τ.
  - Calibrate one display scale so that "max finger effort" ≈ 6 nN-equivalent. Then C–C needs most of your effort, O–O about half, and N≡N never breaks. All ratios are true.
- **Torsion detents:** periodic energy V(φ) = (V/2)(1 + cos nφ) as a hinge constraint. The barrier and minima come from card scans. Lupi's camera symmetry-detent idea carries over to conformers.

### 5.3 User drag and throw

- **Prior art:** NanoVer/Narupa use a spring F = s·k·(p − r_COM) or a Gaussian variant, distributed by mass so the grabbed group accelerates as one: Fᵢ = (mᵢ/M)·F ([narupatools](https://narupatools.readthedocs.io/en/latest/concepts/interactions.html)). NanoVer now runs on standalone Quest headsets, with MD done on a server ([arXiv:2606.30678](https://arxiv.org/abs/2606.30678)).
- **In XPBD:** an attachment constraint from the grabbed atom or cluster to the finger target, with compliance α_drag and a capped force. λ/Δt² gives a force readout for a strength meter and feeds the break test.
- **Release:** the release velocity comes from finger and camera motion. In the air, the molecule goes to the macro tumble model (§4.4).

### 5.4 Heat integrator

- **Simulated tier:** BAOAB Langevin dynamics ([Leimkuhler & Matthews 2013, arXiv:1203.5428](https://arxiv.org/pdf/1203.5428)) samples the Boltzmann distribution correctly.
- **Chemistry-tuned tier:** seeded excitation of the normal modes. Deterministic, so it can be replayed.

### 5.5 CPU or GPU, and how a million atoms fits

These budgets are ESTIMATES.

- **Up to ~2–5k particles:** CPU with Swift SIMD and Gauss-Seidel XPBD. No GPU round trip, and deterministic.
- **5k–100k:** Metal compute, with Jacobi or graph-coloured Gauss-Seidel. Coloured Gauss-Seidel stays deterministic. Write results into `LowLevelMesh` or instance buffers.
- **100k to 1M atoms:**
  - one rigid body;
  - K low-frequency modes from an elastic network model: ANM (Atilgan 2001, [ProDy ANM](https://prody-official.readthedocs.io/en/latest/reference/dynamics/anm.html)), built on Tirion's single-parameter model ([Tirion 1996](https://pubmed.ncbi.nlm.nih.gov/10063201/)). Use RTB blocks for scale: "virtually no upper limit" to size, with about 25× less Hessian storage and 125× faster diagonalisation ([ProDy RTB](https://prody-official.readthedocs.io/en/latest/reference/dynamics/rtb.html)). ProDy is MIT ([licence](https://prody-official.readthedocs.io/en/latest/about/license.html)).
  - **Tug response:** perturbation response, ΔR = H⁺f ≈ Σₖ vₖ(vₖᵀf)/λₖ ([Atilgan & Atilgan 2009](https://pmc.ncbi.nlm.nih.gov/articles/PMC2758672)). The cost is O(K·N) on the GPU.
  - Add a local XPBD "focus window" of about 1–5k atoms around the finger, with its boundary pinned to the mode-deformed shape.
- **Memory** (computed): positions for 1M atoms are 12 MB in fp32. Sixteen all-atom modes in fp16 take 96 MB; at residue level (~125k residues) they take about 12 MB, plus fixed per-atom offsets.
- **Limits:** modes are linear, so large drags look rubbery. Clamp them, or label them as an elastic network model.

### 5.6 Frame pacing and heat

- Run the simulation at a fixed 1/240 s substep, which Lupi already uses, independent of the display rate (60 Hz, or 120 Hz on ProMotion devices — UNCONFIRMED here). Cap the number of substeps per frame.
- Degrade on `ProcessInfo.thermalState`, as Apple's cloth docs advise ([doc](https://developer.apple.com/documentation/realitykit/clothsimulationcomponent)).

### 5.7 Determinism and replay

- Floating point is hard to make identical across machines ([Gaffer On Games](https://gafferongames.com/post/floating_point_determinism)).
- Rules for our own solver: own the simulation (RealityKit's determinism is UNCONFIRMED), use a fixed step, a fixed constraint order, no float atomics, and Metal `mathMode = .safe`.
- Replay should store inputs plus periodic keyframes, like the web tape's 0.5 s snapshots, rather than promise bit-exact re-simulation across devices.

---

## 6. Question 4: what is honest to claim to users

Lupi already does three things on the web:
- labels toy motion "Illustrative";
- zeroes display motion in every capture;
- marks Heat as "Illustrative … Not a simulation."

The proposed AR ladder:

| Level | When | Copy example | Allowed claims |
|---|---|---|---|
| **Illustrative** | Pure toys, no card | "Illustrative motion" | None about chemistry |
| **Chemistry-tuned** | Card-driven toy physics | "Bond strengths and stiffness from UMA-S · time slowed ~10¹³× · wiggle ×20" | Ratios and orderings: "C–C needs ~2.4× the pull of O–O", "the weakest bond breaks first", "true mass ratio" |
| **Simulated** | A real potential with units | "GFN-FF · 300 K · 0.5 fs/step · shown 10¹³× slower" | The trajectory under that named method |
| **Verdict** | One edge call on release | "UMA-S single point: +38 kJ/mol" | That number, with the model and its licence attribution |

Never imply:
- that molecules feel gravity or shatter like glass. The desk-model layer is a separate label.
- a mechanism for breakage. A snap is an illustration of homolysis (bond splits evenly), not a reaction prediction.
- a cause from a remix or a foil finish.

Snapshots and USDZ exports render the rest pose, as the capture guard does on the web.

Attribution: OMol25 is CC BY 4.0; OrbMol needs Apache-2.0 notices; using UMA or FAIR models carries the AUP.

---

## 7. Recommended tiered design

| Tier | Applies to | Runtime model | Card inputs | Label |
|---|---|---|---|---|
| **T0 Macro** | Every molecule | RealityKit rigid body, with plane or LiDAR collision; true-ratio mass (compressed feel) and real principal inertia; own free-flight Euler tumble if RealityKit lacks the flip | M, I, axes (`objectFacts`) | Desk model |
| **T1 Small** | ≤ ~350 atoms (the OMol25 range) | CPU XPBD: rigid clusters, torsion hinges with detents, Morse bonds, harmonic angles; Heat by Boltzmann normal-mode excitation | Per-bond rₑ, k, Dₑ; barriers; modes; strain | Chemistry-tuned |
| **T1s Simulated (spike)** | ≤ ~50 atoms | On-device OrbMol or AIMNet2 via Core AI or MLX for quasi-static relaxation; or edge verdicts | The model itself | Simulated or Verdict |
| **T2 Medium** | ~350 to ~100k atoms | Metal XPBD over residue or rigid-cluster bodies with elastic-network springs; domains unfold rather than snap | Elastic network, rigid clusters | Chemistry-tuned (coarse) |
| **T3 Huge** | 100k to 1M+ atoms | Rigid body + K modes (RTB/ANM) + focus window + perturbation response | Offline modes | "Elastic network model" |
| **Lattices** | Crystals | Rigid body plus elastic squish from B and G; Pugh ratio decides brittle or ductile | Materials Project | Chemistry-tuned |

**Proposed data contract:** `lupi.physics-card.v1`, named to match `lupi.object-facts.v1`. Every field carries provenance: `source`, `inferred`, or `computed:<method>`. Cards are generated at build time (alongside `scripts/generate-molecule-pages.mts`) and on the edge for OMol25 rows. Size for caffeine is about 10–20 KB (computed estimate).

**Groundwork order (preparation only, no feature code):**
1. Implement `lupi-bond-orders.v1`. Bond-order-dependent BDE and rotatable-bond detection depend on it.
2. Write the card spec and an offline generator: GFN-FF or UMA scans and Hessians for the 24 OMol25 picks and the gallery.
3. Build a pure-Swift solver package: XPBD + Morse + detents + the `trueSpinCoast` port, with fixture tests and deterministic replay. Consider a TypeScript twin so feel can be tuned on the web first.
4. Spike the RealityKit macro body: does it reproduce the flip, and is it deterministic?
5. Spike on-device OrbMol or AIMNet2 for 25 atoms: go or no-go.
6. Run the RTB/ANM pipeline on one very large structure and measure memory and frame time.

---

## 8. Risks

- **Time-scale confusion and label fatigue.** Mitigation: the two-clocks framing, short labels, and the detail in Learn.
- **Wrong bond orders for aromatic or charged systems produce a wrong personality.** Mitigation: prefer model scans to tables, and show provenance.
- **Mean bond enthalpies are not specific BDEs**, and Morse from Dₑ ignores zero-point energy. Ordering survives; absolute values carry roughly 10–20% error (estimate).
- **Licences:**
  - FAIR AUP, gating and geography if UMA weights ship in the app;
  - GPL is out; LGPL in the App Store needs legal review;
  - ASL MACE models are unusable commercially.
- **On-device ML potentials:** performance unknown, plus heat and battery costs.
- **RealityKit gaps:**
  - joints have no compliance;
  - gyroscopic terms and determinism are UNCONFIRMED;
  - cloth needs iOS 27 and triangle meshes;
  - `ManipulationComponent` is not on iOS.
- **Million atoms:**
  - offline eigen-solves are costly;
  - modes are only linear;
  - memory grows with K.
- **Persistence:** whether a broken trophy stays broken the next day is a product decision.
- **Replay:** bit-exactness across devices is not achievable as a promise.
- **Minimum OS trade-off:** iOS 18 (`LowLevelMesh`, joints), iOS 26 (instancing), iOS 27 (cloth, Core AI era).

---

## 9. Questions to put to the owner

1. Which exact iPhone and iPad models are you demonstrating on? A19 Pro or M5 changes the on-device ML option. Is iOS 27 acceptable as the minimum?
2. Must play work offline, or may a "verdict" or card fetch go to the edge?
3. When a molecule breaks, does the trophy stay broken (persistent damage), heal over time, or reset?
4. Is the desk-model gravity layer wanted for every molecule, or should some float like museum specimens?
5. Where should feel sit by default: Chemistry-tuned (honest ratios, less dramatic) or Illustrative with a "true numbers" overlay?
6. Are you comfortable with gated FAIR licence terms on the server, or should the pipeline be Apache/MIT only (OrbMol, AIMNet2, GFN-FF)?
7. For proteins, which is the hero interaction: tug and unzip a domain, squish, or throw?
8. Do shared replays of AR play need to be exact, or is "keyframes plus illustrative in-between" enough?