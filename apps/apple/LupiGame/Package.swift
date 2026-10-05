// swift-tools-version: 6.0
// LupiGame: the play session behind the app (plan §3–§5, scale-spec §8–§10),
// everything that needs no Apple framework. The app only adapts RealityKit,
// ARKit and SwiftUI events to it. Foundation only, so it builds and tests on
// Linux CI as well as in Xcode.
import PackageDescription

let package = Package(
    name: "LupiGame",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [
        .library(name: "LupiGame", targets: ["LupiGame"]),
        .library(name: "LupiGameSim", targets: ["LupiGameSim"]),
    ],
    dependencies: [
        .package(path: "../LupiKit"),
        .package(path: "../LupiScale"),
    ],
    targets: [
        .target(
            name: "LupiGame",
            dependencies: [
                .product(name: "LupiChem", package: "LupiKit"),
                .product(name: "LupiPlay", package: "LupiKit"),
                .product(name: "LupiData", package: "LupiKit"),
                .product(name: "LupiScaleCore", package: "LupiScale"),
                .product(name: "LupiScale", package: "LupiScale"),
            ]
        ),
        // A deterministic stand-in for RealityKit's physics, so the session's
        // grab, throw, break and budgets are tested headless.
        .target(name: "LupiGameSim", dependencies: ["LupiGame"]),
        .testTarget(name: "LupiGameTests", dependencies: ["LupiGame", "LupiGameSim"]),
    ]
)
