// swift-tools-version: 6.0
import PackageDescription

// The trophy case's account and sync layer for the native app, without the
// Firebase iOS SDK: Firebase Auth and Firestore over REST, Foundation only, so
// it builds and tests on Linux. See docs/ar/account-and-sync.md.
let package = Package(
  name: "LupiCloud",
  platforms: [.iOS("26.0"), .macOS("26.0")],
  products: [
    .library(name: "LupiAuth", targets: ["LupiAuth"]),
    .library(name: "LupiSync", targets: ["LupiSync"]),
    // The in-memory Firebase, for the tests of packages that sync trophies (LupiGame).
    .library(name: "LupiCloudTesting", targets: ["LupiCloudTesting"]),
  ],
  targets: [
    .target(name: "LupiHTTP"),
    .target(name: "LupiAuth", dependencies: ["LupiHTTP"]),
    .target(name: "LupiSync", dependencies: ["LupiHTTP", "LupiAuth"]),
    // Fakes shared by the test targets: a scripted transport and an in-memory
    // Firebase Auth + Firestore that speaks the same REST shapes.
    .target(name: "LupiCloudTesting", dependencies: ["LupiSync"]),
    .testTarget(name: "LupiAuthTests", dependencies: ["LupiAuth", "LupiCloudTesting"]),
    .testTarget(name: "LupiSyncTests", dependencies: ["LupiSync", "LupiAuth", "LupiCloudTesting"]),
  ],
  swiftLanguageModes: [.v6]
)
