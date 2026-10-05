@preconcurrency import ARKit
import Foundation
import SwiftUI

/// ARKit's coaching overlay on our session: it shows itself while tracking needs the player
/// to move the device, and hides once a surface is found (plan §3.3). Its Start Over would
/// reset the session and remove every anchor, the shelf's root included, so the app takes it
/// over (plan §6.4, step 6).
struct CoachingOverlay: UIViewRepresentable {
    let session: ARSession
    let onStartOver: @MainActor () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onStartOver: onStartOver) }

    func makeUIView(context: Context) -> ARCoachingOverlayView {
        let view = ARCoachingOverlayView()
        view.session = session
        view.goal = .anyPlane
        view.activatesAutomatically = true
        view.delegate = context.coordinator
        return view
    }

    func updateUIView(_ view: ARCoachingOverlayView, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, ARCoachingOverlayViewDelegate {
        let onStartOver: @MainActor () -> Void

        init(onStartOver: @escaping @MainActor () -> Void) {
            self.onStartOver = onStartOver
        }

        // Implementing this stops the overlay's own reset (`run` with `.resetTracking`).
        nonisolated func coachingOverlayViewDidRequestSessionReset(_ coachingOverlayView: ARCoachingOverlayView) {
            MainActor.assumeIsolated { onStartOver() }
        }
    }
}
