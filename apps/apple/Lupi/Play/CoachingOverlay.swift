@preconcurrency import ARKit
import SwiftUI

/// ARKit's coaching overlay on our session: it shows itself while tracking needs the player
/// to move the device, and hides once a surface is found (plan §3.3).
struct CoachingOverlay: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARCoachingOverlayView {
        let view = ARCoachingOverlayView()
        view.session = session
        view.goal = .anyPlane
        view.activatesAutomatically = true
        return view
    }

    func updateUIView(_ view: ARCoachingOverlayView, context: Context) {}
}
