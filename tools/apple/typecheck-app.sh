#!/bin/sh
# Stand-in type-check of the iOS app (apps/apple/Lupi) on Linux. The app's own packages are
# built for real; the Apple frameworks it imports are replaced by the stand-ins in
# tools/apple/standin, which declare only what the app calls, spelled as developer.apple.com
# documents it. So this catches the app calling a package API that changed, a typo in its
# own names, or an isolation error against a documented signature, before the owner's Mac
# does. It proves nothing about the frameworks themselves: a stand-in that is wrong about
# Apple's API passes code that Xcode will reject. When the app starts using a new Apple
# API, add it to the stand-in from its documentation page.
#
# Usage: tools/apple/typecheck-app.sh   (SWIFT and SWIFTC override the tools)
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
app="$root/apps/apple/Lupi"
standin="$root/tools/apple/standin"
game="$root/apps/apple/LupiGame"
swift=${SWIFT:-swift}
swiftc=${SWIFTC:-swiftc}

# LupiGame depends on every other package the app imports, so its build has all their modules.
"$swift" build --package-path "$game"
bin=$("$swift" build --package-path "$game" --show-bin-path)

mods=$(mktemp -d)
trap 'rm -rf "$mods"' EXIT
# In dependency order: each stand-in may import the ones before it.
for m in simd UIKit SwiftUI CoreMedia CoreHaptics AVFAudio AVFoundation ARKit RealityKit CoreImage Security AuthenticationServices; do
  "$swiftc" -emit-module -parse-as-library -swift-version 6 -module-name "$m" -I "$mods" \
    -emit-module-path "$mods/$m.swiftmodule" "$standin/$m.swift"
done

count=$(find "$app" -name '*.swift' -type f | wc -l | tr -d ' ')
find "$app" -name '*.swift' -type f -print0 | sort -z | xargs -0 "$swiftc" -typecheck -parse-as-library -swift-version 6 \
  -module-name Lupi -I "$mods" -I "$bin" "$standin/LinuxShims.swift"
echo "typecheck-app: $count files type-check against the stand-ins"
