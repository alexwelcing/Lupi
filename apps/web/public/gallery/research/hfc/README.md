# HFC refrigerant research collection (R32 / R125)

Genuine LAMMPS molecular-dynamics outputs for the hydrofluorocarbon
refrigerants **R32 (difluoromethane, CH₂F₂)** and **R125 (pentafluoroethane,
C₂HF₅)**, generated with the force fields and starting configurations
published by the Maginn Group (University of Notre Dame) for their HFC
force-field validation study.

## Provenance

- Force fields, topologies, and equilibrated starting configurations:
  [MaginnGroup/Validation-of-HFC-FFs](https://github.com/MaginnGroup/Validation-of-HFC-FFs)
  (R32 `v52` and R125 `v7` parameterizations; no explicit license — used
  here with attribution for format-compatibility demonstration).
- Paper: *Development of accurate transferable hydrofluorocarbon
  refrigerant force fields using a machine learning and optimization
  approach*, Digital Discovery (RSC), DOI:
  [10.1039/D5DD00537J](https://doi.org/10.1039/D5DD00537J).
- Simulations re-run for this collection with LAMMPS (22 Jul 2025, PyPI
  wheel) via `tools/sims/make_hfc_trajectories.py` — see each
  `*.sim-manifest.json` for the exact force-field setup, ensemble, and
  timestep provenance.

## Files

| file | contents |
| --- | --- |
| `r32_nvt_273K.glimbin` | 10,000 atoms (2000 R32 molecules), 61 frames @ 50 fs, NVT 273 K. Full research payload per atom: charge, velocity, force, per-atom PE/KE (`q vx vy vz fx fy fz c_peatom c_keatom`). |
| `r125_nvt_273K.glimbin` | 8,000 atoms (1000 R125 molecules), 31 frames @ 100 fs, NVT 273 K, same payload. |
| `*_thermo.txt` | thermo time series in the study's `Output_*.txt` dialect (`Step V Dens T P KE PE U H`). |
| `*_temp_profile.txt` | `fix ave/chunk` spatial temperature profile (20 z-bins per snapshot), the thermal-conductivity study's format. |
| `*.sim-manifest.json` | full generation provenance. |

The per-atom force/velocity/energy columns are what drive the viewer's
vector-glyph and energy-coloring modes; the sidecar tables drive the
telemetry sparklines and the spatial-profile replay.
