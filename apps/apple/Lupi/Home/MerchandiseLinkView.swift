import Foundation
import LupiData
import SwiftUI

/// A secondary external link for verified physical goods. Free molecule play stays available.
struct MerchandiseLinkView: View {
    let moleculeID: String
    @Environment(\.scenePhase) private var scenePhase
    @State private var preview = MerchandisePreviewState()

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let handoff = preview.handoff {
                Link(destination: handoff.url) {
                    Label("See \(handoff.title)", systemImage: "bag")
                }
                .buttonStyle(.bordered)
                Text("Physical merchandise · US shipping")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .task(id: moleculeID) {
            preview = MerchandisePreviewState()
            let registry = await MerchandiseClient().registry()
            guard !Task.isCancelled else { return }
            preview.replaceRegistry(registry, moleculeID: moleculeID)
        }
        .task(id: preview.handoff?.validUntil) {
            // Cancellation follows dismissal, a changed molecule or a replaced
            // expiry. A backwards clock change simply schedules the next wait.
            while let deadline = preview.handoff?.validUntil {
                do {
                    try await Task.sleep(for: .seconds(max(0, deadline.timeIntervalSinceNow)))
                    try Task.checkCancellation()
                } catch { return }
                preview.revalidate(moleculeID: moleculeID)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { preview.revalidate(moleculeID: moleculeID) }
        }
    }
}
