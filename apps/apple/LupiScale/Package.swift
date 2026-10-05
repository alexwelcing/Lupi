// swift-tools-version: 6.0
// LupiScale: the scale spine (docs/ar/scale-spec.md, D14). Foundation only,
// so it builds and tests on Linux CI as well as in Xcode.
import PackageDescription

let package = Package(
    name: "LupiScale",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [
        .library(name: "LupiScaleCore", targets: ["LupiScaleCore"]),
        .library(name: "LupiScale", targets: ["LupiScale"]),
    ],
    dependencies: [
        .package(path: "../LupiKit"),
    ],
    targets: [
        // Everything the spec marks [B]: bytes, hashes, records, generators,
        // paths, Magnitude, packs and references. No dependencies, so the
        // byte-exact layer never moves with anything else.
        .target(name: "LupiScaleCore"),
        .target(
            name: "LupiScale",
            dependencies: [
                "LupiScaleCore",
                .product(name: "LupiChem", package: "LupiKit"),
                .product(name: "LupiPlay", package: "LupiKit"),
            ]
        ),
        .testTarget(
            name: "LupiScaleCoreTests",
            dependencies: ["LupiScaleCore", .product(name: "LupiChem", package: "LupiKit")]
        ),
        .testTarget(
            name: "LupiScaleTests",
            dependencies: [
                "LupiScale",
                "LupiScaleCore",
                .product(name: "LupiChem", package: "LupiKit"),
                .product(name: "LupiPlay", package: "LupiKit"),
            ]
        ),
    ]
)
