import LupiGame
import RealityKit
import SwiftUI

/// The play screen (plan §3, §8 M0): the room through RealityView, touches straight to the
/// session's gesture arbiter, and the chrome over them.
struct PlayView: View {
    let controller: PlayController
    @Environment(AppModel.self) private var app
    @State private var showingSettings = false

    var body: some View {
        ZStack {
            RealityView { [controller] content in
                controller.attach(&content)
                await controller.start()
            }
            .ignoresSafeArea()
            CoachingOverlay(session: controller.ar.session)
                .ignoresSafeArea()
                .allowsHitTesting(false)
            TouchLayer(
                onTouches: { [controller] in controller.touches($0) },
                onLayout: { [controller] in controller.layout($0, $1, $2) }
            )
            .ignoresSafeArea()
            chrome
        }
        .onChange(of: app.settings, initial: true) { _, settings in controller.apply(settings) }
        .onChange(of: app.showDebugHUD, initial: true) { _, on in controller.showsHUD = on }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
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
            if plaque.grown {
                Button("Surface") { controller.surface() }
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 4)
            } else if plaque.canDive {
                Button("Dive in") { controller.dive() }
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 4)
            }
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
