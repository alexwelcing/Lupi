# OMol25: what each record provides, with a focus on bonds

Research date: 2026-10-03. The official `DATASET.md` on Hugging Face is gated and returned HTTP 401 to me ([link](https://huggingface.co/facebook/OMol25/blob/main/DATASET.md)). The official per-record key names below therefore come from the ColabFit mirrors, which carry each record's original metadata as a JSON string. I sampled about 2,600 rows through the HF datasets-server rows API, for example [this query](https://datasets-server.huggingface.co/rows?dataset=colabfit/OMol25_validation&config=default&split=train&offset=0&length=100).

## Summary

- **No public per-record release has bonds.** None of the official ASE-LMDB release, the five ColabFit conversions, or the derived HF datasets I checked carries bond orders, connectivity, SMILES, InChI or a molecular graph. Not one sampled row had such a field.
- **Fields that help assign bonds:**
  - total `charge`
  - spin multiplicity `spin` (ColabFit also has a `multiplicity` column)
  - `mulliken_charges` and `lowdin_charges`
  - `nbo_charges` for roughly ≤70 atoms
  - `*_spins` arrays when the calculation is unrestricted
  - `data_id`, the subset label
  - `source`, a path that embeds upstream IDs (SPICE names, ChEMBL IDs, PDB and ZINC IDs, RGD1 reaction IDs)
- **DFT bond orders exist only in the raw ORCA outputs.** The OMol25 ORCA recipe asks for Mayer bond orders (on by default), Löwdin and Mulliken bond orders, and NBO analysis. Raw outputs are public only for the **4M split**, through Argonne/Globus: about 500 TB, with human approval. The full set is "available on request".
- **Other viewers guess bonds from distance.** The fairchem UMA demo and the OMol25-trained OrbMol demo both draw with 3Dmol.js. It treats atoms as bonded when d < r_cov(A) + r_cov(B) + 0.25 Å, and every bond it draws is single. Zatom-1 made its OMol25 SMILES with OpenBabel.
- **Licence:** data CC-BY-4.0. The HF repo is gated (name, date of birth, organisation; geographic limits). The ColabFit mirrors are ungated CC-BY-4.0 with their own DOIs.

---

## 1. Scope

| Item | Value | Source |
|---|---|---|
| Level of theory | ωB97M-V/def2-TZVPD, ORCA 6.0.0, RI-J + COSX, DEFGRID3, tight SCF | [arXiv v2 §2.7, App. A](https://arxiv.org/html/2505.08762v2) |
| Scale | ">140 million DFT calculations" (v2); "~83M unique molecular systems" | [arXiv v2](https://arxiv.org/html/2505.08762v2), [abs](https://arxiv.org/abs/2505.08762) |
| Versions | OMol-0, the May 2025 preprint (~100M points), and OMol-1 (+40M: intermediate-spin metal complexes, low-spin electrolytes, most of the main-group domain) | [arXiv v2 App. B](https://arxiv.org/html/2505.08762v2) |
| Size | 2 to 350 atoms, mean 50. The largest I saw in samples was 347. | [arXiv v2 §2.8](https://arxiv.org/html/2505.08762v2) |
| Elements | "all of the first 83 elements". The ColabFit element list is exactly H through Bi (I counted 83). No actinides. | [arXiv](https://arxiv.org/html/2505.08762v2), [ColabFit train README](https://huggingface.co/datasets/colabfit/OMol25_train) |
| Charge and spin | Charge −10 to +10; multiplicity 1 to 11 | [arXiv v2 §2.8](https://arxiv.org/html/2505.08762v2) |
| Domains | Biomolecules (protein–ligand pockets, protein–protein interfaces, DNA/RNA); metal complexes (Architector, AFIR reactivity); electrolytes (MD clusters, RPMD, droplets, redox, Popcornn reactivity); main-group (RGD1, PMechDB/RMechDB, ANI-1xBB, heavy main-group, noble gases, OMC25 clusters); community (ANI-2x, Transition-1x, OrbNet Denali, SPICE2, Solvated Protein Fragments, about 30% of GEOM) | [arXiv v2 §2.1–2.5, App. I](https://arxiv.org/html/2505.08762v2) |
| Geometry type | Mostly non-equilibrium: MD snapshots, reaction paths, ML-MD, rattling, optimisations capped at 5 steps | [arXiv v2 §2.2–2.6](https://arxiv.org/html/2505.08762v2) |

**Splits** ([arXiv v2 Table 1](https://arxiv.org/html/2505.08762v2)):

- Train All: 140,641,161
- Train 4M: 3,986,754
- Train Neutral: 34,335,828 ("charge-neutral singlets" from ANI-2x, OrbNet Denali, SPICE2, GEOM, Transition-1x, RGD1)
- Val Comp: 2,762,021
- Test: Comp, M-Lig, PDB-TM, Reactivity, COD, Anions

The paper says "All training and validation splits are made publicly available". I could not confirm that test structures are released (UNCONFIRMED).

**`data_id` values seen in samples:** `elytes`, `biomolecules`, `metal_complexes`, `reactivity`, `orbnet_denali`, `spice`, `geom_orca6`, `ani2x`, `trans1x`, `rgd`. Each `source` prefix lines up with one of these: `omol/electrolytes`, `pdb_fragments_300K`, `omol/metal_organics`, `ani1xbb`, `pmechdb`, `rgd_uks` and so on. My samples are ColabFit and look like OMol-0, so OMol-1-only subsets may use other labels (UNCONFIRMED).

**Share of charged and open-shell systems.** The paper only gives a heat map (Fig. 2e); I found no official percentage (UNCONFIRMED). In my non-random row samples:

| Sample | Charged | Spin > 1 |
|---|---|---|
| ColabFit validation (700 rows) | 58% | 10.6% |
| ColabFit train (700 rows) | 36% | 11.7% |
| ColabFit train_4M (400 rows) | 41.5% | 17% |

The samples come from the [rows API](https://datasets-server.huggingface.co/rows?dataset=colabfit/OMol25_validation&config=default&split=train&offset=0&length=100) and only cover the partially indexed first ~0.8–1M rows.

**ColabFit is OMol-0.** ColabFit `OMol25_train` holds **101,666,280** configurations, against the paper's 140.6M ([README](https://huggingface.co/datasets/colabfit/OMol25_train), [family page](https://colabfit.org/families/OMol25)). It is most likely the OMol-0 training set; that is my inference, UNCONFIRMED. The 4M (3,986,754), validation (2,762,021) and train_neutral (34,335,828) counts match the paper.

## 2. Fields in each record

Official format: "ASE DB compatible lmdb files (*.aselmdb)", with "total charge and spin multiplicity, saved in the `atoms.info` dictionary" ([fairchem omol25.md](https://github.com/facebookresearch/fairchem/blob/main/docs/molecules/datasets/omol25.md)). `atoms.info["source"]` is confirmed in [omol25_elec.md](https://github.com/facebookresearch/fairchem/blob/main/docs/molecules/datasets/omol25_elec.md).

The other key names are as they appear in ColabFit's `property_metadata` JSON. That this JSON copies the official `atoms.info` verbatim is likely but UNCONFIRMED, because `DATASET.md` is gated. The list of computed properties is in [arXiv v2 App. A.2](https://arxiv.org/html/2505.08762v2).

| Quantity | Official ASE-LMDB | ColabFit column | ColabFit `property_metadata` key | Notes |
|---|---|---|---|---|
| Positions (Å) | `Atoms.positions` | `positions` | – | ColabFit `cell` is all zeros, `pbc` is `[false,false,false]` |
| Elements | `Atoms.numbers` | `atomic_numbers`, `elements`, `chemical_formula_hill/_reduced/_anonymous`, `nsites` | `composition`, `num_atoms` | `atomic_numbers` is string-typed in the train_neutral schema |
| Energy (eV) | ASE energy | `energy` | `property_keys: {"energy":"energy"}` | Total energy, not referenced |
| Forces (eV/Å) | ASE forces | `atomic_forces`, `max_force_norm`, `mean_force_norm` | `property_keys: {"atomic-forces":"forces"}` | |
| Total charge | `atoms.info["charge"]` | **none** | `charge` | No charge column in ColabFit |
| Spin multiplicity | `atoms.info["spin"]` | `multiplicity` | `spin` | |
| Mulliken | – | – | `mulliken_charges`, `mulliken_spins` | Spins only when `unrestricted` is true; then present for singlets too |
| Löwdin | – | – | `lowdin_charges`, `lowdin_spins` | Same rule |
| NBO | – | – | `nbo_charges`, `nbo_spins` | Paper: "if the total number of atom <= 70". In samples the rule is loose: NBO present up to 165 atoms, and missing on some ≤70-atom electrolyte, OrbNet and metal rows. |
| Orbital data | – | – | `homo_energy`, `homo_lumo_gap` | Lists, α and β when unrestricted |
| SCF diagnostics | – | – | `s_squared`, `s_squared_dev`, `unrestricted`, `n_scf_steps`, `integrated_densities` (α, β, total), `nl_energy` (VV10), `n_basis`, `num_electrons`, `num_ecp_electrons`, `warnings` | |
| Method | – | `method` (`ωB97M-V`), `software` (`ORCA`) | `basis_set` (`def2-TZVPD`), `input` (`RI-J, COSX, DEFGRID3`) | |
| Provenance | `atoms.info["source"]` | `names` (e.g. `OMol25_validation_data0008_3532`), `dataset_id`, `configuration_id` | `data_id`, `source` (e.g. `spice/SPICE_Amino_Acid_Ligand_v1_0_spice_94Y_VAL_1_0_1/orca.tar.zst`), `reference_source` (null or `s3://opencatalysisdata/archive/hot/omol/`; meaning UNCONFIRMED) | `labels` and `configuration_metadata` were null in every sample. ColabFit adds `hash` and `id`. |
| Dipole / quadrupole | **not per-record** | – | – | Computed (`%elprop Dipole true Quadrupole true`) but "will be released in future versions" |
| Bond orders, connectivity, SMILES, InChI | **absent** | **absent** | **absent** | Checked in about 2,600 sampled rows across 4 conversions |

**ColabFit conversion details**

- [`OMol25_validation`](https://huggingface.co/datasets/colabfit/OMol25_validation), [`OMol25_train`](https://huggingface.co/datasets/colabfit/OMol25_train), [`OMol25_train_4M`](https://huggingface.co/datasets/colabfit/OMol25_train_4M) and [`OMol25_neutral_validation`](https://huggingface.co/datasets/colabfit/OMol25_neutral_validation) each have 42 columns, including the inline `property_metadata` JSON.
- [`OMol25_train_neutral`](https://huggingface.co/datasets/colabfit/OMol25_train_neutral) has **40 columns**. It has no `property_metadata` and no `configuration_metadata`, only `property_metadata_path` (e.g. `data/MD/4716/....json`), and those JSON files are not in the HF repo. In that split, charges, `data_id` and `source` are therefore not available inline. Charge 0 and spin 1 still hold by definition of the split.
- ColabFit lists only "energy, atomic forces" as its official properties ([Exchange page](https://materials.colabfit.org/id/DS_51sddg3b1bp1_0)).

## 3. Getting bond orders or connectivity from other releases

**OMol25 Electronic Structures** ([fairchem omol25_elec.md](https://github.com/facebookresearch/fairchem/blob/main/docs/molecules/datasets/omol25_elec.md), [MDF spotlight](https://www.materialsdatafacility.org/spotlight/omol25))

- Covers the 4M split only ("full dataset available on request"). About 500 TB, CC-BY-4.0.
- Access is through Globus after "group approval (this step requires human validation)".
- Files per calculation:
  - `orca.tar.zst`, containing `orca.out`, `orca.inp`, `orca.engrad`, `orca_property.txt`, `orca.xyz`
  - `orca.gbw.zstd0`
  - `density_mat.npz`, holding the `orca.scfp` and `orca.scfr` upper triangles
- Records map to Argonne paths through `os.path.dirname(atoms.info["source"])`.
- The docs say the outputs let users "parse NBO orbital/bonding information, reduced orbital populations, Fock matrices".

**What `orca.out` should contain** ([fairchem calc.py](https://github.com/facebookresearch/fairchem/blob/main/src/fairchem/data/omol/orca/calc.py))

- `ORCA_BLOCKS` includes `%output ... Print[P_BondOrder_L] 1 Print[P_BondOrder_M] 1 ...`, `ALLPOP`, and `NBO_FLAGS = '%nbo NBOKEYLIST = "$NBO NPA NBO E2PERT 0.1 $END" end'`.
- Under ORCA 6.0 defaults, `P_Mayer` is on, so Mayer bond orders are printed above a 0.1 threshold (`MAYER_BONDORDERTHRESH`). Löwdin bond orders print above 0.05 (`LOEWDIN_BONDORDERTHRESH`) ([ORCA 6.0 population](https://www.faccts.de/docs/orca/6.0/manual/contents/detailed/population.html), [ORCA 6.1 keyword table](https://www.faccts.de/docs/orca/6.1/manual/contents/spectroscopyproperties/population.html)).
- The NBO keylist has no `BNDIDX`, which is the keyword that prints the NAO-Wiberg bond index ([NBO manual](https://nbo.chem.wisc.edu/nboman.pdf)). So NBO should give a Lewis structure (BD orbitals) but probably no Wiberg index. UNCONFIRMED.
- Caveats:
  - fairchem labels this writer a "One-off method… Primarily used for debugging", so the exact production input for each record should be checked in `orca.inp` (UNCONFIRMED that every job matches).
  - Whether Mayer bond orders also appear in `orca_property.txt` is UNCONFIRMED.
- The GBW files and density matrices allow Mayer, Wiberg or NBO analysis to be recomputed after the fact.

**Upstream graphs reachable through `source`**

- SPICE groups store a `smiles` that is "canonical… includes explicit hydrogens and atom indices", with atoms ordered to match ([SPICE downloader README](https://github.com/openmm/spice-dataset/blob/main/downloader/README.md)).
- RGD1 publishes atom-mapped reaction SMILES ([RGD1](https://github.com/zhaoqy1996/RGD1)).
- OrbNet `source` names embed ChEMBL IDs; biomolecule names embed PDB and ZINC IDs (see the sampled `source` strings via the [rows API](https://datasets-server.huggingface.co/rows?dataset=colabfit/OMol25_validation&config=default&split=train&offset=0&length=100)).
- That OMol25 atom order matches the upstream order, and that the name-to-entry mapping is exact, are both UNCONFIRMED. OMol25 also re-ionised, protonated or perturbed many of these structures ([arXiv §2.4, App. I](https://arxiv.org/html/2505.08762v2)).
- The Architector molecular graphs and the electrolyte force-field topologies used during generation are not released per record (UNCONFIRMED; generation code was only promised for GitHub).

**Licensing and attribution**

- "The OMol25 dataset is provided under a CC-BY-4.0 license". Models use the FAIR Chemistry License. Access asks for "full legal name, date of birth, and full organization name" and is not available in China, Russia, Belarus or sanctioned jurisdictions ([HF card](https://huggingface.co/facebook/OMol25)).
- Cite Levine et al., arXiv:2505.08762 ([BibTeX in fairchem docs](https://github.com/facebookresearch/fairchem/blob/main/docs/molecules/datasets/omol25.md)).
- ColabFit mirrors carry their own DOIs, for example 10.60732/0d5818c5 for neutral validation ([HF](https://huggingface.co/datasets/colabfit/OMol25_neutral_validation)).

**Other derived HF datasets, none with bonds**

- [StructureCloud/OMol25](https://huggingface.co/datasets/StructureCloud/OMol25): `composition`, `charge`, `spin`, `data_id`, `natoms`, `energy_total_eV`, `energy_linref_eV`
- [28ii/OpenMetalAI-OMol25](https://huggingface.co/datasets/28ii/OpenMetalAI-OMol25): `formula`, `metals`, `multiplicity`, …
- [ameya98/OMol25-Index](https://huggingface.co/datasets/ameya98/OMol25-Index): h5 index files; contents UNCONFIRMED
- [Zatom-AI/omol25](https://huggingface.co/datasets/Zatom-AI/omol25): has `smiles.pt`. The (commented-out) generation code uses OpenBabel through `BabelMolAdaptor(...).pybel_mol.write("smi")` with no charge or spin passed in ([code](https://github.com/Zatom-AI/zatom/blob/main/zatom/data/joint_datamodule.py)).

## 4. How other tools draw OMol25 bonds

- **fairchem UMA demo** ([Space](https://huggingface.co/spaces/facebook/fairchem_uma_demo)). It uses `gradio_molecule3d`, which wraps 3Dmol.js, via `view.addModelsAsFrames(data, format, {keepH:true, multiModel:true})`. Styles are Jmol-coloured spheres at scale 0.3 plus sticks at 0.2 ([app.py](https://huggingface.co/spaces/facebook/fairchem_uma_demo/blob/main/app.py), [MolecularViewer.svelte](https://huggingface.co/spaces/facebook/fairchem_uma_demo/blob/main/gradio_molecule3d/frontend/shared/MolecularViewer.svelte)).
- **OrbMol demo**, with OMol25-trained models ([app.py](https://huggingface.co/spaces/hugging-science/orbmol/blob/main/app.py)). It writes `write(pdb_path, atoms, format="proteindatabank")` with no CONECT records and displays through the same 3Dmol.js component.
- **3Dmol.js rule** ([areConnected.ts](https://github.com/3dmol/3Dmol.js/blob/master/src/parsers/utils/areConnected.ts), [bondLength.ts](https://github.com/3dmol/3Dmol.js/blob/master/src/parsers/utils/bondLength.ts), [assignBonds.ts](https://github.com/3dmol/3Dmol.js/blob/master/src/parsers/utils/assignBonds.ts), [ParserOptionsSpec.ts](https://github.com/3dmol/3Dmol.js/blob/master/src/parsers/ParserOptionsSpec.ts)):
  - bonded when (r_A + r_B + 0.25 Å)² > d² and d² ≥ 0.5 Å²
  - covalent-radius table; elements missing from it (lanthanides, some others) default to 1.6 Å
  - every bond gets `bondOrder.push(1)`, so all bonds are single
  - an optional `unboundCations` flag stops Na, K, Ca, Mg, Mn and Sr from bonding
- **ColabFit Exchange and the HF Dataset Viewer:** a tabular viewer plus XYZ and Parquet downloads; I saw no bond rendering ([Exchange](https://materials.colabfit.org/id/DS_51sddg3b1bp1_0)).
- **Zatom-1:** OpenBabel SMILES, then RDKit and PoseBusters validity checks. The authors note it "is currently unclear whether using the default settings for RDKit and the PoseBusters… is an appropriate way of assessing non-equilibrium molecule validity" ([arXiv 2602.22251](https://arxiv.org/html/2602.22251)).
- **The OMol25 authors' own internal rules** ([arXiv v2 App. G–I](https://arxiv.org/html/2505.08762v2)):
  - covalent-radius multiples: isolated atom if > 1.8× the sum of covalent radii; colliding if < 0.55×
  - Architector bonding graphs
  - AFIR cutoffs: bond broken at 1.5 Å, formed at 1.2 Å
  - "a modified OpenBabel formal charge assignment scheme" for ligands

## 5. What this means for a bond strategy (evidence-based options)

1. **Default for every record: connectivity from distance.** Use covalent radii plus a tolerance, as 3Dmol.js and the OMol25 authors do. Two precedents to add: don't bond alkali or alkaline-earth cations (3Dmol's `unboundCations`), and fill radii for lanthanides, which 3Dmol simply defaults. Many structures are clusters or non-equilibrium snapshots, so intermolecular contacts and stretched bonds are expected.
2. **Bond orders for closed-shell organics: RDKit `DetermineBonds`, the xyz2mol algorithm.** Signature: `charge=0, covFactor=1.3, allowChargedFragments=True, useHueckel=False` ([wrapper source](https://github.com/rdkit/rdkit/blob/master/Code/GraphMol/DetermineBonds/Wrap/rdDetermineBonds.cpp)). Pass in OMol25's `charge`. It suits `spin==1` rows without metals; use connectivity alone when it fails.
3. **Quantum bond orders for metals, radicals and charged systems:**
   - Parse Mayer or Löwdin bond orders from `orca.out` (4M split, needs Argonne access).
   - Or compute GFN2-xTB Wiberg bond orders (`--wbo`, which prints orders >0.10) ([xtb docs](https://xtb-docs.readthedocs.io/en/latest/properties.html)), using the record's charge and spin. Architector's metal complexes were themselves xTB-optimised ([arXiv §2.2.1](https://arxiv.org/html/2505.08762v2)).
4. **Opportunistically, upstream SMILES:** for `spice` and `rgd` rows, through `source`. The mapping is UNCONFIRMED.
5. **Mark bond provenance in the UI** ("inferred from geometry", "xyz2mol", "DFT Mayer bond order"), because OMol25 itself never asserts bonds.