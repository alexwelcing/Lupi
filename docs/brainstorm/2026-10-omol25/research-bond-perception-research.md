# Bond perception for OMol25 in the Lupi browser viewer: survey, measurements and recommended strategy

## Summary

- **OMol25 has no bonds, but each row carries what perception needs.** Every row in the public ColabFit split has total charge, spin and `data_id`. Every row also has per-atom Mulliken and Löwdin charges, and 26,077 of 27,697 rows have NBO charges (measured here on `colabfit/OMol25_neutral_validation`). Lupi's OMol25 edge row type (`RemoteOmolRow`) currently keeps `multiplicity` and nothing else from this.
- **Connections alone can be found in under 1 ms in TypeScript, using the rule Lupi already has.** Lupi uses Cordero radii with a 0.45 Å tolerance. It is missing pruning and metal classes.
  - On the 27,697 OMol25 neutral-validation structures, that raw rule gave an H with two bonds in 6.93% of structures.
  - It gave an over-valent H, C, N, O or halogen in 9.68%.
  - It bonded the s-block metal in 97.68% of the structures that contain one.
- **Bond orders need the total charge, and per-fragment charge where there are several fragments.** RDKit's port of xyz2mol (`rdDetermineBonds`), given charge 0, solved 88.73% of that slice. It solved 1.48% of the salt complexes.
  - The layered scheme recommended in section 8 raised this to 93.41% overall and 74.82% on salts. It prunes, splits fragments, takes each fragment's charge from its rounded Mulliken sum, and falls back to the whole molecule.
  - All OMol25 figures here are mine, measured locally.
- **Enumerating valences blows up on multiply-charged biomolecules.** A 120-atom zwitterionic hexapeptide took 1.57 s. With an iteration cap it failed.
- **Nothing in the browser does this off the shelf.** RDKit.js 2026.9.1 does not expose DetermineBonds or an XYZ reader. OpenChemLib JS has no XYZ-to-bonds API. The only OpenBabel WASM build found (inside Kekule.js) is GPL-2.0. No JavaScript or TypeScript port of xyz2mol was found on npm.
- **Recommendation:** a TypeScript Layer 0 (connectivity with pruning and metal classes), a Web Worker Layer 1/2 (fragment charges from the partial charges OMol25 supplies, then budgeted bond-order assignment), and offline precompute for featured entries. Details and the known failure cases are in section 8.

---

## 1. What OMol25 provides, and what it lacks

