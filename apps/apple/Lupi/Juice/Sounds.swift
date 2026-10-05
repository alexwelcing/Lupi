@preconcurrency import AVFAudio
import Foundation
import LupiPlay
import RealityKit

/// The synthesized sound bank as RealityKit audio (plan §5.2): every voice rendered once by
/// LupiKit into Float32 PCM, wrapped in an `AVAudioPCMBuffer` and an `AudioBufferResource`,
/// and played spatially from the body that made it. The tuning pass (plan §8 M4) renders the
/// bank again from a changed `SoundTuning`, kept on the device until it is copied back.
@MainActor
final class Sounds {
    private var resources: [SoundVoice: AudioBufferResource] = [:]
    /// Sounds with no body (a break's shards) play from short-lived entities here.
    let anchor = Entity()
    private(set) var tuning: SoundTuning
    private var generation = 0

    static let tuningKey = "lupi.soundTuning"

    init() {
        // .ambient: the Ring/Silent switch is respected and the player's music keeps playing (plan §5.1).
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        tuning = Self.savedTuning() ?? .v1
    }

    /// The tuning saved by the sound lab, if any.
    static func savedTuning() -> SoundTuning? {
        guard let data = UserDefaults.standard.data(forKey: tuningKey) else { return nil }
        return try? JSONDecoder().decode(SoundTuning.self, from: data)
    }

    /// Renders the bank. About 42 short voices at 48 kHz; done off the main actor.
    func load() async {
        generation += 1
        let mine = generation
        let tuning = self.tuning
        let bank = await Task.detached(priority: .utility) { SoundBank.renderAll(tuning: tuning) }.value
        // A newer tuning arrived while this one rendered: keep that one.
        guard mine == generation else { return }
        for (voice, pcm) in bank {
            guard let format = AVAudioFormat(standardFormatWithSampleRate: pcm.sampleRate, channels: 1),
                  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(pcm.samples.count)),
                  let channel = buffer.floatChannelData?[0] else { continue }
            buffer.frameLength = AVAudioFrameCount(pcm.samples.count)
            pcm.samples.withUnsafeBufferPointer { src in
                if let base = src.baseAddress { channel.update(from: base, count: pcm.samples.count) }
            }
            if let resource = try? AudioBufferResource(buffer: buffer) { resources[voice] = resource }
        }
    }

    /// The sound lab: a new tuning, saved on the device and rendered at once.
    func retune(_ next: SoundTuning) async {
        tuning = next
        if next == .v1 {
            UserDefaults.standard.removeObject(forKey: Self.tuningKey)
        } else if let data = try? JSONEncoder().encode(next) {
            UserDefaults.standard.set(data, forKey: Self.tuningKey)
        }
        await load()
    }

    /// The tuning as pretty JSON, to paste back into `SoundTuning.v1`.
    var tuningJSON: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? encoder.encode(tuning)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    /// Plays a cue on `entity` (spatial), with its gain and playback rate.
    func play(_ cue: SoundCue, on entity: Entity) {
        guard let resource = resources[cue.voice], cue.gain > 0 else { return }
        let controller = entity.playAudio(resource)
        controller.gain = 20 * log10(max(cue.gain, 0.001))
        // RealityKit plays at 0.25 to 4 times speed.
        controller.speed = min(4, max(0.25, cue.rate))
    }

    /// Plays a cue at a world point.
    func play(_ cue: SoundCue, at position: SIMD3<Float>) {
        let e = Entity()
        e.position = position
        anchor.addChild(e)
        play(cue, on: e)
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            e.removeFromParent()
        }
    }
}
