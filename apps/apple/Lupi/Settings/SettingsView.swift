import SwiftUI
import UIKit

/// Settings (plan §3.2, §5.1, §5.5): the one Sound & haptics toggle, Motion comfort and the
/// Lupi account.
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

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
                    Text("Molecules here are toys. They weigh what a toy of their kind would feel like, and they bounce and break by toy rules. The atoms, their colours and the counts are real.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } header: {
                    Text("Toy physics")
                }
                Section {
                    Toggle("Keep what rests on a shelf", isOn: $model.autoKeep)
                } footer: {
                    Text("A molecule that sits still for three seconds on a shelf, a table or a desk becomes a trophy and stays there for next time. Keep anything by hand from its card.")
                }
                AccountSections()
                Section {
                    LabeledContent("Version", value: Self.version)
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
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }
}
