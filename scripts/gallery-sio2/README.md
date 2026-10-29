# Gallery amorphous silica (`sio2_glass`)

`apps/web/public/gallery/sio2_glass_24k.lammpstrj` (extended XYZ despite the
name; kept for its links) was made with LAMMPS 22 Jul 2025 and the Vashishta
et al. 1990 SiO₂ potential (`SiO.1990.vashishta`, shipped with LAMMPS):

1. `quench.in`: 4,000 Si and 8,000 O placed at random in a 2.20 g/cm³ cube,
   melted at 5000 K for 15 ps, quenched to 300 K in 50 ps, relaxed at zero
   pressure (the 1990 potential over-densifies there, to 2.45 g/cm³).
2. `density.in`: scaled back to 2.20 g/cm³, annealed at 300 K for 5 ps,
   minimised.

Result: Si–O 1.62 Å, O–Si–O 109.6°, Si–O–Si 146°, 96% of Si four-coordinated,
97.6% of O bridging. About 45 minutes on 4 cores (`pip install lammps mpich`).
