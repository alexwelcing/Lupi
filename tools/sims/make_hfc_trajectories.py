#!/usr/bin/env python3
"""
make_hfc_trajectories.py — regenerate the HFC refrigerant research
collection (apps/web/public/gallery/research/hfc) from first principles.

Runs genuine LAMMPS molecular dynamics on the R32 (difluoromethane) and
R125 (pentafluoroethane) liquid boxes published by the Maginn Group for
their HFC force-field validation study, reproducing the published setup:

    units real · atom_style full · lj/cut/coul/long 12.0
    pair_modify tail yes, mix arithmetic · harmonic bonds/angles
    charmm dihedrals (R125) · PPPM 1e-4 · NVT 273 K (Nose-Hoover)

and emits the three payload kinds a researcher actually produces:

  1. .lammpstrj dump with the full per-atom research payload
     (id mol type q x y z vx vy vz fx fy fz c_pe c_ke) — the input to
     the viewer's vector-glyph and energy-coloring modes
  2. thermo table in the study's Output_*.txt dialect (fix print,
     "Step V Dens T P KE PE U H")
  3. fix ave/chunk spatial temperature profile (temp_profile dialect)

Starting configurations are fetched from the study's repository at run
time (they carry no explicit license, so they are not committed here —
only our derived simulation outputs are, with provenance manifests).

Provenance:
  repo:  https://github.com/MaginnGroup/Validation-of-HFC-FFs
  paper: Digital Discovery, DOI 10.1039/D5DD00537J

Usage:
  pip install lammps            # PyPI wheel (needs libmpich12 on Linux)
  python3 tools/sims/make_hfc_trajectories.py all
  python3 tools/sims/make_hfc_trajectories.py r32 --smoke   # 100-step sanity run

Then bake for the gallery:
  npx -y tsx tools/bake-glimbin.mjs <out>/r32_nvt_273K.lammpstrj --out-dir <dir>
"""

import argparse
import json
import os
import time
import urllib.request

KB_REAL = 0.0019872067  # Boltzmann constant, kcal/mol/K

UPSTREAM_RAW = (
    "https://raw.githubusercontent.com/MaginnGroup/Validation-of-HFC-FFs/main/"
    "LAMMPS%20NPT%20Input%20Data%20Files/"
)

SYSTEMS = {
    "r32": {
        "data": "R32_v52_2000mol.data",
        "note": "2000 CH2F2 molecules, v52 (paper version 'a') parameterization",
    },
    "r125": {
        "data": "R125_v7_1000mol.data",
        "note": "1000 C2HF5 molecules, v7 (paper version 'd') parameterization",
    },
}


def fetch_data_file(name: str, cache_dir: str) -> str:
    os.makedirs(cache_dir, exist_ok=True)
    local = os.path.join(cache_dir, name)
    if not os.path.exists(local):
        url = UPSTREAM_RAW + name
        print(f"[fetch] {url}")
        urllib.request.urlretrieve(url, local)
    return local


