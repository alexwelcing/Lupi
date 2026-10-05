// Compiled into the app module for the stand-in check only: Foundation on Linux lacks
// these members, which iOS has.
import Foundation
extension URL {
    static var documentsDirectory: URL { URL(fileURLWithPath: "/") }
    static var applicationSupportDirectory: URL { URL(fileURLWithPath: "/") }
}
extension ProcessInfo {
    enum ThermalState { case nominal, fair, serious, critical }
    var thermalState: ThermalState { .nominal }
}
