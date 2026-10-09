import LupiPlay
import SwiftUI
import UIKit

/// The sound lab (plan §8 M4, "a tuning pass on device"): each family's pitch and length as
/// multiples of `SoundTuning.v1`, heard at once from 40 cm ahead. Apply renders the bank again
/// and keeps it on this device; Copy puts the tuning's JSON on the clipboard, to paste back
/// into LupiKit's `SoundTuning.v1`.
struct SoundLabView: View {
    let controller: PlayController
    @Environment(\.dismiss) private var dismiss
    @State private var knobs: [Voice: Knob] = [:]

    /// The tunable voices: the four families, the cage ring and the flap.
    enum Voice: String, CaseIterable, Identifiable {
        case clack, thwap, tink, boing, ring, flap

        var id: String { rawValue }

        var family: ImpactFamily? { ImpactFamily(rawValue: rawValue) }

        var note: String {
            switch self {
            case .clack: "Rigid: hard plastic"
            case .thwap: "Flexible: rubber"
            case .tink: "Brittle: glass"
            case .boing: "Bouncy: a rubber ball"
            case .ring: "Bouncy cages ring after the boing"
            case .flap: "A flexible molecule's loose ends"
            }
        }

        func base(_ t: SoundTuning) -> SoundTuning.Family {
            switch self {
            case .ring: t.ring
            case .flap: t.flap
            default: t.family(family!)
            }
        }

        func set(_ t: inout SoundTuning, _ f: SoundTuning.Family) {
            switch self {
            case .ring: t.ring = f
            case .flap: t.flap = f
            default: t.set(family!, f)
            }
        }

        func voices(hard: Bool) -> SoundVoice {
            switch self {
            case .ring: .ring(.medium)
            case .flap: .flap
            default: .impact(family!, .medium, hard ? .hard : .soft)
            }
        }
    }

    struct Knob: Equatable {
        var pitch = 1.0
        var decay = 1.0
    }

    var body: some View {
        NavigationStack {
            Form {
                ForEach(Voice.allCases) { voice in
                    Section {
                        slider("Pitch", value: binding(voice, \.pitch), range: 0.5...2)
                        slider("Length", value: binding(voice, \.decay), range: 0.25...3)
                        HStack {
                            Button("Soft") { controller.playTest(voice.voices(hard: false)) }
                            Button("Hard") { controller.playTest(voice.voices(hard: true)) }
                        }
                        .buttonStyle(.bordered)
                    } header: {
                        Text(voice.rawValue)
                    } footer: {
                        Text(voice.note)
                    }
                }
                Section {
                    Button("Apply: render the bank again") { controller.retune(tuning) }
                    Button("Copy the tuning as JSON") { UIPasteboard.general.string = controller.soundTuningJSON }
                    Button("Back to v1", role: .destructive) {
                        knobs = [:]
                        controller.retune(.v1)
                    }
                } footer: {
                    Text("Apply, play, and when it sounds right copy the JSON and send it back: it becomes SoundTuning.v1.")
                }
            }
            .navigationTitle("Sound lab")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear { knobs = Self.knobs(from: controller.soundTuning) }
        }
    }

    /// The tuning the knobs describe: v1 with each voice's pitch and length scaled.
    private var tuning: SoundTuning {
        var t = SoundTuning.v1
        for voice in Voice.allCases {
            let k = knobs[voice] ?? Knob()
            voice.set(&t, voice.base(.v1).scaled(pitch: k.pitch, decay: k.decay))
        }
        return t
    }

    /// The knobs of a saved tuning, read back against v1.
    static func knobs(from t: SoundTuning) -> [Voice: Knob] {
        var out: [Voice: Knob] = [:]
        for voice in Voice.allCases {
            let base = voice.base(.v1), now = voice.base(t)
            out[voice] = Knob(pitch: now.fundamental / base.fundamental, decay: now.t60 / base.t60)
        }
        return out
    }

    private func binding(_ voice: Voice, _ key: WritableKeyPath<Knob, Double>) -> Binding<Double> {
        Binding(
            get: { (knobs[voice] ?? Knob())[keyPath: key] },
            set: { knobs[voice, default: Knob()][keyPath: key] = $0 }
        )
    }

    private func slider(_ title: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        HStack {
            Text(title)
                .frame(width: 60, alignment: .leading)
            Slider(value: value, in: range)
            Text(String(format: "×%.2f", value.wrappedValue))
                .font(.footnote.monospacedDigit())
                .frame(width: 52, alignment: .trailing)
        }
    }
}
