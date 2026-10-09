import LupiGame
import SwiftUI

@main
struct LupiApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
        }
    }
}

/// Home, with Play over it full screen.
struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var model = app
        HomeView()
            .fullScreenCover(isPresented: $model.showingPlay, onDismiss: { Task { await app.endPlay() } }) {
                if let controller = app.playController {
                    PlayView(controller: controller)
                        .environment(app)
                }
            }
            .onChange(of: reduceMotion, initial: true) { _, on in app.reduceMotion = on }
            // The collection syncs on launch and each time the app comes back (account-and-sync.md §7).
            .onChange(of: scenePhase, initial: true) { _, phase in
                if phase == .active { Task { await app.collection.opened() } }
            }
            .sheet(isPresented: $model.showingCollection, onDismiss: { app.playChosenTrophy() }) {
                CollectionView()
                    .environment(app)
            }
            // The first-run card, before iOS asks for the camera (plan §8 M4).
            .sheet(isPresented: Binding(get: { app.onboarding != nil }, set: { if !$0 { app.dismissOnboarding() } })) {
                if let card = app.onboarding {
                    OnboardingView(card: card)
                        .environment(app)
                        .presentationDetents([.medium, .large])
                }
            }
            .tint(Color.lime)
            .preferredColorScheme(.dark)
    }
}
