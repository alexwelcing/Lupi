#!/bin/sh
# Syntax guard for the iOS app sources (apps/apple/Lupi). Linux cannot build the app
# (SwiftUI, RealityKit and ARKit are Apple-only), but `swiftc -parse` reads every file's
# syntax without resolving a single import, so a stray brace fails CI instead of the
# owner's Mac. Type errors still surface only in Xcode.
#
# Usage: tools/apple/parse-app.sh   (SWIFTC overrides the compiler)
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
app="$root/apps/apple/Lupi"
swiftc=${SWIFTC:-swiftc}

count=$(find "$app" -name '*.swift' -type f | wc -l | tr -d ' ')
if [ "$count" -eq 0 ]; then
  echo "parse-app: no Swift files under apps/apple/Lupi" >&2
  exit 1
fi

find "$app" -name '*.swift' -type f -print0 | sort -z | xargs -0 "$swiftc" -parse -swift-version 6
echo "parse-app: $count files parse"
