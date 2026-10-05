import Foundation

/// What the camera's permission is, as `AVCaptureDevice.authorizationStatus(for: .video)` says.
public enum CameraAccess: Sendable, Equatable {
    case notDetermined, authorized, denied, restricted
}

/// The first-run card (plan §8 M4): one card that says why Lupi wants the camera before iOS
/// asks, and a way back to Settings if the answer was no.
public enum OnboardingCard: Sendable, Equatable {
    /// Before the system prompt: what the camera is for, then Continue asks.
    case camera
    /// The camera was refused: Play cannot open until Settings allows it.
    case cameraDenied
    /// Restricted by Screen Time or a profile: nothing in the app can change it.
    case cameraRestricted

    public var title: String {
        switch self {
        case .camera: "Your room is the playground"
        case .cameraDenied: "Lupi needs the camera"
        case .cameraRestricted: "The camera is turned off here"
        }
    }

    /// Plain words; the privacy line matches the Info.plist's NSCameraUsageDescription.
    public var body: [String] {
        switch self {
        case .camera:
            [
                "Lupi puts molecules in your room through the camera, so you can throw them at your walls, stack them on your desk and leave them on a shelf.",
                "What the camera sees stays on this device. Lupi never records or uploads it.",
                "Next, iOS asks to use the camera.",
            ]
        case .cameraDenied:
            [
                "Without the camera there is no room to play in. Turn on Camera for Lupi in Settings, then come back.",
                "What the camera sees stays on this device.",
            ]
        case .cameraRestricted:
            ["Camera use is restricted on this device, by Screen Time or a profile, so Lupi cannot open the room."]
        }
    }

    /// The button's words: Continue asks iOS, Open Settings leaves for Settings.
    public var action: String? {
        switch self {
        case .camera: "Continue"
        case .cameraDenied: "Open Settings"
        case .cameraRestricted: nil
        }
    }
}

public enum Onboarding {
    /// The card to show before Play opens, or nil to open it at once.
    public static func card(camera: CameraAccess) -> OnboardingCard? {
        switch camera {
        case .notDetermined: .camera
        case .authorized: nil
        case .denied: .cameraDenied
        case .restricted: .cameraRestricted
        }
    }
}
