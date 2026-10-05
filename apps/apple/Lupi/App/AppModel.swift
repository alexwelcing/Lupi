import Foundation
import LupiGame
import LupiPlay
import Observation
import UIKit

/// The player's choice of motion comfort; "system" follows Reduce Motion (plan §5.5).
enum ComfortChoice: String, CaseIterable, Identifiable {
    case system, standard, gentle, still

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "Follow Reduce Motion"
        case .standard: "Standard"
        case .gentle: "Gentle"
        case .still: "Still"
        }
    }

    func comfort(reduceMotion: Bool) -> MotionComfort {
        switch self {
        case .system: MotionComfort.defaultLevel(reduceMotion: reduceMotion)
        case .standard: .standard
        case .gentle: .gentle
        case .still: .still
        }
    }
}

/// App-wide state: the bundled catalog, the settings (kept in UserDefaults), and what Home
/// asked Play to spawn first.
@MainActor
@Observable
final class AppModel {
    let catalog: Catalog?
    let catalogError: String?

    var soundAndHaptics: Bool {
        didSet { UserDefaults.standard.set(soundAndHaptics, forKey: Keys.sound) }
    }

    var comfortChoice: ComfortChoice {
        didSet { UserDefaults.standard.set(comfortChoice.rawValue, forKey: Keys.comfort) }
    }

    var reduceMotion = UIAccessibility.isReduceMotionEnabled
    var showingPlay = false
    /// The play screen's controller, made when Play opens and released when it closes.
    private(set) var playController: PlayController?
    var showDebugHUD = false

    enum Keys {
        static let sound = "lupi.soundAndHaptics"
        static let comfort = "lupi.motionComfort"
    }

    init() {
        do {
            catalog = try Catalog.bundled()
            catalogError = nil
        } catch {
            catalog = nil
            catalogError = "The bundled molecules could not be read: \(error)"
        }
        // Sound & haptics is on by default (D11).
        soundAndHaptics = UserDefaults.standard.object(forKey: Keys.sound) as? Bool ?? true
        comfortChoice = ComfortChoice(rawValue: UserDefaults.standard.string(forKey: Keys.comfort) ?? "") ?? .system
    }

    var comfort: MotionComfort { comfortChoice.comfort(reduceMotion: reduceMotion) }

    var settings: GameSettings {
        GameSettings(
            soundAndHaptics: soundAndHaptics, comfort: comfort, supportsHaptics: Haptics.hardwareSupportsHaptics,
            device: UIDevice.current.userInterfaceIdiom == .pad ? .iPad : .iPhone
        )
    }

    /// Opens Play; the spawn waits until tracking has found the room.
    func play(_ source: SpawnSource?) {
        guard let controller = openPlay() else { return }
        if let source { controller.spawn(source) }
    }

    /// Opens Play with the scale receipt: salt of 10³, 10⁶ and 10⁹ atoms in a row.
    func playReceipt() {
        openPlay()?.spawnReceipt()
    }

    @discardableResult
    private func openPlay() -> PlayController? {
        guard let catalog else { return nil }
        let controller = playController ?? PlayController(catalog: catalog, settings: settings)
        playController = controller
        showingPlay = true
        return controller
    }

    /// After Play is dismissed: stop the session and let the scene go.
    func endPlay() async {
        let controller = playController
        playController = nil
        await controller?.stop()
    }
}
