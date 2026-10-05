import LupiGame
import RealityKit
import SwiftUI
import UIKit

/// The play screen (plan §3, §8 M0): the room through RealityView, touches straight to the
/// session's gesture arbiter, and the chrome over them.
struct PlayView: View {
    let controller: PlayController
    @Environment(AppModel.self) private var app
    @State private var showingSettings = false
    @State private var showingCollection = false

    var body: some View {
        ZStack {
            RealityView { [controller] content in
                controller.attach(&content)
                await controller.start()
            }
            .ignoresSafeArea()
            TouchLayer(
                onTouches: { [controller] in controller.touches($0) },
                onLayout: { [controller] in controller.layout($0, $1, $2) }
            )
            .ignoresSafeArea()
            // Above the touch layer and interactive, so its Start Over reaches our handler
            // instead of resetting the session; once it hides itself, touches pass through.
            CoachingOverlay(session: controller.ar.session, onStartOver: { [controller] in controller.coachingRequestedReset() })
                .ignoresSafeArea()
            if controller.shelfPrompt == .placing {
                // "Put the shelf here": the next tap on a surface places the root (plan §6.4).
                Color.clear
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .onTapGesture(coordinateSpace: .local) { point in controller.placeShelf(at: point) }
            }
            chrome
        }
        .onChange(of: app.settings, initial: true) { _, settings in controller.apply(settings) }
        .onChange(of: app.showDebugHUD, initial: true) { _, on in controller.showsHUD = on }
        .onChange(of: app.autoKeep, initial: true) { _, on in controller.autoKeep = on }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
                .environment(app)
        }
        .sheet(isPresented: $showingCollection, onDismiss: { app.playChosenTrophy() }) {
            CollectionView()
                .environment(app)
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
    }

    private var chrome: some View {
        VStack(spacing: 10) {
            topBar
            if let limited = controller.limited {
                Text("Tracking: \(limited)")
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.ultraThinMaterial, in: Capsule())
            }
            if app.showDebugHUD {
                DebugPanel(controller: controller)
            }
            if let prompt = controller.shelfPrompt {
                ShelfCard(prompt: prompt, snapshot: controller.shelfSnapshot, controller: controller)
            }
            if let plaque = controller.plaque {
                PlaqueCard(plaque: plaque, controller: controller)
            }
            Spacer(minLength: 0)
            if let caption = controller.caption {
                Text(caption)
                    .font(.callout.weight(.medium))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
                    .transition(.opacity)
            }
            if let catalog = app.catalog {
                SpawnTray(
                    items: catalog.tray, receipt: catalog.receipt,
                    spawn: { controller.spawn($0) }, spawnReceipt: { controller.spawnReceipt() }, clear: { controller.clear() }
                )
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var topBar: some View {
        HStack {
            RoundButton(symbol: "xmark", label: "Home") { app.showingPlay = false }
            RoundButton(symbol: "square.stack.3d.up", label: "Collection") { showingCollection = true }
            Spacer()
            Text("Lupi")
                .font(.headline.weight(.bold))
                .foregroundStyle(Color.lime)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(.ultraThinMaterial, in: Capsule())
                .onLongPressGesture(minimumDuration: 0.6) { app.showDebugHUD.toggle() }
                .accessibilityHint("Touch and hold to show the debug HUD")
            Spacer()
            RoundButton(symbol: "gearshape", label: "Settings") { showingSettings = true }
        }
    }
}

struct RoundButton: View {
    let symbol: String
    let label: String
    let action: @MainActor () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.headline)
                .frame(width: 44, height: 44)
                .background(.ultraThinMaterial, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// The selected body's plaque (plan §4.7): only true facts, and the receipt's dive.
struct PlaqueCard: View {
    let plaque: PlaqueText
    let controller: PlayController

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(plaque.name)
                    .font(.headline)
                Spacer()
                Button {
                    controller.deselect()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
            Text(plaque.canDive ? plaque.formula : plaque.formula.subscriptedFormula)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.lime)
            Text("\(plaque.atoms) atoms")
                .font(.subheadline.monospacedDigit())
            Text(plaque.personality)
                .font(.footnote)
            if !plaque.magnification.isEmpty {
                Text(plaque.magnification)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Text(plaque.mass)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if let from = plaque.brokenFrom {
                Text("Broken from \(from)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            HStack {
                if plaque.kept {
                    Label("Kept", systemImage: "checkmark.seal.fill")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.lime)
                } else {
                    // Any body can be kept, whatever its count (plan §6.3).
                    Button("Keep") { controller.keepSelected() }
                        .buttonStyle(.borderedProminent)
                }
                if plaque.grown {
                    Button("Surface") { controller.surface() }
                        .buttonStyle(.bordered)
                } else if plaque.canDive {
                    Button("Dive in") { controller.dive() }
                        .buttonStyle(.bordered)
                }
            }
            .padding(.top, 4)
        }
        .padding(14)
        .frame(maxWidth: 360, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The spawn tray: C₆₀ first, the starters, the scale receipt and Clear.
struct SpawnTray: View {
    let items: [SpawnItem]
    let receipt: [SpawnItem]
    let spawn: @MainActor (SpawnSource) -> Void
    let spawnReceipt: @MainActor () -> Void
    let clear: @MainActor () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(items) { item in
                    Button {
                        spawn(item.source)
                    } label: {
                        chip(item.subtitle.subscriptedFormula, item.title)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(item.title)
                }
                Menu {
                    ForEach(receipt) { rung in
                        Button(rung.title) { spawn(rung.source) }
                    }
                    Button("All three in a row") { spawnReceipt() }
                } label: {
                    chip("NaCl", "Scale receipt")
                }
                Button(action: clear) {
                    chip("Clear", "Poof them all")
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 4)
        }
    }

    private func chip(_ top: String, _ bottom: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(top)
                .font(.headline)
                .foregroundStyle(Color.lime)
            Text(bottom)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.8))
                .lineLimit(1)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

/// The shelf's card (plan §6.4): the snapshot as a small ghost while the session relocalizes,
/// then the ways out when it does not match.
struct ShelfCard: View {
    let prompt: ShelfPrompt
    let snapshot: UIImage?
    let controller: PlayController

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let snapshot, prompt != .coverage {
                Image(uiImage: snapshot)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 72, height: 96)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .opacity(0.7)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                if prompt == .offer || prompt == .lookAtShelf {
                    HStack {
                        Button("Put the shelf here") { controller.putShelfHere() }
                            .buttonStyle(.borderedProminent)
                            .opacity(prompt == .offer ? 1 : 0.6)
                        Button("New room") { controller.startNewRoom() }
                            .buttonStyle(.bordered)
                    }
                    .font(.footnote)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: 360, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var title: String {
        switch prompt {
        case .lookAtShelf: "Look at your shelf"
        case .offer: "Can't find your shelf. Put it here, or start a new room."
        case .placing: "Tap where the shelf should go"
        case .coverage: "Look around the shelf so I can remember it"
        }
    }
}
