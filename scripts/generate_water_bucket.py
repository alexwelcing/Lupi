"""Generate "This is Water": a bucket's worth of H2O molecules in continuous,
seamlessly looping motion.

Every molecule keeps a real O-H bond length (0.9572 A) and H-O-H angle
(104.5 deg). Motion is procedural kinematics, not a force-field integration:
each molecule jiggles and tumbles on its own phase, the whole cluster sways
like liquid sloshing in a container, and a slow collective swirl turns the
bucket. All motion terms are integer harmonics of one shared period, so frame
0 and the (implicit) frame FRAMES are identical -- looping the trajectory
never jumps.

Output: apps/web/public/gallery/this_is_water.lammpstrj
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "web" / "public" / "gallery"
OUT.mkdir(parents=True, exist_ok=True)

rng = np.random.default_rng(20260701)

N_MOLECULES = 150
FRAMES = 120
BOND_OH = 0.9572
ANGLE_HOH = math.radians(104.5)

# Fill region: a squat cylinder standing in for a bucket of liquid water.
R_FILL = 11.0
Y_MIN, Y_MAX = -5.5, 4.0
MIN_DIST = 2.6

# Motion amplitudes (Angstrom / radians). Kept small relative to MIN_DIST so
# independent per-molecule jiggle can't collapse two molecules into each other.
JIGGLE_AMP = 0.35
SLOSH_AMP = 0.9
STIR_AMP = 0.28
ROT_AMP = 0.55


def place_molecules(n: int) -> np.ndarray:
    """Rejection-sample O positions inside the fill cylinder with a minimum
    pairwise separation, so molecules read as distinct in the render."""
    placed: list[np.ndarray] = []
    attempts = 0
    max_attempts = n * 400
    while len(placed) < n and attempts < max_attempts:
        attempts += 1
        r = R_FILL * math.sqrt(rng.random())
        theta = rng.random() * 2 * math.pi
        x = r * math.cos(theta)
        z = r * math.sin(theta)
        y = Y_MIN + rng.random() * (Y_MAX - Y_MIN)
        candidate = np.array([x, y, z])
        if all(np.linalg.norm(candidate - p) >= MIN_DIST for p in placed):
            placed.append(candidate)
    if len(placed) < n:
        raise RuntimeError(
            f"only placed {len(placed)}/{n} molecules; loosen MIN_DIST or grow R_FILL"
        )
    return np.array(placed)


def random_orthonormal_pair() -> tuple[np.ndarray, np.ndarray]:
    v = rng.standard_normal(3)
    v /= np.linalg.norm(v)
    u = rng.standard_normal(3)
    u -= u.dot(v) * v
    u /= np.linalg.norm(u)
    return v, u


def rotate_about_axis(vec: np.ndarray, axis: np.ndarray, angle: float) -> np.ndarray:
    """Rodrigues' rotation formula."""
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    return (
        vec * cos_a
        + np.cross(axis, vec) * sin_a
        + axis * (axis.dot(vec)) * (1 - cos_a)
    )


def build_molecules(n: int):
    bases = place_molecules(n)
    mols = []
    for O_base in bases:
        v, u = random_orthonormal_pair()
        half = ANGLE_HOH / 2
        dH1 = (math.cos(half) * v + math.sin(half) * u) * BOND_OH
        dH2 = (math.cos(half) * v - math.sin(half) * u) * BOND_OH
        wag_axis = np.cross(v, u)
        wag_axis /= np.linalg.norm(wag_axis)
        mols.append({
            "O_base": O_base,
            "dH1": dH1,
            "dH2": dH2,
            "wag_axis": wag_axis,
            "kx": rng.integers(1, 4),
            "ky": rng.integers(1, 4),
            "kz": rng.integers(1, 4),
            "k_rot": rng.integers(1, 3),
            "phix": rng.random() * 2 * math.pi,
            "phiy": rng.random() * 2 * math.pi,
            "phiz": rng.random() * 2 * math.pi,
            "phi_rot": rng.random() * 2 * math.pi,
            "amp": JIGGLE_AMP * rng.uniform(0.8, 1.2),
        })
    return mols


def frame_coords(mols, t: float) -> np.ndarray:
    """t in [0, 1); returns (3n, 3) array of O, H, H, O, H, H, ... positions."""
    stir_theta = STIR_AMP * math.sin(2 * math.pi * t)
    stir_cos, stir_sin = math.cos(stir_theta), math.sin(stir_theta)
    slosh_x = SLOSH_AMP * math.sin(2 * math.pi * t)
    slosh_z = SLOSH_AMP * 0.6 * math.cos(2 * math.pi * t)

    coords = []
    for m in mols:
        Ob = m["O_base"]
        height_frac = min(1.0, max(0.0, (Ob[1] - Y_MIN) / (Y_MAX - Y_MIN)))

        jitter = np.array([
            m["amp"] * math.sin(2 * math.pi * t * m["kx"] + m["phix"]),
            m["amp"] * 0.6 * math.sin(2 * math.pi * t * m["ky"] + m["phiy"]),
            m["amp"] * math.sin(2 * math.pi * t * m["kz"] + m["phiz"]),
        ])
        slosh = np.array([slosh_x * height_frac, 0.0, slosh_z * height_frac])
        pos = Ob + jitter + slosh

        # Collective swirl about the vertical axis through the bucket centre.
        x, z = pos[0], pos[2]
        pos = np.array([
            x * stir_cos - z * stir_sin,
            pos[1],
            x * stir_sin + z * stir_cos,
        ])

        chi = ROT_AMP * math.sin(2 * math.pi * t * m["k_rot"] + m["phi_rot"])
        dH1 = rotate_about_axis(m["dH1"], m["wag_axis"], chi)
        dH2 = rotate_about_axis(m["dH2"], m["wag_axis"], chi)

        coords.append(pos)
        coords.append(pos + dH1)
        coords.append(pos + dH2)
    return np.array(coords)


def write_frame(f, step: int, box: tuple[float, float, float], coords: np.ndarray, types: np.ndarray):
    n = len(coords)
    f.write("ITEM: TIMESTEP\n")
    f.write(f"{step}\n")
    f.write("ITEM: NUMBER OF ATOMS\n")
    f.write(f"{n}\n")
    f.write("ITEM: BOX BOUNDS pp pp pp\n")
    half_x, half_y, half_z = box
    f.write(f"{-half_x:.4f} {half_x:.4f}\n")
    f.write(f"{Y_MIN - half_y:.4f} {Y_MAX + half_y:.4f}\n")
    f.write(f"{-half_z:.4f} {half_z:.4f}\n")
    f.write("ITEM: ATOMS id type x y z\n")
    for i in range(n):
        c = coords[i]
        f.write(f"{i + 1} {int(types[i])} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")


def main():
    mols = build_molecules(N_MOLECULES)
    n_atoms = N_MOLECULES * 3
    types = np.tile(np.array([8, 1, 1]), N_MOLECULES)
    box = (R_FILL + 3.0, 3.0, R_FILL + 3.0)

    fname = OUT / "this_is_water.lammpstrj"
    with open(fname, "w") as f:
        for step in range(FRAMES):
            t = step / FRAMES
            coords = frame_coords(mols, t)
            write_frame(f, step, box, coords, types)

    print(f"wrote {fname.relative_to(ROOT)}: {n_atoms} atoms x {FRAMES} frames "
          f"({N_MOLECULES} H2O molecules)")


if __name__ == "__main__":
    main()
