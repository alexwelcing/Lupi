// Stand-in for Core Image, as developer.apple.com documents the calls the app makes.
import ARKit
import Foundation
public enum CGImagePropertyOrientation: UInt32, Sendable { case up = 1, upMirrored, down, downMirrored, leftMirrored, right, rightMirrored, left }
public struct CGAffineTransform: Sendable { public init(scaleX: CGFloat, y: CGFloat) {} }
public final class CGColorSpace {
    public static let sRGB = "kCGColorSpaceSRGB"
    public init?(name: String) {}
}
public struct CIImageRepresentationOption: Hashable, Sendable { public let rawValue: String }
open class CIImage {
    public init(cvPixelBuffer: CVPixelBuffer) {}
    open func oriented(_ orientation: CGImagePropertyOrientation) -> CIImage { self }
    open func transformed(by matrix: CGAffineTransform) -> CIImage { self }
}
open class CIContext {
    public init() {}
    open func jpegRepresentation(of image: CIImage, colorSpace: CGColorSpace, options: [CIImageRepresentationOption: Any] = [:]) -> Data? { nil }
}
