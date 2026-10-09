import LupiGame
import SwiftUI

/// Home (plan §8 M0): C₆₀ first, the bundled starters, the scale receipt and the salt ladder.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @State private var showingSettings = false
    @State private var showingDiscovery = false
    @State private var discoveryStarter: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    header
                    if let catalog = app.catalog {
                        if let first = catalog.tray.first { hero(first) }
                        Button { showingDiscovery = true } label: {
                            Label("Find a molecule", systemImage: "magnifyingglass")
                                .font(.headline)
                                .foregroundStyle(Color.lime)
                        }
                        collectionButton
                        starters(Array(catalog.tray.dropFirst()))
                        receipt(catalog.receipt)
                        ladder(catalog.scale.filter { $0.scaleShelf == .salt })
                    } else if let error = app.catalogError {
                        Text(error)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(20)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .background(Color.sage.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                }
            }
            .sheet(isPresented: $showingSettings) {
                SettingsView()
                    .environment(app)
            }
            .sheet(isPresented: $showingDiscovery, onDismiss: {
                if let id = discoveryStarter {
                    discoveryStarter = nil
                    app.play(.starter(id))
                }
            }) {
                DiscoveryView { discoveryStarter = $0 }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Lupi")
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .foregroundStyle(Color.lime)
            Text("Molecules in your room. Throw them at the wall, stack them on the desk, break them.")
                .font(.body)
                .foregroundStyle(.white.opacity(0.75))
        }
        .padding(.top, 12)
    }

    private func hero(_ item: SpawnItem) -> some View {
        Button {
            app.play(item.source)
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                Text(item.subtitle.subscriptedFormula)
                    .font(.system(size: 56, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color.sage)
                Text(item.title)
                    .font(.headline)
                    .foregroundStyle(Color.sage.opacity(0.8))
                HStack {
                    Image(systemName: "arkit")
                    Text("Play")
                }
                .font(.headline)
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(Capsule().fill(Color.sage))
                .foregroundStyle(Color.lime)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
            .background(RoundedRectangle(cornerRadius: 28, style: .continuous).fill(Color.lime))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Play with \(item.title)")
    }

    /// The collection (plan §6.4, step 5): every trophy, one tap from play, camera or not.
    private var collectionButton: some View {
        Button {
            app.showingCollection = true
        } label: {
            HStack {
                Image(systemName: "square.stack.3d.up")
                Text("Your collection")
                Spacer()
                Text(app.collection.trophies.isEmpty ? "Nothing kept yet" : "\(app.collection.trophies.count) kept")
                    .foregroundStyle(.white.opacity(0.6))
            }
            .font(.headline)
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.sageRaised))
            .foregroundStyle(Color.lime)
        }
        .buttonStyle(.plain)
    }

    private func starters(_ items: [SpawnItem]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Starters")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                ForEach(items) { item in
                    Button {
                        app.play(item.source)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.subtitle.subscriptedFormula)
                                .font(.title2.weight(.bold))
                                .foregroundStyle(Color.lime)
                            Text(item.title)
                                .font(.subheadline)
                                .foregroundStyle(.white.opacity(0.8))
                                .lineLimit(2)
                        }
                        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
                        .padding(16)
                        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.sageRaised))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func receipt(_ rungs: [SpawnItem]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("The scale receipt")
            Text("Salt at a thousand, a million and a billion atoms, each counted exactly, side by side on your desk. Pinch the biggest until its ions are as big as marbles and look around inside.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.75))
            Button {
                app.playReceipt()
            } label: {
                Label("Put all three on the desk", systemImage: "cube.transparent")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Capsule().strokeBorder(Color.lime, lineWidth: 2))
                    .foregroundStyle(Color.lime)
            }
            .buttonStyle(.plain)
            ForEach(rungs) { rung in
                Button {
                    app.play(rung.source)
                } label: {
                    HStack {
                        Text(rung.title)
                            .foregroundStyle(.white)
                        Spacer()
                        Text(rung.subtitle)
                            .font(.callout.monospacedDigit())
                            .foregroundStyle(.white.opacity(0.6))
                    }
                    .padding(.vertical, 10)
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// The salt ladder to a googolplex (plan §7.5): every rung counted exactly and kept in a few
    /// hundred bytes; crystals and diamondoids wait in Play's Scale menu.
    @ViewBuilder
    private func ladder(_ rungs: [SpawnItem]) -> some View {
        if !rungs.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                sectionTitle("To a googolplex")
                Text("The same salt, ten times more at every step, up to a googolplex atoms: a bar of ten cubes you can hold. Dive into any of them, or stand the 10³⁰ cube in the room at life size. Copper, diamond and the diamondoids are in Play's Scale menu.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.75))
                ForEach(rungs) { rung in
                    Button {
                        app.play(rung.source)
                    } label: {
                        HStack {
                            Text(rung.title)
                                .foregroundStyle(.white)
                            Spacer()
                            Text(rung.subtitle)
                                .font(.callout.monospacedDigit())
                                .foregroundStyle(.white.opacity(0.6))
                                .lineLimit(1)
                                .minimumScaleFactor(0.6)
                        }
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.title3.weight(.semibold))
            .foregroundStyle(.white)
    }
}
