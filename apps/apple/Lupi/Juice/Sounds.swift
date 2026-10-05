@preconcurrency import AVFAudio
import Foundation
import LupiPlay
import RealityKit

/// The synthesized sound bank as RealityKit audio (plan §5.2): every voice rendered once by
/// LupiKit into Float32 PCM, wrapped in an `AVAudioPCMBuffer` and an `AudioBufferResource`,
/// and played spatially from the body that made it.
@MainActor
final class Sounds {
    private var resources: [SoundVoice: AudioBufferResource] = [:]
    /// Sounds with no body (a break's shards) play from short-lived entities here.
    let anchor = Entity()

    init() {
        // .ambient: the Ring/Silent switch is respected and the player's music keeps playing (plan §5.1).
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    /// Renders the bank. About 37 short voices at 48 kHz; done once, off the main actor.
    func load() async {
        let bank = await Task.detached(priority: .utility) { SoundBank.renderAll() }.value
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

    /// Plays a cue on `entity` (spatial), with its gain and playback rate.
    func play(_ cue: SoundCue, on entity: Entity) {
        guard let resource = resources[cue.voice], cue.gain > 0 else { return }
        let controller = entity.playAudio(resource)
        controller.gain = 20 * log10(max(cue.gain, 0.001))
        controller.speed = cue.rate
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
