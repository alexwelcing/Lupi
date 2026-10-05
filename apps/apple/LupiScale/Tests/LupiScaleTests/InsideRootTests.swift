import Foundation
import LupiChem
import LupiScale
import LupiScaleCore
import Testing

/// A terrain short of E_desc keeps its own node as anchor (§8.4). With the camera inside it, the
/// cut draws the excavation bubble's wall, as it does for an anchor below the node (§9.4, §10.1).
@Suite("terrain anchored at its own node")
struct InsideRootTests {
    @Test func theBubbleWallShowsFromInsideTheBillion() throws {
        let rung = Content.rung(6)
        let r = Content.resolver([rung])
        let ref = Content.ref(rung)
        let a = try r.aggregate(r.root(rung.id))
        // Ions about 2 cm across: the 10⁹ crystal is about 31 m, short of the 40 m that descends.
        let sigma = 0.02 / (2 * a.rAtom)
        #expect(sigma * a.bounds.longest > CutTuning.terrainSpan)
        #expect(sigma * a.bounds.longest < FrameTuning.descendWidth)
        let eye = Vec3(0.3, 1.4, -0.2)
        let body = BodyFrame(ref: ref, worldFromAnchor: RigidD(translation: eye - sigma * a.centre), metresPerAnchorUnit: sigma)
        let view = ViewState.looking(from: eye, at: eye + Vec3(0.2, -0.3, -1), fovY: 1.0, viewportHeight: 1380, viewportWidth: 640)
        let budgets = steadyBudgets()
        let cut = settledCut([body], view, budgets, r)
        #expect(!cut.items.isEmpty)
        #expect(cut.items.allSatisfy { $0.parent == .cameraFrame })
        #expect(cut.drawnAtoms > 0)
        #expect(cut.usedAtoms <= budgets.instancedAtoms && cut.usedItems <= budgets.items && cut.visited <= budgets.visits)
        // Nothing is drawn inside the bubble: every drawn atom is at least 0.35 m from the eye.
        for item in cut.items {
            guard case let .atoms(runs) = item.extras else { continue }
            for run in runs {
                for p in run.positions {
                    let w = Vec3(item.transform.apply(p)) + cut.cameraFrameOrigin
                    #expect((w - eye).length >= CutTuning.bubbleRadius - 0.02)
                }
            }
        }
    }
}