def run(system: str, data_file: str, out_dir: str, steps: int, dump_every: int,
        equil_steps: int, temp: float = 273.0, smoke: bool = False) -> None:
    from lammps import lammps

    os.makedirs(out_dir, exist_ok=True)
    name = f"{system}_nvt_{int(temp)}K" + ("_smoke" if smoke else "")
    traj = os.path.join(out_dir, f"{name}.lammpstrj")
    thermo_file = os.path.join(out_dir, f"{name}_thermo.txt")
    profile_file = os.path.join(out_dir, f"{name}_temp_profile.txt")
    log_file = os.path.join(out_dir, f"{name}.log")

    with open(data_file) as f:
        has_dihedrals = "dihedral types" in f.read(2000)

    threads = str(min(os.cpu_count() or 1, 8))
    l = lammps(cmdargs=["-log", log_file, "-nocite", "-sf", "omp", "-pk", "omp", threads])
    cmds = f"""
units           real
atom_style      full
boundary        p p p
pair_style      lj/cut/coul/long 12.0
bond_style      harmonic
angle_style     harmonic
{"dihedral_style  charmm" if has_dihedrals else ""}
pair_modify     tail yes
pair_modify     mix arithmetic
read_data       {data_file}
kspace_style    pppm 1.0e-4
neighbor        2.0 bin
neigh_modify    delay 0 every 2 check yes
timestep        1.0
min_style       cg
minimize        1e-4 1e-6 {50 if smoke else 200} 1000
velocity        all create {temp} 886874 mom yes rot yes dist gaussian
fix             nvt all nvt temp {temp} {temp} 100.0
run             {0 if smoke else equil_steps}

compute         peatom all pe/atom
compute         keatom all ke/atom
variable        temp atom c_keatom/(1.5*{KB_REAL})

thermo_style    custom step temp pe ke etotal press vol density
thermo          {dump_every}

dump            d1 all custom {dump_every} {traj} id mol type q x y z vx vy vz fx fy fz c_peatom c_keatom
dump_modify     d1 sort id first yes

variable        s equal step
variable        V equal vol
variable        Dens equal density
variable        T equal temp
variable        P equal press
variable        KE equal ke
variable        PE equal pe
variable        U equal etotal
variable        H equal enthalpy
fix             thermoprint all print {dump_every} "${{s}} ${{V}} ${{Dens}} ${{T}} ${{P}} ${{KE}} ${{PE}} ${{U}} ${{H}}" file {thermo_file} title "Step V Dens T P KE PE U H" screen no

compute         chunkz all chunk/atom bin/1d z lower 0.05 units reduced
fix             tprof all ave/chunk {max(1, dump_every // 10)} 10 {dump_every} chunkz v_temp file {profile_file}

run             {steps}
"""
    t0 = time.time()
    for line in cmds.strip().splitlines():
        line = line.strip()
        if line:
            l.command(line)
    dt = time.time() - t0
    natoms = l.get_natoms()
    version = l.version()
    l.close()

    manifest = {
        "system": system,
        "source_data": os.path.basename(data_file),
        "provenance": {
            "repo": "https://github.com/MaginnGroup/Validation-of-HFC-FFs",
            "paper_doi": "10.1039/D5DD00537J",
            "note": SYSTEMS[system]["note"],
        },
        "force_field": {
            "pair_style": "lj/cut/coul/long 12.0", "kspace": "pppm 1.0e-4",
            "mixing": "arithmetic", "tail": True,
            "bond": "harmonic", "angle": "harmonic",
            "dihedral": "charmm" if has_dihedrals else None,
        },
        "ensemble": f"NVT {temp} K (Nose-Hoover, 100 fs damp), {equil_steps} steps equilibration",
        "timestep_fs": 1.0, "steps": steps, "dump_every": dump_every,
        "natoms": natoms, "wall_seconds": round(dt, 1),
        "lammps_version": version,
        "dump_columns": "id mol type q x y z vx vy vz fx fy fz c_peatom c_keatom",
    }
    with open(os.path.join(out_dir, f"{name}.manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[{system}] {natoms} atoms, {steps} steps in {dt:.0f}s -> {traj}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("system", choices=[*SYSTEMS.keys(), "all"])
    ap.add_argument("--smoke", action="store_true", help="100-step pipeline sanity run")
    ap.add_argument("--out", default="tools/sims/output/hfc")
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--dump-every", type=int, default=50)
    ap.add_argument("--equil-steps", type=int, default=1000)
    a = ap.parse_args()

    cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".hfc-inputs")
    names = list(SYSTEMS.keys()) if a.system == "all" else [a.system]
    for system in names:
        data = fetch_data_file(SYSTEMS[system]["data"], cache)
        if a.smoke:
            run(system, data, a.out, steps=100, dump_every=50, equil_steps=0, smoke=True)
        else:
            run(system, data, a.out, steps=a.steps, dump_every=a.dump_every, equil_steps=a.equil_steps)


if __name__ == "__main__":
    main()
