use crate::types::Frame;
use serde_wasm_bindgen;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

/// Standard atomic masses (amu), indexed so atomic number = index + 1.
/// LAMMPS data files carry opaque numeric atom types, but the scene colors
/// and sizes atoms by atomic number (the XYZ parser's convention) — matching
/// each type's mass against this table recovers the chemistry.
const ELEMENTS: [(&str, f64); 92] = [
    ("H", 1.008),
    ("He", 4.0026),
    ("Li", 6.94),
    ("Be", 9.0122),
    ("B", 10.811),
    ("C", 12.011),
    ("N", 14.007),
    ("O", 15.999),
    ("F", 18.998),
    ("Ne", 20.180),
    ("Na", 22.990),
    ("Mg", 24.305),
    ("Al", 26.982),
    ("Si", 28.085),
    ("P", 30.974),
    ("S", 32.06),
    ("Cl", 35.45),
    ("Ar", 39.948),
    ("K", 39.098),
    ("Ca", 40.078),
    ("Sc", 44.956),
    ("Ti", 47.867),
    ("V", 50.942),
    ("Cr", 51.996),
    ("Mn", 54.938),
    ("Fe", 55.845),
    ("Co", 58.933),
    ("Ni", 58.693),
    ("Cu", 63.546),
    ("Zn", 65.38),
    ("Ga", 69.723),
    ("Ge", 72.630),
    ("As", 74.922),
    ("Se", 78.971),
    ("Br", 79.904),
    ("Kr", 83.798),
    ("Rb", 85.468),
    ("Sr", 87.62),
    ("Y", 88.906),
    ("Zr", 91.224),
    ("Nb", 92.906),
    ("Mo", 95.95),
    ("Tc", 98.0),
    ("Ru", 101.07),
    ("Rh", 102.91),
    ("Pd", 106.42),
    ("Ag", 107.87),
    ("Cd", 112.41),
    ("In", 114.82),
    ("Sn", 118.71),
    ("Sb", 121.76),
    ("Te", 127.60),
    ("I", 126.90),
    ("Xe", 131.29),
    ("Cs", 132.91),
    ("Ba", 137.33),
    ("La", 138.91),
    ("Ce", 140.12),
    ("Pr", 140.91),
    ("Nd", 144.24),
    ("Pm", 145.0),
    ("Sm", 150.36),
    ("Eu", 151.96),
    ("Gd", 157.25),
    ("Tb", 158.93),
    ("Dy", 162.50),
    ("Ho", 164.93),
    ("Er", 167.26),
    ("Tm", 168.93),
    ("Yb", 173.05),
    ("Lu", 174.97),
    ("Hf", 178.49),
    ("Ta", 180.95),
    ("W", 183.84),
    ("Re", 186.21),
    ("Os", 190.23),
    ("Ir", 192.22),
    ("Pt", 195.08),
    ("Au", 196.97),
    ("Hg", 200.59),
    ("Tl", 204.38),
    ("Pb", 207.2),
    ("Bi", 208.98),
    ("Po", 209.0),
    ("At", 210.0),
    ("Rn", 222.0),
    ("Fr", 223.0),
    ("Ra", 226.0),
    ("Ac", 227.0),
    ("Th", 232.04),
    ("Pa", 231.04),
    ("U", 238.03),
];

/// Nearest standard element by mass, accepted only within ±0.5 amu so
/// coarse-grained / united-atom masses fall through to the label fallback.
fn element_from_mass(mass: f64) -> Option<i32> {
    let mut best: Option<(usize, f64)> = None;
    for (i, (_, m)) in ELEMENTS.iter().enumerate() {
        let diff = (mass - m).abs();
        if best.map_or(true, |(_, d)| diff < d) {
            best = Some((i, diff));
        }
    }
    best.filter(|&(_, d)| d <= 0.5).map(|(i, _)| i as i32 + 1)
}

/// Combine the mass and label signals for one Masses row.
///
/// Neither wins unconditionally: a united-atom CH2 pseudo-mass (14.026)
/// sits within 0.5 amu of nitrogen, so mass-first would paint a polymer
/// backbone as N; but GAFF's aromatic-carbon label "ca" symbol-matches
/// calcium, so label-first would paint benzene as Ca. The tiebreak is a
/// consistency window: trust the label iff the file mass is plausible for
/// that element — between (element − 0.5) and (element + 4.6), i.e. the
/// element itself plus up to ~4 implicit hydrogens, the united-atom
/// convention. Otherwise the label is just a type name that happens to
/// start with a symbol, and the nearest standard mass wins.
fn resolve_element(mass: f64, label: Option<&str>) -> Option<i32> {
    let by_label = label.and_then(element_from_label);
    if let Some(le) = by_label {
        let label_mass = ELEMENTS[(le - 1) as usize].1;
        if mass >= label_mass - 0.5 && mass <= label_mass + 4.6 {
            return Some(le);
        }
    }
    element_from_mass(mass).or(by_label)
}

