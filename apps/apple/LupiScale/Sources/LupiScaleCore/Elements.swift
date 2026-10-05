/// The element facts the byte-exact layer needs: symbols for Hill formulas
/// and `lupi.mass.v1`, the frozen micro-dalton table (§5.3).
///
/// Each µDa value is an element mass of `packages/core/src/elements.ts` read as
/// its decimal literal and scaled by 10⁶ exactly. LupiScale's tests check it
/// against LupiChem's generated table; a change of any mass is a new table
/// version, never an edit here.
public enum ScaleElements {
    public static let massTable = "lupi.mass.v1"

    /// The symbol of Z (1…118), or nil.
    public static func symbol(_ z: UInt8) -> String? {
        guard z >= 1, z <= 118 else { return nil }
        return symbols[Int(z) - 1]
    }

    /// µDa(Z) for Z in 1…118, or nil.
    public static func microDaltons(_ z: UInt8) -> UInt64? {
        guard z >= 1, z <= 118 else { return nil }
        return microDa[Int(z) - 1]
    }

    static let symbols: [String] = [
        "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
        "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
        "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
        "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
        "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
        "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
        "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
        "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
        "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th",
        "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm",
        "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds",
        "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
    ]

    static let microDa: [UInt64] = [
        1008000, 4002600, 6940000, 9012200, 10810000, 12011000, 14007000, 15999000, 18998000, 20180000,
        22990000, 24305000, 26982000, 28085000, 30974000, 32060000, 35450000, 39950000, 39098000, 40078000,
        44956000, 47867000, 50942000, 51996000, 54938000, 55845000, 58933000, 58693000, 63546000, 65380000,
        69723000, 72630000, 74922000, 78971000, 79904000, 83798000, 85468000, 87620000, 88906000, 91224000,
        92906000, 95950000, 98000000, 101070000, 102910000, 106420000, 107870000, 112410000, 114820000, 118710000,
        121760000, 127600000, 126900000, 131290000, 132910000, 137330000, 138910000, 140120000, 140910000, 144240000,
        145000000, 150360000, 151960000, 157250000, 158930000, 162500000, 164930000, 167260000, 168930000, 173050000,
        174970000, 178490000, 180950000, 183840000, 186210000, 190230000, 192220000, 195080000, 196970000, 200590000,
        204380000, 207200000, 208980000, 209000000, 210000000, 222000000, 223000000, 226000000, 227000000, 232040000,
        231040000, 238030000, 237000000, 244000000, 243000000, 247000000, 247000000, 251000000, 252000000, 257000000,
        258000000, 259000000, 266000000, 267000000, 268000000, 269000000, 270000000, 269000000, 278000000, 281000000,
        282000000, 285000000, 286000000, 289000000, 290000000, 293000000, 294000000, 294000000,
    ]
}
