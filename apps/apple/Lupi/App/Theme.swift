import SwiftUI

// The web's palette (plan §6): the sage plate and the lime accent.
extension Color {
    /// #101817
    static let sage = Color(red: 16 / 255, green: 24 / 255, blue: 23 / 255)
    /// A raised card on the sage plate.
    static let sageRaised = Color(red: 27 / 255, green: 38 / 255, blue: 36 / 255)
    /// #d5ef9c
    static let lime = Color(red: 213 / 255, green: 239 / 255, blue: 156 / 255)
}

extension ShapeStyle where Self == Color {
    static var sage: Color { Color.sage }
    static var sageRaised: Color { Color.sageRaised }
    static var lime: Color { Color.lime }
}

extension String {
    /// "C8H10N4O2" as "C₈H₁₀N₄O₂".
    var subscriptedFormula: String {
        let subscripts: [Character: Character] = [
            "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
        ]
        return String(map { subscripts[$0] ?? $0 })
    }
}
