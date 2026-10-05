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
            .tint(Color.lime)
            .preferredColorScheme(.dark)
    }
}
