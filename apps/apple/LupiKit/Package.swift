// swift-tools-version: 6.0
// LupiKit: the app's pure-Swift core. Foundation only, so it builds and tests
// on Linux CI as well as in Xcode.
import PackageDescription

let package = Package(
    name: "LupiKit",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [
        .library(name: "LupiChem", targets: ["LupiChem"]),
        .library(name: "LupiPlay", targets: ["LupiPlay"]),
        .library(name: "LupiData", targets: ["LupiData"]),
    ],
    targets: [
        .target(name: "LupiChem"),
        .target(name: "LupiPlay", dependencies: ["LupiChem"]),
        .target(
            name: "LupiData",
            dependencies: ["LupiChem"],
            resources: [.copy("Resources/starters"), .copy("Resources/known-molecules.json"), .copy("Resources/discovery.json")]
        ),
        .testTarget(name: "LupiChemTests", dependencies: ["LupiChem"]),
        .testTarget(name: "LupiPlayTests", dependencies: ["LupiPlay", "LupiChem"]),
        .testTarget(name: "LupiDataTests", dependencies: ["LupiData", "LupiChem"]),
    ]
)
