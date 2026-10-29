import SwiftUI
import UIKit

/// Settings (plan §3.2, §5.1, §5.5): the one Sound & haptics toggle, Motion comfort and the
/// Lupi account.
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var copiedBuild = false
    @State private var copiedSession = false

    var body: some View {
        @Bindable var model = app
        NavigationStack {
            Form {
                Section {
                    Toggle("Sound & haptics", isOn: $model.soundAndHaptics)
                } footer: {
                    Text(Haptics.hardwareSupportsHaptics
                        ? "Every bump, bounce and break has a sound and a tap you can feel. The Ring/Silent switch silences the sound."
                        : "Every bump, bounce and break has a sound. This device has no haptic engine, so there is nothing to feel.")
                }
                Section {
                    Picker("Motion comfort", selection: $model.comfortChoice) {
                        ForEach(ComfortChoice.allCases) { choice in
                            Text(choice.title).tag(choice)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("Motion comfort")
                } footer: {
                    Text("Gentle halves squash, sparks and spin, slows the fastest throws and drops hit-stop and slow motion. Still keeps your own throws as short lobs and stops everything that moves by itself: a flash instead of sparks, no squash or spin, and scale changes cut instead of gliding. Following Reduce Motion picks Still when it is on and Standard when it is off; it is \(app.reduceMotion ? "on" : "off") now.")
                }
                Section {
                    Text("Molecules here are toys. How heavy they feel, how they tumble and which bond breaks first are loosely inspired by each molecule's real mass, shape and bonds, and the weights are squeezed so everything can be thrown. Each has a personality from its bonds: rigid ones clack, flexible ones flop, brittle ones crack, bouncy ones boing, and its card says why. None of it is a simulation. The atoms, their colours and the counts are real.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } header: {
                    Text("Toy physics")
                }
                Section {
                    Toggle("Grow ×2", isOn: $model.growTwo)
                } header: {
                    Text("Scale")
                } footer: {
                    Text("Adds Grow ×2 to a molecule's card: each tap doubles it along one side, keeping its size in your hand, so a water tapped a hundred times holds 3 × 2¹⁰⁰ atoms. Kept, it is still a few hundred bytes.")
                }
                Section {
                    Toggle("Keep what rests on a shelf", isOn: $model.autoKeep)
                } footer: {
                    Text("A molecule that sits still for three seconds on a shelf, a table or a desk becomes a trophy and stays there for next time. Keep anything by hand from its card.")
                }
                AccountSections()
                Section {
                    LabeledContent("Version", value: BuildIdentity.current.versionLabel)
                    LabeledContent("Revision", value: BuildIdentity.current.revisionLabel)
                    Button(copiedBuild ? "Build diagnostics copied" : "Copy build diagnostics") {
                        UIPasteboard.general.string = BuildIdentity.current.diagnosticText
                        copiedBuild = true
                    }
                    if let receipt = app.lastSessionReceiptJSON {
                        Button(copiedSession ? "Last session receipt copied" : "Copy last session receipt (JSON)") {
                            UIPasteboard.general.string = receipt
                            copiedSession = true
                        }
                    }
                } header: {
                    Text("This build")
                } footer: {
                    Text("Copies the version, source revision and build time. A completed session receipt is available until Lupi closes. Account details and room data stay out of the report.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    static var version: String {
        BuildIdentity.current.versionLabel
    }
}