/// Resolve a Masses comment label like "c3", "h2", "ow", "cl1" to an element.
/// Force-field type names prefix the element symbol, so match the leading
/// alphabetic run case-insensitively — two letters first ("cl" → Cl) so
/// chlorine isn't misread as carbon, then one.
fn element_from_label(label: &str) -> Option<i32> {
    let first = label.split_whitespace().next()?;
    let alpha: String = first
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    for len in [2usize, 1] {
        if alpha.len() >= len {
            let cand = &alpha[..len];
            if let Some(pos) = ELEMENTS
                .iter()
                .position(|(sym, _)| sym.eq_ignore_ascii_case(cand))
            {
                return Some(pos as i32 + 1);
            }
        }
    }
    None
}

/// Split a data line at its trailing '# ...' comment. Real research files
/// annotate Masses/Atoms/Bonds/Velocities lines with type names — the
/// comment must not be tokenized with the data, but Masses needs it kept
/// as the element-label fallback.
fn split_comment(line: &str) -> (&str, Option<&str>) {
    match line.find('#') {
        Some(i) => (line[..i].trim_end(), Some(line[i + 1..].trim())),
        None => (line, None),
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum AtomStyle {
    Atomic,
    Charge,
    Full,
    Molecular,
}

/// LAMMPS `write_data` stamps the style on the section line ("Atoms # full");
/// honoring it beats any token-count guess (charge vs molecular are both six
/// columns, image flags add three more).
fn style_from_hint(comment: &str) -> Option<AtomStyle> {
    match comment.split_whitespace().next()? {
        s if s.eq_ignore_ascii_case("full") => Some(AtomStyle::Full),
        s if s.eq_ignore_ascii_case("charge") => Some(AtomStyle::Charge),
        s if s.eq_ignore_ascii_case("molecular") => Some(AtomStyle::Molecular),
        s if s.eq_ignore_ascii_case("atomic") => Some(AtomStyle::Atomic),
        _ => None,
    }
}

/// Token-count heuristic for unhinted files (pre-existing behavior):
/// 7+ columns reads as full, exactly 6 as charge, else atomic.
fn style_from_token_count(ntokens: usize) -> AtomStyle {
    if ntokens >= 7 {
        AtomStyle::Full
    } else if ntokens == 6 {
        AtomStyle::Charge
    } else {
        AtomStyle::Atomic
    }
}

/// Parse a LAMMPS data file (read_data format).
/// Extracts atom coordinates, types, bond topology, masses (with element
/// remapping), velocities, and triclinic tilt.
#[wasm_bindgen(js_name = "parseDataFile")]
pub fn parse_data_file(content: &str) -> Result<JsValue, JsError> {
    let frame = parse_data_internal(content).map_err(|e| JsError::new(&e))?;
    serde_wasm_bindgen::to_value(&frame).map_err(|e| JsError::new(&e.to_string()))
}

fn parse_data_internal(content: &str) -> Result<Frame, String> {
    let mut lines = content
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'));

    let _title = lines.next().unwrap_or("LAMMPS Data");

    let mut natoms_hint = 0usize;
    let mut box_bounds = [0.0f64; 6];
    let mut box_tilt = [0.0f64; 3];

    #[derive(Clone, Copy, PartialEq)]
    enum Section {
        Header,
        Atoms,
        Bonds,
        Masses,
        Velocities,
        Skip,
    }

    let mut current_section = Section::Header;
    let mut style_hint: Option<AtomStyle> = None;

    let mut atoms_lines: Vec<&str> = Vec::new();
    let mut bonds_lines: Vec<&str> = Vec::new();
    let mut velocities_lines: Vec<&str> = Vec::new();
    let mut masses_lines: Vec<(&str, Option<&str>)> = Vec::new();

    for raw in lines {
        let (body, comment) = split_comment(raw);
        let body = body.trim();
        if body.is_empty() {
            continue;
        }

        // Section keyword lines are the only alphabetic-leading lines outside
        // comments; every header stat line starts with a number. Unknown
        // sections (Pair Coeffs, Angles, ...) must switch to Skip so their
        // numeric rows aren't swallowed by the previous section.
        if body.chars().next().map_or(false, |c| c.is_alphabetic()) {
            current_section = if body.starts_with("Atoms") {
                style_hint = comment.and_then(style_from_hint);
                Section::Atoms
            } else if body.starts_with("Bonds") {
                Section::Bonds
            } else if body.starts_with("Masses") {
                Section::Masses
            } else if body.starts_with("Velocities") {
                Section::Velocities
            } else {
                Section::Skip
            };
            continue;
        }

        match current_section {
            Section::Header => {
                if body.ends_with(" atoms") {
                    natoms_hint = body.split_whitespace().next().unwrap().parse().unwrap_or(0);
                } else if body.ends_with("xlo xhi") {
                    let parts: Vec<&str> = body.split_whitespace().collect();
                    box_bounds[0] = parts[0].parse().unwrap_or(0.0);
                    box_bounds[1] = parts[1].parse().unwrap_or(0.0);
                } else if body.ends_with("ylo yhi") {
                    let parts: Vec<&str> = body.split_whitespace().collect();
                    box_bounds[2] = parts[0].parse().unwrap_or(0.0);
                    box_bounds[3] = parts[1].parse().unwrap_or(0.0);
                } else if body.ends_with("zlo zhi") {
                    let parts: Vec<&str> = body.split_whitespace().collect();
                    box_bounds[4] = parts[0].parse().unwrap_or(0.0);
                    box_bounds[5] = parts[1].parse().unwrap_or(0.0);
                } else if body.ends_with("xy xz yz") {
                    let parts: Vec<&str> = body.split_whitespace().collect();
                    box_tilt[0] = parts[0].parse().unwrap_or(0.0);
                    box_tilt[1] = parts[1].parse().unwrap_or(0.0);
                    box_tilt[2] = parts[2].parse().unwrap_or(0.0);
                }
            }
            Section::Atoms => atoms_lines.push(body),
            Section::Bonds => bonds_lines.push(body),
            Section::Masses => masses_lines.push((body, comment)),
            Section::Velocities => velocities_lines.push(body),
            Section::Skip => {}
        }
    }

    if atoms_lines.is_empty() {
        return Err("No Atoms section found in data file".to_string());
    }

    let triclinic = box_tilt.iter().any(|&t| t != 0.0);

    // ── Masses: type id → element atomic number ──
    // Primary: nearest standard mass; fallback: force-field label comment.
    let mut type_to_element: HashMap<i32, Option<i32>> = HashMap::new();
    for (body, comment) in masses_lines {
        let parts: Vec<&str> = body.split_whitespace().collect();
        if parts.len() >= 2 {
            let type_id: i32 = match parts[0].parse() {
                Ok(t) => t,
                Err(_) => continue,
            };
            let mass: f64 = parts[1].parse().unwrap_or(0.0);
            let element = resolve_element(mass, comment);
            type_to_element.insert(type_id, element);
        }
    }

    // ── Atoms ──
    // atomic:    atom-ID atom-type x y z
    // charge:    atom-ID atom-type q x y z
    // molecular: atom-ID molecule-ID atom-type x y z
    // full:      atom-ID molecule-ID atom-type q x y z
    // (optional trailing image flags are ignored)
    let style = style_hint.unwrap_or_else(|| {
        style_from_token_count(atoms_lines[0].split_whitespace().count())
    });

    let n = atoms_lines.len().max(natoms_hint);
    let mut ids = Vec::with_capacity(n);
    let mut types = Vec::with_capacity(n);
    let mut positions = Vec::with_capacity(n * 3);
    let mut charges = Vec::with_capacity(n);
    let mut mols = Vec::with_capacity(n);

    let (mol_col, type_col, q_col, x_col) = match style {
        AtomStyle::Atomic => (None, 1, None, 2),
        AtomStyle::Charge => (None, 1, Some(2), 3),
        AtomStyle::Molecular => (Some(1), 2, None, 3),
        AtomStyle::Full => (Some(1), 2, Some(3), 4),
    };

    for line in atoms_lines {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < x_col + 3 {
            continue;
        }
        let id: i32 = parts[0].parse().unwrap_or(1);
        ids.push(id);
        types.push(parts[type_col].parse().unwrap_or(1));
        if let Some(c) = mol_col {
            mols.push(parts[c].parse().unwrap_or(0.0f32));
        }
        if let Some(c) = q_col {
            charges.push(parts[c].parse().unwrap_or(0.0f32));
        }
        positions.push(parts[x_col].parse().unwrap_or(0.0));
        positions.push(parts[x_col + 1].parse().unwrap_or(0.0));
        positions.push(parts[x_col + 2].parse().unwrap_or(0.0));
    }

    // Data files usually come sorted by ID, but map defensively — bonds and
    // velocities reference atom IDs, not row indices.
    let mut id_to_index = HashMap::new();
    for (idx, &id) in ids.iter().enumerate() {
        id_to_index.insert(id, idx as i32);
    }

    // ── Element remap ──
    // Only when every atom type resolves: partially-chemical files keep raw
    // type ids (pre-existing behavior). The original LAMMPS type id survives
    // as the 'type_id' property so per-type filtering still works.
    let elements: Option<Vec<i32>> = types
        .iter()
        .map(|t| type_to_element.get(t).copied().flatten())
        .collect();
    let mut type_id_prop: Option<Vec<f32>> = None;
    if let Some(elements) = elements {
        if !types.is_empty() {
            type_id_prop = Some(types.iter().map(|&t| t as f32).collect());
            types = elements;
        }
    }

    // ── Bonds: bond-ID bond-type atom1 atom2 ──
    let mut bonds = Vec::with_capacity(bonds_lines.len() * 2);
    for line in bonds_lines {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            let a1_id: i32 = parts[2].parse().unwrap_or(0);
            let a2_id: i32 = parts[3].parse().unwrap_or(0);
            if let (Some(&idx1), Some(&idx2)) = (id_to_index.get(&a1_id), id_to_index.get(&a2_id)) {
                bonds.push(idx1);
                bonds.push(idx2);
            }
        }
    }

    // ── Velocities: atom-ID vx vy vz ──
    // The section may precede Atoms in the file; lines were collected in the
    // first pass so the id→index map is always available here.
    let mut vel: Option<[Vec<f32>; 3]> = None;
    for line in velocities_lines {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            let id: i32 = match parts[0].parse() {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(&idx) = id_to_index.get(&id) {
                let v = vel.get_or_insert_with(|| {
                    [
                        vec![0.0; ids.len()],
                        vec![0.0; ids.len()],
                        vec![0.0; ids.len()],
                    ]
                });
                for d in 0..3 {
                    v[d][idx as usize] = parts[1 + d].parse().unwrap_or(0.0);
                }
            }
        }
    }

    let mut properties = Vec::new();
    if !charges.is_empty() {
        properties.push(("q".to_string(), charges));
    }
    if !mols.is_empty() {
        properties.push(("mol".to_string(), mols));
    }
    if let Some(type_ids) = type_id_prop {
        properties.push(("type_id".to_string(), type_ids));
    }
    if let Some([vx, vy, vz]) = vel {
        properties.push(("vx".to_string(), vx));
        properties.push(("vy".to_string(), vy));
        properties.push(("vz".to_string(), vz));
    }

    Ok(Frame {
        timestep: 0,
        natoms: ids.len() as u32,
        box_bounds,
        box_tilt,
        triclinic,
        columns: vec![
            "id".to_string(),
            "type".to_string(),
            "x".to_string(),
            "y".to_string(),
            "z".to_string(),
        ],
        ids,
        types,
        positions,
        properties,
        bonds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prop<'a>(frame: &'a Frame, name: &str) -> Option<&'a Vec<f32>> {
        frame.properties.iter().find(|(k, _)| k == name).map(|(_, v)| v)
    }

    /// R32-style fixture: atom_style full with a style hint, annotated
    /// Masses, Velocities before Atoms, a triclinic tilt line, and a
    /// Pair Coeffs section that must be skipped.
    const FULL_FIXTURE: &str = r#"LAMMPS data file — R32-like fixture

4 atoms
2 bonds
3 atom types

-10.0 10.0 xlo xhi
-10.0 10.0 ylo yhi
-10.0 10.0 zlo zhi
1.5 0.0 0.0 xy xz yz

Masses

1   12.011  # c3 r32
2   18.998  # f r32
3   1.008   # h2 r32

Pair Coeffs

1  0.1094  3.3996
2  0.0255  3.1181
3  0.0157  2.2931

Velocities

1  0.1  0.2  0.3
2 -0.1 -0.2 -0.3
3  0.0  0.5  0.0
4  0.5  0.0  0.0

Atoms # full

1 1 1  0.405467  -2.002  -2.788   2.299  # c3 C1 r32 1
2 1 2 -0.25      -1.0    -2.0     2.0    # f F1 r32 1
3 1 3  0.05       0.0     0.0     0.0    # h2 H1 r32 1
4 2 3  0.05       1.0     1.0     1.0    # h2 H1 r32 2

Bonds

1 1 1 2  # r32 1 C1 F1
2 2 1 3  # r32 1 C1 H1
"#;

    #[test]
    fn test_full_style_element_remap_by_mass() {
        let f = parse_data_internal(FULL_FIXTURE).unwrap();
        assert_eq!(f.natoms, 4);
        // Types remapped to atomic numbers: C, F, H, H
        assert_eq!(f.types, vec![6, 9, 1, 1]);
        // Original LAMMPS type ids preserved
        assert_eq!(prop(&f, "type_id").unwrap(), &vec![1.0, 2.0, 3.0, 3.0]);
    }

    #[test]
    fn test_full_style_charge_mol_and_positions() {
        let f = parse_data_internal(FULL_FIXTURE).unwrap();
        let q = prop(&f, "q").unwrap();
        assert!((q[0] - 0.405467).abs() < 1e-5);
        assert!((q[1] - (-0.25)).abs() < 1e-5);
        assert_eq!(prop(&f, "mol").unwrap(), &vec![1.0, 1.0, 1.0, 2.0]);
        // Trailing comments must not shift coordinates
        assert!((f.positions[0] - (-2.002)).abs() < 1e-5);
        assert!((f.positions[2] - 2.299).abs() < 1e-5);
    }

    #[test]
    fn test_velocities_before_atoms() {
        let f = parse_data_internal(FULL_FIXTURE).unwrap();
        let vx = prop(&f, "vx").unwrap();
        let vy = prop(&f, "vy").unwrap();
        let vz = prop(&f, "vz").unwrap();
        assert_eq!(vx, &vec![0.1, -0.1, 0.0, 0.5]);
        assert_eq!(vy, &vec![0.2, -0.2, 0.5, 0.0]);
        assert_eq!(vz, &vec![0.3, -0.3, 0.0, 0.0]);
    }

    #[test]
    fn test_triclinic_tilt() {
        let f = parse_data_internal(FULL_FIXTURE).unwrap();
        assert!(f.triclinic);
        assert_eq!(f.box_tilt, [1.5, 0.0, 0.0]);
        assert_eq!(f.box_bounds, [-10.0, 10.0, -10.0, 10.0, -10.0, 10.0]);
    }

    #[test]
    fn test_bonds_with_trailing_comments() {
        let f = parse_data_internal(FULL_FIXTURE).unwrap();
        assert_eq!(f.bonds, vec![0, 1, 0, 2]);
    }

    #[test]
    fn test_label_fallback_when_mass_is_exotic() {
        // 13.5 amu is >0.5 from both C and N, so only the "c3" label resolves
        let data = "\
title\n\n2 atoms\n1 atom types\n\n0.0 5.0 xlo xhi\n0.0 5.0 ylo yhi\n0.0 5.0 zlo zhi\n
Masses\n\n1  13.5  # c3\n
Atoms # full\n\n1 1 1 0.1 1.0 1.0 1.0\n2 1 1 -0.1 2.0 2.0 2.0\n";
        let f = parse_data_internal(data).unwrap();
        assert_eq!(f.types, vec![6, 6]);
        assert_eq!(prop(&f, "type_id").unwrap(), &vec![1.0, 1.0]);
    }

    #[test]
    fn test_label_fallback_prefers_two_letter_symbols() {
        // "cl1" must resolve to Cl (17), not C; "ow" to O via the one-letter retry
        let data = "\
title\n\n2 atoms\n2 atom types\n\n0.0 5.0 xlo xhi\n0.0 5.0 ylo yhi\n0.0 5.0 zlo zhi\n
Masses\n\n1  36.5  # cl1\n2  17.0  # ow\n
Atoms # atomic\n\n1 1 1.0 1.0 1.0\n2 2 2.0 2.0 2.0\n";
        let f = parse_data_internal(data).unwrap();
        assert_eq!(f.types, vec![17, 8]);
    }

    #[test]
    fn test_no_remap_when_masses_exotic_and_unlabeled() {
        let data = "\
title\n\n2 atoms\n2 atom types\n\n0.0 5.0 xlo xhi\n0.0 5.0 ylo yhi\n0.0 5.0 zlo zhi\n
Masses\n\n1  12.011\n2  999.0\n
Atoms # atomic\n\n1 1 1.0 1.0 1.0\n2 2 2.0 2.0 2.0\n";
        let f = parse_data_internal(data).unwrap();
        // Raw type ids kept, and no type_id property emitted
        assert_eq!(f.types, vec![1, 2]);
        assert!(prop(&f, "type_id").is_none());
    }

    #[test]
    fn test_style_hint_molecular_vs_charge_heuristic() {
        // Six columns reads as charge by the heuristic; the hint must win
        let molecular = "\
title\n\n1 atoms\n1 atom types\n\n0.0 5.0 xlo xhi\n0.0 5.0 ylo yhi\n0.0 5.0 zlo zhi\n
Atoms # molecular\n\n1 7 1 1.0 2.0 3.0\n";
        let f = parse_data_internal(molecular).unwrap();
        assert_eq!(prop(&f, "mol").unwrap(), &vec![7.0]);
        assert!(prop(&f, "q").is_none());
        assert!((f.positions[0] - 1.0).abs() < 1e-5);

        let charge = "\
title\n\n1 atoms\n1 atom types\n\n0.0 5.0 xlo xhi\n0.0 5.0 ylo yhi\n0.0 5.0 zlo zhi\n
Atoms # charge\n\n1 1 -0.5 1.0 2.0 3.0\n";
        let f = parse_data_internal(charge).unwrap();
        assert_eq!(prop(&f, "q").unwrap(), &vec![-0.5]);
        assert!(prop(&f, "mol").is_none());
        assert!((f.positions[0] - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_unhinted_token_count_heuristic_still_works() {
        // No hint, no Masses: 5 tokens → atomic, orthogonal box, raw types
        let data = "\
title\n\n2 atoms\n1 atom types\n\n0.0 5.0 xlo xhi\n0.0 5.0 ylo yhi\n0.0 5.0 zlo zhi\n
Atoms\n\n1 1 1.0 2.0 3.0\n2 1 4.0 5.0 6.0\n";
        let f = parse_data_internal(data).unwrap();
        assert!(!f.triclinic);
        assert_eq!(f.box_tilt, [0.0, 0.0, 0.0]);
        assert_eq!(f.types, vec![1, 1]);
        assert!(f.properties.is_empty());
    }

    #[test]
    fn test_velocities_after_atoms() {
        let data = "\
title\n\n2 atoms\n1 atom types\n\n0.0 5.0 xlo xhi\n0.0 5.0 ylo yhi\n0.0 5.0 zlo zhi\n
Atoms # atomic\n\n1 1 1.0 2.0 3.0\n2 1 4.0 5.0 6.0\n
Velocities\n\n2 0.5 0.6 0.7\n1 0.1 0.2 0.3\n";
        let f = parse_data_internal(data).unwrap();
        assert_eq!(prop(&f, "vx").unwrap(), &vec![0.1, 0.5]);
        assert_eq!(prop(&f, "vz").unwrap(), &vec![0.3, 0.7]);
    }

    #[test]
    fn test_element_table_resolution() {
        assert_eq!(element_from_mass(12.011), Some(6));
        assert_eq!(element_from_mass(1.008), Some(1));
        assert_eq!(element_from_mass(18.998), Some(9));
        assert_eq!(element_from_mass(55.9), Some(26)); // Fe within tolerance
        assert_eq!(element_from_mass(13.0), None); // between C and N
        assert_eq!(element_from_label("c3 r32"), Some(6));
        assert_eq!(element_from_label("h2"), Some(1));
        assert_eq!(element_from_label("f r32"), Some(9));
        assert_eq!(element_from_label("ow"), Some(8));
        assert_eq!(element_from_label("cl"), Some(17));
        assert_eq!(element_from_label("123"), None);

        // Mass/label tiebreak: united-atom pseudo-masses trust a consistent
        // label; symbol-colliding labels with inconsistent masses defer to
        // the nearest standard mass.
        assert_eq!(resolve_element(14.026, Some("CH2 backbone")), Some(6)); // not N
        assert_eq!(resolve_element(16.023, Some("NH2")), Some(7)); // not O
        assert_eq!(resolve_element(12.011, Some("ca aromatic")), Some(6)); // not Ca
        assert_eq!(resolve_element(40.08, Some("ca ion")), Some(20)); // real calcium
        assert_eq!(resolve_element(14.007, Some("n3")), Some(7));
        assert_eq!(resolve_element(12.011, None), Some(6));
        assert_eq!(resolve_element(13.0, None), None); // no signal at all
    }
}
