import Foundation

/// A CPK colour as the web writes it (`#rrggbb`), in sRGB bytes.
public struct CPKColor: Sendable, Hashable, Codable {
    public var red: UInt8
    public var green: UInt8
    public var blue: UInt8

    public init(red: UInt8, green: UInt8, blue: UInt8) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    public init(hex: UInt32) {
        self.init(red: UInt8((hex >> 16) & 0xFF), green: UInt8((hex >> 8) & 0xFF), blue: UInt8(hex & 0xFF))
    }

    /// `#rrggbb`, lowercase, as the web table spells it.
    public var hexString: String {
        let digits = Array("0123456789abcdef")
        var out = "#"
        for byte in [red, green, blue] {
            out.append(digits[Int(byte >> 4)])
            out.append(digits[Int(byte & 0x0F)])
        }
        return out
    }

    /// sRGB components in 0...1 (what UIColor and SwiftUI's Color take).
    public var srgb: SIMD3<Double> {
        SIMD3(Double(red), Double(green), Double(blue)) / 255
    }

    /// Linear-light components in 0...1 (what a RealityKit material's tint wants).
    public var linear: SIMD3<Double> {
        func decode(_ c: Double) -> Double {
            c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        let s = srgb
        return SIMD3(decode(s.x), decode(s.y), decode(s.z))
    }
}

/// The web table's chemical category (packages/core/src/elements.ts).
public enum ElementCategory: String, Sendable, Codable, CaseIterable {
    case alkaliMetal = "alkali-metal"
    case alkalineEarth = "alkaline-earth"
    case transitionMetal = "transition-metal"
    case postTransitionMetal = "post-transition-metal"
    case metalloid
    case nonmetal
    case halogen
    case nobleGas = "noble-gas"
    case lanthanide
    case actinide
    case unknown
}

/// One element. `Element.table` is generated from the web's element table, so
/// colours and bond radii match the viewer exactly.
public struct Element: Sendable, Hashable {
    public let z: Int
    public let symbol: String
    public let name: String
    /// Standard atomic weight, g/mol; 0 for an atomic number the table lacks.
    public let mass: Double
    /// Single-bond covalent radius, Å: the r_cov of both bond recipes.
    public let covalentRadius: Double
    /// Van der Waals radius, Å (space-filling size).
    public let vdwRadius: Double
    /// Ball-and-stick draw radius, Å: clamp(0.5 · r_cov, 0.30, 0.70), as the viewer.
    public let displayRadius: Double
    public let cpk: CPKColor
    public let category: ElementCategory
    /// Pauling electronegativity, where one exists.
    public let electronegativity: Double?

    init(
        z: Int, symbol: String, name: String, mass: Double, covalentRadius: Double, vdwRadius: Double,
        displayRadius: Double, cpk: CPKColor, category: ElementCategory, electronegativity: Double?
    ) {
        self.z = z
        self.symbol = symbol
        self.name = name
        self.mass = mass
        self.covalentRadius = covalentRadius
        self.vdwRadius = vdwRadius
        self.displayRadius = displayRadius
        self.cpk = cpk
        self.category = category
        self.electronegativity = electronegativity
    }

    /// Every element, Z 1...118.
    public static var all: [Element] { table }

    /// The table entry, or nil outside 1...118.
    public static func known(_ z: Int) -> Element? {
        z >= 1 && z <= table.count ? table[z - 1] : nil
    }

    /// The table entry, or the web's stand-in for an unknown type (`getElementSpec`):
    /// a 1.40 Å covalent radius so bond rules still see it, no mass, grey.
    public static func forAtomicNumber(_ z: Int) -> Element {
        if let element = known(z) { return element }
        return Element(
            z: z, symbol: "X\(z)", name: "Unknown Isotope", mass: 0, covalentRadius: 1.40, vdwRadius: 2.45,
            displayRadius: 0.70, cpk: CPKColor(hex: 0x999999), category: .unknown, electronegativity: nil
        )
    }

    /// Atomic number for a symbol, case-insensitive ("CL" and "cl" are chlorine), as the XYZ parser reads it.
    public static func atomicNumber(forSymbol symbol: String) -> Int? {
        bySymbol[symbol.lowercased()]
    }

    private static let bySymbol: [String: Int] = {
        var map: [String: Int] = [:]
        for element in table { map[element.symbol.lowercased()] = element.z }
        return map
    }()
}
