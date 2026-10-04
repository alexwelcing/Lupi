// swift-tools-version: 6.0
// LupiKit: the app's pure-Swift core. Foundation only, so it builds and tests
// on Linux CI as well as in Xcode.
import PackageDescription

let package = Package(
    name: "LupiKit",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [
        .library(name: "LupiChem", targets: ["LupiChem"]),
    ],
    targets: [
        .target(name: "LupiChem"),
        .testTarget(name: "LupiChemTests", dependencies: ["LupiChem"]),
    ]
)
