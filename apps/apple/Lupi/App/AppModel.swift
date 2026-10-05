import Foundation
import LupiData
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
    /// The trophy case, the shelves and the account (plan §6).
    let collection: CollectionModel

    var soundAndHaptics: Bool {
        didSet { UserDefaults.standard.set(soundAndHaptics, forKey: Keys.sound) }
    }

    var comfortChoice: ComfortChoice {
        didSet { UserDefaults.standard.set(comfortChoice.rawValue, forKey: Keys.comfort) }
    }

    /// Keep what rests on a shelf (plan §6.3); on by default.
    var autoKeep: Bool {
        didSet { UserDefaults.standard.set(autoKeep, forKey: Keys.autoKeep) }
    }

    /// Grow ×2 (scale-spec §10.7): proposed, so off until the player turns it on (plan §11.9).
    var growTwo: Bool {
        didSet { UserDefaults.standard.set(growTwo, forKey: Keys.growTwo) }
    }

    var reduceMotion = UIAccessibility.isReduceMotionEnabled
    var showingPlay = false
    /// The play screen's controller, made when Play opens and released when it closes.
    private(set) var playController: PlayController?
    var showDebugHUD = false
    var showingCollection = false
    /// The trophy chosen in the collection, spawned once its sheet has closed.
    var chosenTrophy: TrophyRecord?

    enum Keys {
        static let sound = "lupi.soundAndHaptics"
        static let comfort = "lupi.motionComfort"
        static let autoKeep = "lupi.autoKeep"
        static let growTwo = "lupi.growTwo"
    }

    init() {
        collection = CollectionModel()
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
        autoKeep = UserDefaults.standard.object(forKey: Keys.autoKeep) as? Bool ?? true
        growTwo = UserDefaults.standard.object(forKey: Keys.growTwo) as? Bool ?? false
    }

    var comfort: MotionComfort { comfortChoice.comfort(reduceMotion: reduceMotion) }

    var settings: GameSettings {
        GameSettings(
            soundAndHaptics: soundAndHaptics, comfort: comfort, supportsHaptics: Haptics.hardwareSupportsHaptics,
            device: UIDevice.current.userInterfaceIdiom == .pad ? .iPad : .iPhone, growTwo: growTwo
        )
    }

    /// Opens Play; the spawn waits until tracking has found the room.
    func play(_ source: SpawnSource?) {
        guard let controller = openPlay() else { return }
        if let source { controller.spawn(source) }
    }

    /// After the collection closes: the trophy chosen in it comes into play (plan §6.4, step 5).
    func playChosenTrophy() {
        guard let trophy = chosenTrophy else { return }
        chosenTrophy = nil
        play(.trophy(trophy))
    }

    /// Opens Play with the scale receipt: salt of 10³, 10⁶ and 10⁹ atoms in a row.
    func playReceipt() {
        openPlay()?.spawnReceipt()
    }

    @discardableResult
    private func openPlay() -> PlayController? {
        guard let catalog else { return nil }
        let controller = playController ?? PlayController(catalog: catalog, settings: settings, collection: collection)
        playController = controller
        collection.onForget = { [weak controller] id in controller?.forget(trophy: id) }
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
