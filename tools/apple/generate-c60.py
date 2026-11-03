#!/usr/bin/env python3
"""Write Lupi's illustrative C60 geometry using only the Python standard library.

This is a regular truncated icosahedron with uniform 1.42 A edges, not an
experimental structure, DFT result, or downloaded molecular conformer.
Run this before bundle-starters.mts and bundle-known.mts. --check is read-only.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "apps/web/public/gallery/curated/c60_buckyball.xyz"
EDGE_A = 1.42


def distance(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def coordinates():
    phi = (1 + math.sqrt(5)) / 2
    vertices = sorted({
        p
        for sign in (-1, 1)
        for other in (-1, 1)
        for p in ((0.0, sign, other * phi),
                  (other * phi, 0.0, sign), (sign, other * phi, 0.0))
    })
    edges = [(i, j) for i in range(12) for j in range(i + 1, 12)
             if math.isclose(distance(vertices[i], vertices[j]), 2.0, abs_tol=1e-12)]
    assert len(vertices) == 12 and len(edges) == 30
    directed = sorted([(i, j) for i, j in edges] + [(j, i) for i, j in edges])
    # Truncating at one third makes every new edge 2/3 in these units.
    scale = EDGE_A / (2 / 3)
    return [tuple((2 * a + b) / 3 * scale for a, b in zip(vertices[i], vertices[j]))
            for i, j in directed]


def face_cycles(adjacency, size):
    """Independently enumerate chordless pentagons/hexagons by adjacency."""
    cycles = set()

    def visit(path):
        if len(path) == size:
            if path[0] not in adjacency[path[-1]]:
                return
            # A face boundary has no edge joining nonconsecutive vertices.
            for i in range(size):
                for j in range(i + 1, size):
                    if j != i + 1 and (i, j) != (0, size - 1):
                        if path[j] in adjacency[path[i]]:
                            return
            reverse = (path[0], *reversed(path[1:]))
            cycles.add(min(tuple(path), reverse))
            return
        for nxt in sorted(adjacency[path[-1]]):
            if nxt > path[0] and nxt not in path:
                visit([*path, nxt])

    for start in range(len(adjacency)):
        visit([start])
    return sorted(cycles)


def validate(points):
    assert len(points) == 60 and len(set(points)) == 60
    assert all(math.isfinite(v) for point in points for v in point)
    pairs = [(i, j, distance(points[i], points[j]))
             for i in range(60) for j in range(i + 1, 60)]
    edges = [(i, j) for i, j, d in pairs if abs(d - EDGE_A) < 2e-6]
    adjacency = [set() for _ in points]
    for i, j in edges:
        adjacency[i].add(j)
        adjacency[j].add(i)
    assert len(edges) == 90 and all(len(neighbours) == 3 for neighbours in adjacency)
    seen, pending = {0}, [0]
    while pending:
        for nxt in adjacency[pending.pop()] - seen:
            seen.add(nxt)
            pending.append(nxt)
    assert len(seen) == 60
    assert min(d for _, _, d in pairs) >= EDGE_A - 2e-6
    expected_radius = EDGE_A * math.sqrt(58 + 18 * math.sqrt(5)) / 4
    radii = [math.sqrt(sum(v * v for v in p)) for p in points]
    assert max(abs(r - expected_radius) for r in radii) < 2e-6
    assert all(abs(sum(p[axis] for p in points) / 60) < 1e-8 for axis in range(3))
    pentagons, hexagons = face_cycles(adjacency, 5), face_cycles(adjacency, 6)
    assert len(pentagons) == 12 and len(hexagons) == 20
    incidences = {edge: 0 for edge in edges}
    for face in [*pentagons, *hexagons]:
        for a, b in zip(face, face[1:] + face[:1]):
            incidences[tuple(sorted((a, b)))] += 1
    assert all(count == 2 for count in incidences.values())
    assert len(points) - len(edges) + len(pentagons) + len(hexagons) == 2
    edge_set = set(edges)
    return {
        "atoms": 60, "element": "C", "charge": 0, "finiteDistinctCoordinates": True,
        "edges": 90, "degree": 3, "connected": True,
        "edgeLengthA": EDGE_A,
        "edgeLengthRangeA": [min(d for i, j, d in pairs if (i, j) in edge_set),
                             max(d for i, j, d in pairs if (i, j) in edge_set)],
        "minimumNonbondedDistanceA": min(d for i, j, d in pairs if (i, j) not in edge_set),
        "radiusRangeA": [min(radii), max(radii)],
        "pentagons": len(pentagons), "hexagons": len(hexagons),
        "eachEdgeBordersTwoFaces": True, "eulerCharacteristic": 2,
    }


def render_xyz(points):
    def fixed(value):
        return "0.000000" if abs(value) < 0.0000005 else f"{value:.6f}"

    return "\n".join([
        "60",
        "Buckminsterfullerene | source=lupi-procedural | generator=tools/apple/generate-c60.py "
        "| geometry=regular-truncated-icosahedron | uniform_edge_A=1.42 | charge=0 "
        "| pubchem_cid=123591 | cid_role=compound-identity-only | model=illustrative-not-DFT-or-source-conformer",
        *("C " + " ".join(fixed(v) for v in p) for p in points), "",
    ])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    points = coordinates()
    validate(points)
    text = render_xyz(points)
    # Validate the actual rounded XYZ values that will ship, too.
    rounded = [tuple(float(v) for v in line.split()[1:]) for line in text.splitlines()[2:]]
    receipt = {"schema": "lupi.procedural-c60.v1", "generator": "tools/apple/generate-c60.py",
               "model": "illustrative regular truncated icosahedron; no DFT or source conformer",
               "compoundIdentityPubChemCID": 123591,
               "sha256": hashlib.sha256(text.encode()).hexdigest(), **validate(rounded)}
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != text:
            raise SystemExit("C60 source is stale; run python3 tools/apple/generate-c60.py")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(text)
    if args.receipt:
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
