import Foundation
import LupiPlay
import Testing

/// `lupi.feltmass.v1` (scale-spec §10.2) at the molecule end, from masses in daltons. LupiScale's
/// tests check the rest of the table from exact Magnitudes, up to a googolplex.
@Suite("Felt mass")
struct FeltMassTests {
    static func kg(_ daltons: Double, _ massScale: Double = 1, places: Double = 1e3) -> Double {
        (FeltMass.kg(MassLog(daltons: daltons), massScale: massScale) * places).rounded() / places
    }

    @Test func belowTheKnee() {
        #expect(Self.kg(18.015) == 0.080)              // water
        #expect(Self.kg(194.194) == 0.206)             // caffeine
        #expect(Self.kg(720.66) == 0.348)              // C60
        #expect(Self.kg(720.66, 0.8) == 0.279)         // C60, bouncy
        #expect(Self.kg(34.014, 0.85) == 0.087)        // hydrogen peroxide, brittle
        // Exactly the plan's curve there: 0.2 · (M / 180)^0.4 · massScale.
        for (m, s) in [(18.015, 1.0), (500.0, 0.9), (900.0, 0.85)] {
            #expect(abs(FeltMass.kg(MassLog(daltons: m), massScale: s) - 0.2 * pow(m / 180, 0.4) * s) < 1e-12)
        }
    }

    @Test func aboveTheKnee() {
        #expect(Self.kg(64_458) == 0.544)              // hemoglobin, the human HbA tetramer
        #expect(Self.kg(64_458, 0.85) == 0.541)
        #expect(FeltMass.kg(MassLog(lnM: .infinity, lnlnM: 1e4), massScale: 0.85) < 0.6)
    }

    /// Floored at 0.06 kg (about 9 Da) and strictly increasing above it, never reaching 0.6.
    @Test func keepsTheOrderOfMasses() {
        var previous = 0.0
        for (i, m) in [8, 9.5, 18, 180, 1018, 1019, 1e4, 1e6, 1e12, 1e100, 1e300].enumerated() {
            let kg = FeltMass.kg(MassLog(daltons: m), massScale: 1)
            #expect(kg < 0.6)
            if i == 0 { #expect(kg == 0.06) } else if i > 1 { #expect(kg > previous, "\(m) Da") }
            previous = kg
        }
    }
}
