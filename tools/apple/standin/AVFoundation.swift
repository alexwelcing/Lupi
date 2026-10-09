// Stand-in for camera authorization (AVCaptureDevice, iOS 7+), as developer.apple.com documents it.
import Foundation
public struct AVMediaType: RawRepresentable, Hashable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public static let video = AVMediaType(rawValue: "vide")
}
@frozen public enum AVAuthorizationStatus: Int, Sendable { case notDetermined, restricted, denied, authorized }
open class AVCaptureDevice: NSObject {
    open class func authorizationStatus(for mediaType: AVMediaType) -> AVAuthorizationStatus { .notDetermined }
    open class func requestAccess(for mediaType: AVMediaType) async -> Bool { false }
}
