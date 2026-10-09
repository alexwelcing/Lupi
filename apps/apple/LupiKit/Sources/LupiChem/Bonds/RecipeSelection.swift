/// Which rule a frame's bonds use (the viewer's bond profile).
public enum BondProfile: String, Sendable, Codable {
    case auto
    case distance
    case molecular
}

/// What a frame's bonds come from: the file's own pairs, or a named inference rule.
public enum BondSource: Sendable, Equatable {
    case source
    case inferred(BondRecipe)
}

/// Port of `selectBondRecipe` (packages/core/src/bonds/select.ts). Source
/// bonds always win; the molecular recipe needs a non-periodic XYZ frame of at
/// most 2,000 atoms. Forced, it applies to any such frame; on auto it also
/// needs declared chemistry and a single frame or an OMol25 record.
public func selectBondRecipe(
    atomCount: Int, frameCount: Int, sourceBondCount: Int = 0, inferenceAllowed: Bool = true,
    periodic: Bool?, chemistry: FrameChemistry?, isOmol25Record: Bool, profile: BondProfile = .auto
) -> BondSource? {
    if sourceBondCount > 0 { return .source }
    if !inferenceAllowed { return nil }
    if profile == .distance || atomCount > BondConstants.molecularRecipeMaxAtoms || periodic != false {
        return .inferred(.distance)
    }
    if profile == .molecular { return .inferred(.molecular) }
    if chemistry != nil && (frameCount == 1 || isOmol25Record) { return .inferred(.molecular) }
    return .inferred(.distance)
}

extension XYZDocument {
    /// The rule the viewer would pick for this file's first frame on auto.
    public var autoBondRecipe: BondRecipe {
        let frame = first
        let pick = selectBondRecipe(
            atomCount: frame.atomCount, frameCount: frames.count + (hasMoreFrames ? 1 : 0),
            periodic: frame.periodic, chemistry: frame.chemistry, isOmol25Record: frame.sourceRecord != nil
        )
        if case .inferred(let recipe) = pick { return recipe }
        return .distance
    }
}
