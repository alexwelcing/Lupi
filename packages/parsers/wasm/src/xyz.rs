use crate::types::Frame;
use serde_wasm_bindgen;
use wasm_bindgen::prelude::*;

const ELEMENT_SYMBOLS: [&str; 119] = [
    "", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al",
    "Si", "P", "S", "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co",
    "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr", "Nb",
    "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe", "Cs",
    "Ba", "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm",
    "Yb", "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi",
    "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk",
    "Cf", "Es", "Fm", "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg",
    "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
];

/// Decode an XYZ element token without inventing chemistry. Canonical symbols
/// (case-insensitive) and explicit atomic numbers 1..118 are supported;
/// unknown tokens fail the frame rather than silently becoming hydrogen.
fn element_to_type(token: &str) -> Result<i32, String> {
    let token = token.trim();
    if let Ok(atomic_number) = token.parse::<i32>() {
        if (1..ELEMENT_SYMBOLS.len() as i32).contains(&atomic_number) {
            return Ok(atomic_number);
        }
        return Err(format!("atomic number {atomic_number} is outside 1..118"));
    }

    ELEMENT_SYMBOLS
        .iter()
        .position(|symbol| !symbol.is_empty() && symbol.eq_ignore_ascii_case(token))
        .map(|atomic_number| atomic_number as i32)
        .ok_or_else(|| format!("unknown element token '{token}'"))
}

#[wasm_bindgen(js_name = "parseXyzFile")]
pub fn parse_xyz_file(content: &str) -> Result<JsValue, JsError> {
    let frames = parse_xyz_internal(content).map_err(|e| JsError::new(&e))?;
    serde_wasm_bindgen::to_value(&frames).map_err(|e| JsError::new(&e.to_string()))
}

fn parse_xyz_internal(content: &str) -> Result<Vec<Frame>, String> {
    let lines: Vec<&str> = content.lines().collect();
    let mut frames = Vec::new();
    let mut idx = 0;
    let mut frame_counter = 0u64;

    while idx < lines.len() {
        let natoms: u32 = lines[idx].trim().parse().map_err(|_| {
            format!("Expected atom count at line {}, got: '{}'", idx + 1, lines[idx])
        })?;
        idx += 1;

        if idx >= lines.len() {
            break;
        }

        // Comment line — try to extract a timestep if it looks like a number
        let comment = lines[idx].trim();
        let timestep = comment.parse::<u64>().unwrap_or(frame_counter);
        idx += 1;

        let mut positions = Vec::with_capacity((natoms * 3) as usize);
        let mut types = Vec::with_capacity(natoms as usize);
        let mut ids = Vec::with_capacity(natoms as usize);

        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut min_z = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        let mut max_z = f64::NEG_INFINITY;

        for i in 0..natoms {
            if idx >= lines.len() {
                return Err(format!(
                    "Unexpected end of file while reading atom {} of frame {}",
                    i + 1,
                    frames.len() + 1
                ));
            }
            let parts: Vec<&str> = lines[idx].split_whitespace().collect();
            if parts.len() < 4 {
                return Err(format!(
                    "Expected at least 4 columns at line {}, got: '{}'",
                    idx + 1,
                    lines[idx]
                ));
            }

            let atom_type = element_to_type(parts[0]).map_err(|reason| {
                format!("Invalid XYZ element at line {}: {}", idx + 1, reason)
            })?;
            let x: f32 = parts[1].parse().map_err(|_| format!("Invalid x coordinate at line {}", idx + 1))?;
            let y: f32 = parts[2].parse().map_err(|_| format!("Invalid y coordinate at line {}", idx + 1))?;
            let z: f32 = parts[3].parse().map_err(|_| format!("Invalid z coordinate at line {}", idx + 1))?;

            positions.push(x);
            positions.push(y);
            positions.push(z);
            types.push(atom_type);
            ids.push((i + 1) as i32);

            let xf = x as f64;
            let yf = y as f64;
            let zf = z as f64;
            if xf < min_x { min_x = xf; }
            if xf > max_x { max_x = xf; }
            if yf < min_y { min_y = yf; }
            if yf > max_y { max_y = yf; }
            if zf < min_z { min_z = zf; }
            if zf > max_z { max_z = zf; }

            idx += 1;
        }

        // Pad bounds by 2 Å
        let pad = 2.0;
        let box_bounds = [
            min_x - pad, max_x + pad,
            min_y - pad, max_y + pad,
            min_z - pad, max_z + pad,
        ];

        frames.push(Frame {
            timestep,
            natoms,
            box_bounds,
            box_tilt: [0.0, 0.0, 0.0],
            triclinic: false,
            columns: vec!["id".to_string(), "type".to_string(), "x".to_string(), "y".to_string(), "z".to_string()],
            ids,
            types,
            positions,
            properties: Vec::new(),
            bonds: Vec::new(),
        });

        frame_counter += 1;
    }

    if frames.is_empty() {
        return Err("No valid XYZ frames found".to_string());
    }

    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::{element_to_type, parse_xyz_internal};

    #[test]
    fn resolves_the_full_periodic_table_and_numeric_atomic_numbers() {
        assert_eq!(element_to_type("Og"), Ok(118));
        assert_eq!(element_to_type("cu"), Ok(29));
        assert_eq!(element_to_type("79"), Ok(79));
    }

    #[test]
    fn rejects_unknown_or_out_of_range_tokens_instead_of_inventing_hydrogen() {
        assert!(element_to_type("Xx").is_err());
        assert!(element_to_type("0").is_err());
        assert!(element_to_type("119").is_err());
        assert!(parse_xyz_internal("1\nunknown\nXx 0 0 0\n").is_err());
    }
}
