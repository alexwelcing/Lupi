import AVFoundation
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
    /// The first-run card (plan §8 M4): why Lupi wants the camera, before iOS asks.
    var onboarding: OnboardingCard?
    /// What opens once the card is through.
    @ObservationIgnored private var afterOnboarding: (@MainActor () -> Void)?
    /// The Collection's plaques, read once per trophy version (plan §8 M4).
    @ObservationIgnored private var plaques: [String: TrophyPlaque] = [:]

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
        gate { [weak self] in
            guard let controller = self?.openPlay() else { return }
            if let source { controller.spawn(source) }
        }
    }

    /// After the collection closes: the trophy chosen in it comes into play (plan §6.4, step 5).
    func playChosenTrophy() {
        guard let trophy = chosenTrophy else { return }
        chosenTrophy = nil
        play(.trophy(trophy))
    }

    /// Opens Play with the scale receipt: salt of 10³, 10⁶ and 10⁹ atoms in a row.
    func playReceipt() {
        gate { [weak self] in self?.openPlay()?.spawnReceipt() }
    }

    /// A trophy's personality line for the Collection, worked out off the main actor and kept.
    func plaque(of trophy: TrophyRecord) async -> TrophyPlaque? {
        let key = "\(trophy.id)@\(trophy.updatedAt.timeIntervalSince1970)"
        if let known = plaques[key] { return known }
        guard let catalog else { return nil }
        let found = await Task.detached(priority: .utility) { catalog.plaque(of: trophy) }.value
        if let found { plaques[key] = found }
        return found
    }

    // MARK: The first-run card (plan §8 M4)

    /// Opens Play at once when the camera is allowed; otherwise shows the card first.
    private func gate(_ then: @escaping @MainActor () -> Void) {
        guard let card = Onboarding.card(camera: Self.cameraAccess) else {
            then()
            return
        }
        afterOnboarding = then
        onboarding = card
    }

    /// The card's button: Continue lets iOS ask for the camera, then opens Play or says no.
    func continueOnboarding() async {
        switch onboarding {
        case .camera?:
            if await AVCaptureDevice.requestAccess(for: .video) {
                onboarding = nil
                let next = afterOnboarding
                afterOnboarding = nil
                next?()
            } else {
                onboarding = .cameraDenied
            }
        case .cameraDenied?:
            openSettings()
        case .cameraRestricted?, nil:
            break
        }
    }

    func dismissOnboarding() {
        onboarding = nil
        afterOnboarding = nil
    }

    private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    static var cameraAccess: CameraAccess {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .notDetermined: .notDetermined
        case .authorized: .authorized
        case .denied: .denied
        case .restricted: .restricted
        @unknown default: .denied
        }
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
