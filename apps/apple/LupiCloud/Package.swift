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
  ],
  targets: [
    .target(name: "LupiHTTP"),
    .target(name: "LupiAuth", dependencies: ["LupiHTTP"]),
    // Fakes shared by the test targets.
    .target(name: "LupiCloudTesting", dependencies: ["LupiHTTP"]),
    .testTarget(name: "LupiAuthTests", dependencies: ["LupiAuth", "LupiCloudTesting"]),
  ],
  swiftLanguageModes: [.v6]
)