| Fact | Value | Source |
|---|---|---|
| Size, level of theory | ~140M single points, ωB97M-V/def2-TZVPD, ORCA 6.0.0 | [arXiv 2505.08762](https://arxiv.org/abs/2505.08762) |
| Elements, atoms, charge, spin | 83 elements; up to 350 atoms (mean ~50); charge −10 to +10; multiplicity 1–11 | [arXiv html](https://arxiv.org/html/2505.08762) |
| Per-structure properties | energy, forces, charge, spin, S², HOMO/gap, Mulliken charges (+spins if unrestricted), Löwdin charges (+spins), NBO charges "if the total number of atom <= 70" | same, Appendix A.2 |
| Bonds, SMILES, Mayer/Wiberg orders | None released. Densities and `.gbw` files are "made available in the near future" | same |
| Internal graphs | Architector built metal complexes from ligand SMILES plus metal-bound atom indices, giving "a full molecular graph". Whether those graphs are released: **UNCONFIRMED** | same |
| License, access | CC-BY-4.0. The `facebook/OMol25` repo on Hugging Face is gated | [HF](https://huggingface.co/facebook/OMol25) |
| Public ColabFit split (the one Lupi streams) | `property_metadata` JSON holds `charge`, `spin`, `data_id`, `source`, `mulliken_charges`, `lowdin_charges`, `nbo_charges` | measured from [HF parquet](https://huggingface.co/datasets/colabfit/OMol25_neutral_validation) |

The neutral-validation slice (27,697 rows) is made up as follows (measured):

- **Sources:** orbnet_denali 13,072; spice 6,369; geom_orca6 5,304; ani2x 2,952.
- **Charge and spin:** every row has charge 0 and multiplicity 1.
- **Size:** atom count median 46, p99 102, max 110.
- **Metals:** 1,684 rows contain an s-block metal (orbnet "saltcomplex" entries).
- **IDs usable for validation:**
  - 10,875 of 13,072 orbnet `source` paths contain a ChEMBL ID.
  - 825 SPICE paths contain PubChem SIDs.
  - 5,544 SPICE paths contain PDB ligand codes.

Lupi today:

- `packages/scene/src/bondDetectCpu.ts` accepts a bond when `d ≤ r_cov(A) + r_cov(B) + tolerance`, with tolerance 0.45. It has no H–H exclusion, no minimum distance, no valence pruning and no metal classes.
- The radii are Cordero 2008 with Pyykkö fallbacks (`packages/core/src/elements.ts`).
- `RemoteOmolRow` (`packages/ui/src/molecules/remoteOmol.ts`) has `bondTopology: 'not-provided'` and no charge or partial-charge fields.

---

## 2. Connectivity

### 2.1 Radii sets

| Set | Coverage | Example values (Å) | Notes | Source |
|---|---|---|---|---|
| Cordero 2008 (CSD) | Most elements up to Z=96 | H 0.31, C 0.76/0.73/0.69 (sp3/sp2/sp), N 0.71, O 0.66, Li 1.28, Na 1.66, K 2.03, Mg 1.41, Ca 1.76, Mn 1.39/1.61, Fe 1.32/1.52, Co 1.26/1.50 (low/high spin), Cu 1.32, Zn 1.22, Pt 1.36 | Based on more than 228,000 CSD bond lengths. Used by OpenBabel, RDKit (low-spin value), ASE and Lupi | [RSC](https://pubs.rsc.org/en/Content/ArticleLanding/2008/DT/b801115j), [Wikipedia](https://en.wikipedia.org/wiki/Covalent_radius), [RDKit atomic_data.cpp](https://github.com/rdkit/rdkit/blob/master/Code/GraphMol/atomic_data.cpp) |
| Pyykkö & Atsumi 2009 single / 2009 double; Pyykkö, Riedel & Patzschke 2005 triple | Z=1–118 | H 0.32; C 0.75/0.67/0.60; N 0.71/0.60/0.54; O 0.63/0.57/0.53; Na 1.55/1.60; Li 1.33/1.24 | "Mean-square deviation of each set is 3 pm". Useful as bond-length priors for bond order | [Wikipedia raw table](https://en.wikipedia.org/wiki/Covalent_radius) |
| Alvarez 2013 van der Waals radii | "Most naturally occurring elements" | Specific values not checked (**UNCONFIRMED**) | From more than 5 million non-bonded distances | [RSC](https://pubs.rsc.org/en/Content/ArticleLanding/2013/DT/C3DT50599E) |
| Charry & Tkatchenko 2024 van der Waals radii | H to Og | — | Used by xyzgraph | [ChemRxiv](https://chemrxiv.org/engage/chemrxiv/article-details/665084eb91aefa6ce1e1b1a7) |
| Bondi / Rowland-Taylor / Mantina van der Waals radii (MDAnalysis table) | Main group plus some metals | H 1.10, C 1.70, O 1.52, Na 2.27, K 2.75. **No Fe, Mn, Co, Ti, Cr, Ru, Ir, Rh** | Missing elements make guess_bonds raise | [MDAnalysis tables.py](https://github.com/MDAnalysis/mdanalysis/blob/develop/package/MDAnalysis/guesser/tables.py) |
| Šidlauskaitė et al. 2026 (COD-derived bonding radii) | Most elements; no H radius | — | Says ε "usually ranging between 0.35 Å and 0.45 Å". Beats Jmol autobond on MaterialsCoord | [arXiv 2601.02017](https://arxiv.org/abs/2601.02017) |
| Shannon 1976 ionic radii (effective, CN6) | Ions | Li⁺ 0.76, Na⁺ 1.02, K⁺ 1.38, Mg²⁺ 0.72, Ca²⁺ 1.00, O²⁻ 1.40 | Useful for s-block contact distances | [Wikipedia Ionic radius](https://en.wikipedia.org/wiki/Ionic_radius) |

### 2.2 Tolerance schemes, read from source unless noted

- **RDKit `DetermineConnectivity` (default path).** Default `useVdw=false`, so it runs ConnectTheDots: `d ≤ Rcov_i + Rcov_j + 0.45`, `d² ≥ 0.16` (0.40 Å), max 5.45 Å, with flag `ctdQUICKREMOVE_H_H_CONTACTS`. An H with two partners loses its H–H bond if it also has a non-H partner, then keeps only its shortest bond.
  - `covFactor=1.3` applies **only** when `useVdw=true`: `d ≤ 1.3·(Rcov_i + Rcov_j)`.
  - `useHueckel=true` adds a bond where the YAeHMOP reduced overlap population is ≥ 0.15.
  - Sources: [DetermineBonds.cpp](https://github.com/rdkit/rdkit/blob/master/Code/GraphMol/DetermineBonds/DetermineBonds.cpp), [ProximityBonds.cpp](https://github.com/rdkit/rdkit/blob/master/Code/GraphMol/FileParsers/ProximityBonds.cpp), [docs](https://rdkit.org/docs/source/rdkit.Chem.rdDetermineBonds.html).
- **xyz2mol (Jensen, Python).** `get_AC(covalent_factor=1.3)` uses `d ≤ 1.3·(Rcov_i + Rcov_j)`. The Hückel option uses `pair_pop >= 0.15`. MIT license. [xyz2mol.py](https://github.com/jensengroup/xyz2mol/blob/master/xyz2mol.py)
- **OpenBabel `ConnectTheDots`.**
  - Rule: `d ≤ r_i + r_j + 0.45` with Cordero radii, and `d ≥ 0.40` Å. Pentavalent P may only add F or Cl.
  - Cleanup: while an atom's explicit valence exceeds `GetMaxBonds` **or its smallest bond angle is under 45°**, delete its longest bond.
  - MaxBonds: H 1, C 4, N 4, O 2, F/Cl/Br/I 1, P/S 6, Li/Na/K/Cs 1, Mg/Ca/Ba 2, most transition metals 6, La 12, Xe 0.
  - Sources: [mol.cpp](https://github.com/openbabel/openbabel/blob/master/src/mol.cpp), [elementtable.h](https://github.com/openbabel/openbabel/blob/master/src/elementtable.h).
- **Jmol.** `bondTolerance` 0.45, `minBondDistance` 0.4.
  - Default autobond radii are OpenBabel 1.100.1 values, "a mix of common ion ... and covalent distances": H 0.23, C/N/O 0.68, Li 0.68, Na 0.97, K 1.33, Mg 1.10, Ca 0.99.
  - Atoms with a formal charge use cation or anion radius tables.
  - Pyykkö radii are available with `set bondingVersion 1`.
  - Sources: [JC.java](https://github.com/BobHanson/Jmol-SwingJS/blob/master/src/org/jmol/viewer/JC.java), [Elements.java](https://github.com/BobHanson/Jmol-SwingJS/blob/master/src/org/jmol/util/Elements.java).
- **ASE.** `natural_cutoffs(mult=1)` returns Cordero radii. `NeighborList(skin=0.3)` adds the skin to **each** cutoff, so the effective rule is `d < r_i + r_j + 0.6` unless `skin=0`. [neighborlist.py](https://gitlab.com/ase/ase/-/blob/master/ase/neighborlist.py)
- **MDAnalysis `guess_bonds`.** `d < 0.55·(R_i + R_j)` with van der Waals radii and `lower_bound` 0.1 Å. The docstring calls it "the same algorithm that VMD uses". It is deprecated since 2.8.0 in favour of the guesser API. [guessers.py](https://github.com/MDAnalysis/mdanalysis/blob/develop/package/MDAnalysis/topology/guessers.py)
- **VMD.** `d < 0.6·(r_i + r_j)`, radii guessed from atom names, no H–H bonds, and an H may have only one bond. This comes from a mailing-list search summary only (**UNCONFIRMED**). [VMD-L](https://tcbg.illinois.edu/Research/vmd/mailing_list/vmd-l/34065.html)
- **3Dmol.js.** `d ≤ r_i + r_j + 0.25`, `d² ≥ 0.5` (0.707 Å), unknown elements get 1.6 Å. An `unboundCations` option excludes Na, K, Ca, Mg, Mn and Sr. BSD-3. [areConnected.ts](https://github.com/3dmol/3Dmol.js/blob/master/src/parsers/utils/areConnected.ts), [bondLength.ts](https://github.com/3dmol/3Dmol.js/blob/master/src/parsers/utils/bondLength.ts)
- **Mol\* (molstar).**
  - Per-element thresholds: H 1.42, C 1.75, N 1.6, O 1.52, most metals 2.7.
  - Pair overrides: C–H 1.2, N–H 1.15, O–H 1.1, Si–Si 2.37, and others. Otherwise the threshold is `(t_A + t_B)/1.95`.
  - H–H is always skipped. Metal bonds are flagged `MetallicCoordination`. MIT.
  - Sources: [common.ts](https://github.com/molstar/molstar/blob/master/src/mol-model/structure/structure/unit/bonds/common.ts), [intra-compute.ts](https://github.com/molstar/molstar/blob/master/src/mol-model/structure/structure/unit/bonds/intra-compute.ts).
- **PyMOL.** `connect_cutoff` defaults to 0.35. The exact formula it feeds is **UNCONFIRMED**. [SettingInfo.h](https://github.com/schrodinger/pymol-open-source/blob/master/layer1/SettingInfo.h)
- **xyzgraph (MIT).** Multiplies a fraction by the sum of Charry–Tkatchenko van der Waals radii, by atom-pair class:
  - H–H 0.38, H–nonmetal 0.42, H–metal 0.45
  - s-block metal–ligand 0.55, d-block metal–ligand 0.65
  - nonmetal–nonmetal 0.55, metal–metal 0.70
  - plus period scaling of 0.05, and an acute-angle check of 30° (nonmetals) or 15° (metals).
  - Source: [README](https://github.com/aligfellow/xyzgraph).

### 2.3 Cutoffs these rules give for typical pairs

Each cell is the bonding cutoff in Å, computed from each tool's own tables. "Ref d" is a typical bonded distance, or a contact that must **not** be bonded.

| Pair | Ref d | Cordero+0.45 (OB/RDKit/Lupi) | 1.3×Cordero (xyz2mol) | Jmol default | 3Dmol | 0.55×vdW (MDAnalysis) | ASE skin 0 / 0.3 | Mol\* |
|---|---|---|---|---|---|---|---|---|
| C–C | 1.54 | 1.97 | 1.98 | 1.81 | 1.79 | 1.87 | 1.52 / 2.12 | 1.75 |
| C–H | 1.09 | 1.52 | 1.39 | 1.36 | 1.39 | 1.54 | **1.07** / 1.67 | 1.20 |
| 1,3 C···C (no bond) | 2.52 | 1.97 | 1.98 | 1.81 | 1.79 | 1.87 | 1.52 / 2.12 | 1.75 |
| O–H···O H-bond (no bond) | 1.85 | 1.42 | 1.26 | 1.36 | 1.35 | 1.44 | 0.97 / 1.57 | 1.10 |
| Cl–O perchlorate | 1.44 | 2.13 | 2.18 | 2.12 | 1.97 | 1.80 | 1.68 / 2.28 | 1.70 |
| Li⁺–O | ~2.16 | 2.39 | 2.52 | **1.81** | 2.32 | **1.84** | 1.94 / 2.54 | 2.16 |
| Na⁺–O | ~2.42 | 2.77 | 3.02 | **2.10** | 2.52 | **2.08** | 2.32 / 2.92 | **2.16** |
| K⁺–O | ~2.78 | 3.14 | 3.50 | **2.46** | 2.94 | **2.35** | 2.69 / 3.29 | **2.16** |
| Mg²⁺–O | ~2.12 | 2.52 | 2.69 | 2.23 | 2.28 | **1.79** | 2.07 / 2.67 | 2.24 |
| Zn–N | 2.05 | 2.38 | 2.51 | 2.58 | 2.31 | **1.62** | 1.93 / 2.53 | 2.21 |
| Pt–Cl | 2.31 | 2.83 | 3.09 | 2.94 | 2.52 | **1.93** | 2.38 / 2.98 | 2.31 |
| Fe–C (ferrocene) | 2.05 | 2.53 | 2.70 | 2.47 | 2.27 | n/a (no Fe radius) | 2.08 / 2.68 | 2.28 |

Bold cells reject or miss a typical bond. Reference distances for M⁺–O are sums of Shannon CN6 radii. Transition-metal aqua M–O distances run 1.96–2.18 Å, and Jahn–Teller Cr(II) shows 2.06 and 2.33 Å ([Wikipedia](https://en.wikipedia.org/wiki/Metal_aquo_complex)).

What the table shows:

- **"Cordero + 0.45" bonds every s-block cation to its solvation shell.** Jmol, MDAnalysis and Mol\* avoid that only because of their radius choices.
- **ASE with `skin=0` misses ordinary C–H bonds** (1.07 Å cutoff against a 1.09 Å bond).
- **MDAnalysis misses ordinary transition-metal–ligand bonds.**

### 2.4 Special cases

- **H–H.**
  - Every mature tool excludes H–H, or allows it only for isolated H₂: RDKit quick-remove, OpenBabel cleanup, Mol\* skips it entirely, VMD (UNCONFIRMED), xyzgraph scales it by 0.38.
  - With Cordero + 0.45, any H···H under 1.07 Å bonds.
- **Multivalent H.** RDKit keeps the shortest bond. OpenBabel deletes the longest. Bridging hydrides (B–H–B, M–H–M) are three-centre two-electron bonds that two-centre schemes cannot represent ([xyz2mol_tm](https://pmc.ncbi.nlm.nih.gov/articles/PMC12039060/), [xyz2mol-om](https://github.com/ekdms-S/xyz2mol-om)).
- **Hypervalent atoms.**
  - OpenBabel caps halogens at 1 bond and Xe at 0. Its perchlorate output was `[O].[O].[O].[O]Cl` (measured, section 7).
  - RDKit's valence table is P {5,3}, S {6,3,2,1}, halogens {1}. PF₆⁻ fails with "Unable to determine valence" (measured).
- **Long bonds, distorted geometries and transition states.** OMol25 includes MD, AFIR and reactivity geometries (arXiv, appendices F and H). Fixed cutoffs flicker on stretched bonds. xyzgraph has an elongated-bond mode for transition states.
- **Clashes.** Minimum distances are 0.40 Å (OpenBabel, RDKit, Jmol), 0.707 Å (3Dmol) and 0.1 Å (MDAnalysis). In the OMol25 slice, 6 of 27,697 structures (0.02%) had any pair closer than 0.7 Å (measured).
- **Spin and radii.** Cordero's low-spin and high-spin radii differ by 0.20 Å for Fe, 0.22 for Mn and 0.24 for Co. OMol25's multiplicity can choose between them. The mapping from total multiplicity to the metal's own spin state is a heuristic (**UNCONFIRMED** as a rule).

---

## 3. Bond-order assignment

### 3.1 xyz2mol and RDKit `DetermineBondOrders`

- **Algorithm** (Kim & Kim 2015, [DOI](http://dx.doi.org/10.1002/bkcs.10334)):
  - Enumerate per-atom valence combinations as a lazy Cartesian product.
  - For each combination, raise the order between unsaturated neighbours by maximum-cardinality matching (Boost Edmonds in RDKit).
  - Accept the first combination whose valences and charge check out.
  - Kim & Kim report "near 100%" on 10,000 random PubChem molecules ([KAIST record](https://koasas.kaist.ac.kr/handle/10203/200235)).
- **Charge is required.** The final formal-charge sum must equal the input charge, otherwise it raises an error.
  - `allowChargedFragments=true` (default) places formal charges. `false` places radicals instead. It does not accept a spin multiplicity.
  - `maxIterations` (default 0, meaning unlimited) raises `MaxFindBondOrdersItersExceeded`.
  - Source: [DetermineBonds.h](https://github.com/rdkit/rdkit/blob/master/Code/GraphMol/DetermineBonds/DetermineBonds.h).
- **Valence table:** {H 1, B 3/4, C 4, N 3/4, O 2/1/3, F 1, Si 4, P 5/3, S 6/3/2/1, Cl 1, Ge 4, Br 1, I 1}. Other elements fall back to RDKit's periodic table. Metals typically end with "Atom 0 with atomic number 78 has no valences defined" (measured on cisplatin).
- **Reported accuracy:**
  - QM9, 9,991 molecules: 909 mismatches against the relaxed-geometry SMILES and 27 against both references, at about 65 µs per molecule ([Landrum blog](https://greglandrum.github.io/rdkit-blog/posts/2022-12-18-introducing-rdDetermineBonds.html)).
  - GEOM: recovered the original graph for 88.4% of QM9 and 94.7% of drug molecules. About 70% of drug failures were resonance-form handling, giving an estimated 98.4% true recovery ([GEOM, arXiv 2006.05531](https://arxiv.org/abs/2006.05531)).
  - Platinum 2017 (4,557 ligands): xyz2mol 29.5% against Open Babel 3.0 35.6%. This is a gist, not peer-reviewed, and likely confounded by charge and protonation ([gist](https://gist.github.com/n-yoshikawa/52f1d175923b79539feef29acff6e627)).

### 3.2 OpenBabel `PerceiveBondOrders`

Steps, from [mol.cpp](https://github.com/openbabel/openbabel/blob/master/src/mol.cpp):

1. Hybridisation from average bond angle: above 155° is sp, above 115° is sp2.
2. Rings: 5-membered rings with mean torsion ≤ 7.5° and 6-membered rings with mean torsion ≤ 12° are made sp2.
3. "Antialiasing".
4. Functional-group patterns.
5. Kekulisation of aromatic rings.
6. Remaining orders by electronegativity and shortest bond, with triple bonds rejected if longer than 0.9× the expected length.

It takes **no charge input**, so it produces radicals on ions (measured, section 7). License is GPL-2.0.

### 3.3 Hückel-based connectivity

RDKit and xyz2mol add a bond where the extended-Hückel reduced overlap population is ≥ 0.15. Measured here: 6.6 ms for caffeine (24 atoms) and **18.8 s for a 327-atom peptide** (native). That cost rules it out for interactive use at OMol25 sizes.

### 3.4 Other approaches

| Method | Idea | Reported numbers | Source |
|---|---|---|---|
| MDAnalysis RDKit converter | Per-atom "number of unpaired electrons" from expected valence; raise bond orders between adjacent unpaired atoms; SMARTS standardisation of conjugated groups. Needs explicit H; does not need total charge | "~99% accuracy on the ChEMBL27 dataset" | [docs](https://docs.mdanalysis.org/stable/documentation_pages/converters/RDKit.html) |
| xyzgraph (cheminf) | Beam or greedy search over bond-order changes, scored on valence error, formal charges, electronegativity and conjugation; Hückel 4n+2 aromaticity; 17 non-covalent interaction types | No numbers in README. Metal bonds locked at order 1; radicals "may be unreliable" | [README](https://github.com/aligfellow/xyzgraph); JCTC 2026, [citation page](https://xyzrender.readthedocs.io/en/stable/citation.html) |
| xyz2mol_tm (Hückel to SMILES) | Connectivity by +0.45 Å, then cut the weakest bond (longest relative to covalent radii) until valence is satisfied; ligand charge from extended Hückel | 98.5% valid SMILES on tmQMg (59,878/60,799); NBO route 76%; agreement between methods 70–81% | [paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC12039060/), [repo](https://github.com/jensengroup/xyz2mol_tm) (MIT) |
| xyz2mol-om | One integer program (HiGHS) decides ligand bond orders, charges, haptic bonds and oxidation state | On a CSD holdout of 5,995 complexes: internal bond existence F1 0.99997; Double 0.8044; M–L existence 0.9928; haptic 0.9832; Σ ligand charge 0.9396; oxidation state 0.9863. Fit on xTB-relaxed structures; DFT coordinates are "off-distribution" | [repo](https://github.com/ekdms-S/xyz2mol-om) (MIT) |
| NAOMI (Urbaczek et al.) | Rule-based chemistry model | 98% on 363 PDB entries | [CORE](https://core.ac.uk/works/48728780) |
| EDM lookup tables | Bond-length tables with margins of 10/5/3 pm for single/double/triple | Real QM9 data: atom stability 99.0%, molecule stability 95.2%. GEOM-drugs: atom stability 86.5% | [arXiv 2203.17003](https://arxiv.org/abs/2203.17003) |
| YuelBond (machine learning) | Learned bond perception | 98.4% F1 on clean GEOM. RDKit processed only 217 of 1,000 noisy inputs | [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC13067372/) |

### 3.5 Zwitterions, radicals and open shells

- **Zwitterions.** RDKit with the correct total charge handled glycine zwitterion and nitrobenzene (measured). OpenBabel output `[NH3]CC(=O)[O]`, which RDKit cannot parse.
- **Open shells.** No tool listed takes a spin multiplicity except xyz2mol-om (`n_unpaired = multiplicity − 1`) and xyzgraph's xTB path. RDKit only switches charges to radicals.
- **OMol25 can help here.** It supplies Mulliken and Löwdin spin populations for unrestricted calculations, which can place radicals on specific atoms. This is proposed, not tested: the measured slice contains only singlets.

---

## 4. Metal–ligand and coordination bonds

**Conventions:**
- **RDKit** has dative bonds written `->` in SMILES; they do not count toward the donor's valence ([RDKit Book](https://rdkit.readthedocs.io/en/latest/RDKit_Book.html)).
- **Molfile V3000** has coordination bond type 9 with COORD and DATIVE display options, and hydrogen bonds with HBOND1/HBOND2 ([depth-first](https://depth-first.com/articles/2021/11/17/ten-reasons-to-adopt-the-v3000-molfile-format/)). The type number 10 for H-bonds is **UNCONFIRMED**.
- **mmCIF** `struct_conn_type`: `metalc`, `hydrog`, `saltbr`, `covale`, `disulf` ([wwPDB](https://mmcif.wwpdb.org/dictionaries/mmcif_pdbx_v50.dic/Items/_struct_conn_type.id.html)).
- **CSD** bond codes are S/D/T/Q/A/C/E/P, with P meaning a metal–ligand π bond. This is from a search summary of [IUCr MIF](https://it.iucr.org/Ga/ch4o8v0001/Ibond_type_ccdc.html), page not fetched (**UNCONFIRMED**).
- **xyz2mol_tm and xyz2mol-om** write all M–L bonds as dative arrows and set the metal's formal charge to its oxidation state.

**How viewers draw them:**
- **Mol\*** flags `MetallicCoordination` separately from covalent bonds.
- **Chimera** draws metal-complex pseudobonds "medium purple, linewidth 2.5, dashed". This is from mailing-list results (**UNCONFIRMED** for ChimeraX defaults); see [chimera-users](https://www.cgl.ucsf.edu/pipermail/chimera-users/2010-November/005776.html).

**Tolerances:**
- **xyzgraph:** d-block 0.65× and s-block 0.55× the van der Waals sum.
- **xyz2mol_tm:** +0.45 Å, then valence-driven cuts.
- **Mol\*:** about 2.16–2.41 Å for typical M–O, N, P and Cl pairs (table 2.3).

**Haptic (η) ligands:**
- False haptic patterns appear when "the neighbor-atom of a coordinating atom is initially also assigned a bond". xyz2mol_tm fixes this by "cutting perceived haptic bonds that are much longer than those for their haptic neighbors".
- xyz2mol-om haptic detection: F1 0.98 with xTB bond orders, 0.96 from distances alone.

**Ions that should not get sticks:**
- **s-block cations** in electrolytes and salt complexes. 3Dmol.js `unboundCations` is the explicit precedent. On the OMol25 slice the raw Lupi rule bonded the metal in 97.68% of s-block rows (measured).
- **Ion pairs** such as [EMIM]⁺/BF₄⁻ and Li⁺···PF₆⁻.
- **Salt bridges.** mmCIF classes these as `saltbr`, not covalent.

---

## 5. Non-covalent: hydrogen bonds

| Source | Criteria (defaults) | Shown by default? |
|---|---|---|
| IUPAC 2011 | X–H···Y angle "should preferably be above 110°" ([IUPAC CI](https://iupac.org/publications/ci/2011/3305/pac3_PAC-REP-10-01-01.html)) | — |
| Jmol | angle ≥ 90°; N/O···N/O ≤ 3.25 Å; H···X ≤ 2.5 Å ([GlobalSettings.java](https://github.com/BobHanson/Jmol-SwingJS/blob/master/src/org/jmol/viewer/GlobalSettings.java)) | No (calculated on command) |
| Mol\* | donor–acceptor ≤ 3.5 Å (S 4.1 Å); donor and acceptor angle deviation ≤ 45°; out-of-plane limits 45°/90°; water–water off ([hydrogen-bonds.ts](https://github.com/molstar/molstar/blob/master/src/mol-model-props/computed/interactions/hydrogen-bonds.ts)) | Interactions representation, opt-in |
| ChimeraX | Mills & Dean criteria, relaxed by distSlop 0.4 Å and angleSlop 20° ([docs](https://www.cgl.ucsf.edu/chimerax/docs/user/commands/hbonds.html)) | No (command) |
| PyMOL | h_bond_cutoff_center 3.6, h_bond_cutoff_edge 3.2, h_bond_max_angle 63° ([SettingInfo.h](https://github.com/schrodinger/pymol-open-source/blob/master/layer1/SettingInfo.h)) | No ("find polar contacts" action) |
| MDAnalysis | D–H ≤ 1.2 Å, D···A ≤ 3.0 Å, D–H···A ≥ 150° ([hbond_analysis.py](https://github.com/MDAnalysis/mdanalysis/blob/develop/package/MDAnalysis/analysis/hydrogenbonds/hbond_analysis.py)) | — |

---

## 6. Browser feasibility (JavaScript / WebAssembly)

| Option | Bond perception API? | Size (measured) | License | Notes |
|---|---|---|---|---|
| RDKit.js `@rdkit/rdkit` 2026.9.1 | **No.** No DetermineBonds or XYZ reader in `RDKit_minimal.d.ts` or `jswrapper.cpp`; `get_mol` reads SMILES, molblock and JSON | wasm 7.38 MB, about 2.41 MB gzip -9 | BSD-3 | A custom MinimalLib build that adds the DetermineBonds library is plausible (pure C++ plus Boost Graph) but untested (**UNCONFIRMED**). The Hückel path needs YAeHMOP (license **UNCONFIRMED**) and is too slow anyway. [CMakeLists](https://github.com/rdkit/rdkit/blob/master/Code/MinimalLib/CMakeLists.txt) |
| OpenChemLib JS 9.25.0 | **No** XYZ-to-bonds API in `openchemlib.d.ts` (fromSmiles, fromMolfile, fromIDCode, fromText only) | openchemlib.js 1.10 MB + resources.json 1.35 MB | BSD-3 | Internal Java bond calculators are **UNCONFIRMED** |
| OpenBabel WASM (inside Kekule.js 1.0.4) | ConnectTheDots and PerceiveBondOrders symbols present | openbabel.wasm 4.10 MB (1.41 MB gzip) + .data 2.85 MB (0.77 MB gzip) + 1.42 MB JS glue | Wrapper MIT; **OpenBabel GPL-2.0** | Takes no charge; its valence caps break ions (section 7). The npm `openbabel` package is a Node-only port from 2015 |
| xyz2mol / xyzgraph port | No npm or crates.io package found | — | MIT (Python) | A Rust-to-WASM port of xyzgraph exists inside the Typst plugin [xyzrender-rustyp](https://typst.app/universe/package/xyzrender-rustyp); reusing it outside Typst is **UNCONFIRMED** |
| 3Dmol.js 2.5.5, Mol\* 5.12.0 | Connectivity only (no orders from geometry) | — | BSD-3 / MIT | Good references for the TypeScript rules |

**Runtime measured here** (Xeon 2.8 GHz, 4 vCPU container):
- **TypeScript connectivity:** a naive Map-based spatial hash in Node 22 took 0.78 ms for 397 atoms.
- **RDKit native**, 327- and 397-atom peptides: connectivity 0.5 / 0.9 ms, bond orders 0.6 / 1.1 ms.
- **RDKit native on OMol25 neutral-validation:** connectivity p50 0.04 / p99 0.14 ms; bond orders p50 0.21, p95 1.31, p99 6.74, max 270 ms.
- **Not measured:** the slowdown of a TypeScript or WASM port relative to native (**UNCONFIRMED**).

---

## 7. Validation: how to measure, and the numbers

**Metrics to track:**
- Bond-existence precision, recall and F1, broken down by pair class (organic, H, s-block, d-block).
- Exact graph match: InChI connectivity layer, or canonical SMILES with stereo removed.
- Bond-order accuracy and formal-charge accuracy.
- Solve rate (a valid Lewis structure consistent with the given charge).
- Timeout rate, and runtime p50/p95/p99.

**References available for OMol25-derived rows:**
- SPICE stores a mapped SMILES with explicit H and charges per molecule ([SPICE](https://doaj.org/article/777e27c4ba50416380442bf4a396eb72)), and SPICE2 is part of OMol25's community data.
- ChEMBL IDs (10,875 orbnet rows), PubChem SIDs (825), PDB ligand codes (5,544) and GEOM IDs (5,304) appear in `source` (measured).
- For metal complexes, use tmQMg SMILES from xyz2mol_tm and CSD labels.

**Measured A: small curated set.** Coordinates from ETKDG + MMFF; RDKit 2026.03.6 with the correct charge; Open Babel 3.1.0 wheel.

| Case | RDKit | Open Babel |
|---|---|---|
| caffeine, nitrobenzene, methyl phenyl sulfone, ethylene carbonate | OK | OK |
| acetate, dimethyl phosphate⁻, EMIM⁺, pyridinium⁺, guanidinium⁺, BF₄⁻, ATP⁴⁻-like | OK (ATP: 1.58 ms) | Radicals or unparsable output |
| glycine zwitterion | OK | Unparsable |
| DMSO | Charge-separated `C[S+](C)[O-]` (valid resonance form) | OK |
| TFSI⁻ | Charge placed on O instead of N (resonance) | Radical |
| PF₆⁻ | **Fail** (valence) | Breaks into fragments |
| ClO₄⁻ | OK (fallback path) | **Breaks into atoms** (Cl max 1 bond) |
| [M(H₂O)₆]ⁿ⁺ for Li, Na, K, Mg, Ca | **Fail** (charge mismatch: M–O bonded) | Metal disconnected (O cap 2 deletes the M–O bond) |
| cisplatin | **Fail** ("no valences defined") | Dative bonds plus Cl radicals |
| 20-mer / 25-mer neutral peptide (327 / 397 atoms) | OK, about 1–2 ms | OK |
| zwitterionic hexapeptide KDERFW (120 atoms) | OK but **1,568 ms**; with `maxIterations=10000`, **fails** at 228 ms | Unparsable |
| cationic KRG given charge 0 instead of +3 | **Fail** (wrong charge) | — |

**Measured B: all 27,697 OMol25 neutral-validation rows.**
- **Lupi's current raw rule** (Cordero + 0.45, no pruning):
  - H with more than one bond: 6.93% of structures.
  - H–H bond: 0.06%.
  - Over-valent H, C, N, O or halogen: 9.68%.
  - s-block metal bonded: 97.68% of the 1,684 s-block rows.
- **RDKit** (ConnectTheDots + bond orders, charge 0, `maxIterations=20000`):
  - 88.73% solved overall.
  - By source: spice 97.57%, geom_orca6 95.04%, ani2x 87.40%, orbnet_denali 82.17%.
  - Metal-containing rows: 1.48%.
  - Main failure: "Final molecular charge does not match" (1,512 rows).
- **Open Babel:** 63.86% clean, 28.09% radicals, 8.04% unparsable; p50 0.30 ms.
- **Agreement:** where both succeeded, RDKit and Open Babel gave identical stereo-free SMILES in 94.02% of rows.
- **Fragment charges from partial charges.** Over 39,944 fragments in multi-fragment structures RDKit solved, the rounded fragment sum matched RDKit's formal charge:
  - Mulliken: 98.67% of all fragments; 93.74% of charged fragments.
  - Löwdin: 97.14% of all fragments; 82.38% of charged fragments.
  - This is agreement with RDKit's answer, not accuracy against a reference.
- **The layered scheme** proposed in section 8:
  - 92.45% alone; **93.41% with whole-molecule fallback**.
  - s-block salts: 1.48% → 74.82%. orbnet: 82.17% → 92.06%. Organic-only rows: 94.38% → 94.61%.
  - Total time p50 0.97, p95 2.39, p99 7.15, max 263 ms.

All of these are solve rates, not correctness: there is no reference graph yet.

---

## 8. Recommended layered approach for Lupi

**Layer A: pass data through, infer nothing.**
- The dataset edge should forward `charge`, `spin`/multiplicity, `data_id`, `source` IDs, `mulliken_charges` and `lowdin_charges` (plus spins when unrestricted) with each OMol25 row.
- Today only `multiplicity` reaches `RemoteOmolRow`. Any source-provided bonds always win.

**Layer 0: connectivity (always on, synchronous, under 1 ms for 350 atoms, TypeScript).**
- **Classify elements:** H; nonmetal/metalloid; s-block (Li, Na, K, Rb, Cs, Mg, Ca, Sr, Ba, with Be treated as covalent); other metals; noble gases.
- **Base rule:** keep `d ≤ r_i + r_j + 0.45` with Cordero radii (Lupi's current rule). Add `d ≥ 0.40` Å.
- **H rules:** no H–H unless both H atoms have no other partner (H₂). An H keeps only its nearest partner, except a bridge between two metals or two B atoms.
- **Valence caps with hypervalent exceptions:**
  - Base caps: C 4, N 4, O 3, F 1.
  - Halogens up to 7 when bonded to O or F.
  - P, S, Se up to 6; Xe up to 8.
  - When over the cap, drop the bond with the largest `d/(r_i+r_j)`.
  - Also drop the longer bond of any pair forming an angle under 45° (OpenBabel's rule; xyzgraph uses 30°, or 15° at metals).
- **s-block metals:** no covalent sticks. Draw an optional "ionic contact" overlay at `d ≤ r_ion(M) + 1.40 + 0.3` Å (Shannon radii). This threshold is proposed and must be validated.
- **Other metals:** keep `kind = coordination` bonds, using the high-spin Cordero radius for Mn, Fe and Co to avoid misses.
  - Detect haptic groups (a metal bonded to two or more mutually bonded atoms) and cut bonds much longer than their haptic neighbours.
  - Render coordination thinner or dashed, with a toggle, as Chimera and Mol\* do.
- **Trajectories:** keep frame-0 topology, or apply hysteresis (form at +0.45, break at +0.60; proposed) so bonds do not flicker.

**Layer 1: fragments and charges (Web Worker).**
- Split into connected components.
- Set each fragment's charge to the rounded Mulliken sum (98.7% agreement measured). Reconcile to the total charge by adjusting the fragment with the largest rounding residual.
- An isolated s-block ion gets its rounded charge.
- Spin: `n_unpaired = multiplicity − 1`. When spin populations exist, put radicals on the atoms with the largest |spin|.

**Layer 2: bond orders (Worker, budgeted).**
1. First, a deterministic inferrer in the MDAnalysis style (unpaired-electron count plus matching). It has no enumeration, which suits OMol25 because every H is explicit.
2. If that fails the fragment's charge check, fall back to an xyz2mol-style port: the valence table above, extended with P 6 and halogens 7, plus Edmonds or greedy matching. Cap iterations at about 2·10⁴ and wall time at about 50 ms per fragment.
3. If that fails, retry the whole molecule with the total charge.
- **Aromatic rings:** render as delocalised when planar (5-ring torsion ≤ 7.5°, 6-ring ≤ 12°) and Hückel 4n+2 holds.
- **On failure:** show single sticks only, labelled "orders unknown". Never show guessed double bonds.

**Layer 3: offline precompute for featured or curated OMol25 entries.**
- Run RDKit, plus xyz2mol-om for transition-metal complexes, at build time.
- Validate by InChI connectivity against ChEMBL, PubChem, GEOM and SPICE references.
- Ship bond pairs, orders and a confidence value in the index.

**Layer 4: non-covalent overlay (opt-in).**
- H-bonds: D···A ≤ 3.5 Å, H···A ≤ 2.5 Å, D–H···A ≥ 120° (combining Mol\*, Jmol and IUPAC's 110°).
- Optional s-block contacts and salt bridges, dashed and never counted as bonds.

**Known failure cases (with evidence):**
1. **Hypervalent anions** (PF₆⁻, SF₆-like) fail RDKit's valence table. Perchlorate and periodate are broken by OpenBabel's cap of 1 on halogens (measured).
2. **Resonance and charge-separated forms** (DMSO, TFSI, sulfonyl, nitro) produce valid but different SMILES. This is fine for display; tests must compare resonance-invariantly (GEOM: about 70% of drug failures were resonance).
3. **Enumeration blow-up** on multiply-charged peptides and nucleic acids: 1.57 s for 120 atoms; capped runs fail (measured).
4. **Charge-transfer complexes:** rounding fragment charges disagrees with RDKit on about 6–18% of charged fragments (Mulliken/Löwdin, measured).
5. **Off-equilibrium geometries** (ani2x MD and normal-mode samples, transition states): about 87% solve rate (measured).
6. **Transition metals:**
   - Ligand charge and oxidation-state ambiguity (xyz2mol_tm methods agree 70–81%; xyz2mol-om Σ ligand charge exact 94.0%).
   - bipyridine radical anion against neutral bipyridine.
   - Metal–metal bond orders are placeholders.
   - Bridging CO is forced to C≡O.
   - Jahn–Teller bimodal Cu–O distances, noted as a problem in the [2026 bonding-radii paper](https://arxiv.org/abs/2601.02017).
7. **Three-centre bonds** (boranes, M–H–M): outside any two-centre scheme.
8. **High-spin metals:** low-spin radii with a small tolerance miss M–L bonds (Fe low-spin/high-spin radii differ by 0.20 Å).
9. **Hückel connectivity is too slow:** 18.8 s native for 327 atoms.
10. **Licensing:** an OpenBabel WASM build is GPL-2.0 distributed to every visitor.
11. **Missing per-atom charges:** if the edge does not pass Mulliken or Löwdin charges, Layer 1 must guess fragment charges, and salt and electrolyte rows drop back toward the 1.5% baseline.

---

**Files (scratchpad, absolute paths):**
- Benchmark scripts:
  - /tmp/claude-0/-home-user-Lupi/42eb61f3-cc7c-558d-8ada-8bfe7b608889/scratchpad/bench/bench.py
  - /tmp/claude-0/-home-user-Lupi/42eb61f3-cc7c-558d-8ada-8bfe7b608889/scratchpad/bench/bench2.py
  - /tmp/claude-0/-home-user-Lupi/42eb61f3-cc7c-558d-8ada-8bfe7b608889/scratchpad/bench/bench3.py
  - /tmp/claude-0/-home-user-Lupi/42eb61f3-cc7c-558d-8ada-8bfe7b608889/scratchpad/bench/omolbench.py
  - /tmp/claude-0/-home-user-Lupi/42eb61f3-cc7c-558d-8ada-8bfe7b608889/scratchpad/bench/layered.py
  - /tmp/claude-0/-home-user-Lupi/42eb61f3-cc7c-558d-8ada-8bfe7b608889/scratchpad/bench/analyze.py
  - /tmp/claude-0/-home-user-Lupi/42eb61f3-cc7c-558d-8ada-8bfe7b608889/scratchpad/bench/conn.mjs
- Raw results:
  - /tmp/claude-0/-home-user-Lupi/42eb61f3-cc7c-558d-8ada-8bfe7b608889/scratchpad/bench/omol_results.jsonl
  - /tmp/claude-0/-home-user-Lupi/42eb61f3-cc7c-558d-8ada-8bfe7b608889/scratchpad/bench/layered_results.jsonl

**Lupi files referenced:**
- /home/user/Lupi/packages/scene/src/bondDetectCpu.ts
- /home/user/Lupi/packages/core/src/elements.ts
- /home/user/Lupi/packages/ui/src/molecules/remoteOmol.ts
- /home/user/Lupi/packages/ui/src/molecules/providers/omol.ts