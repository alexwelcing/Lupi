#!/bin/sh
# Focused, dependency-free checks for identity stamping and the pure receipt model.
set -eu
diagnostics_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
diagnostics_tmp=$(mktemp -d)
trap 'rm -rf "$diagnostics_tmp"' EXIT HUP INT TERM
diagnostics_swiftc=${SWIFTC:-swiftc}
"$diagnostics_swiftc" -parse-as-library -swift-version 6 -module-cache-path "$diagnostics_tmp/modules" \
  "$diagnostics_root/apps/apple/Lupi/App/BuildIdentity.swift" \
  "$diagnostics_root/apps/apple/Lupi/Debug/SessionReceipt.swift" \
  "$diagnostics_root/tools/apple/tests/DiagnosticsTests.swift" \
  -o "$diagnostics_tmp/check"
"$diagnostics_tmp/check"

mkdir "$diagnostics_tmp/repo with spaces"
git -C "$diagnostics_tmp/repo with spaces" init --quiet
printf 'source\n' > "$diagnostics_tmp/repo with spaces/source"
git -C "$diagnostics_tmp/repo with spaces" add source
git -C "$diagnostics_tmp/repo with spaces" -c user.name='Diagnostics test' -c user.email='diagnostics@example.invalid' commit --quiet -m fixture
diagnostics_revision=$(git -C "$diagnostics_tmp/repo with spaces" rev-parse HEAD)
diagnostics_output="$diagnostics_tmp/built resources/identity.json"
/bin/sh "$diagnostics_root/tools/apple/stamp-build.sh" "$diagnostics_output" "$diagnostics_tmp/repo with spaces"
"$diagnostics_tmp/check" "$diagnostics_output" "$diagnostics_revision" clean
printf 'changed\n' >> "$diagnostics_tmp/repo with spaces/source"
/bin/sh "$diagnostics_root/tools/apple/stamp-build.sh" "$diagnostics_output" "$diagnostics_tmp/repo with spaces"
"$diagnostics_tmp/check" "$diagnostics_output" "$diagnostics_revision" dirty
git -C "$diagnostics_tmp/repo with spaces" restore source
printf 'new\n' > "$diagnostics_tmp/repo with spaces/untracked"
/bin/sh "$diagnostics_root/tools/apple/stamp-build.sh" "$diagnostics_output" "$diagnostics_tmp/repo with spaces"
"$diagnostics_tmp/check" "$diagnostics_output" "$diagnostics_revision" dirty
/bin/sh "$diagnostics_root/tools/apple/stamp-build.sh" "$diagnostics_output" "$diagnostics_tmp/missing-repo"
"$diagnostics_tmp/check" "$diagnostics_output" null unknown
echo 'Build stamp tests passed: clean, tracked edits, untracked edits, missing Git, paths with spaces and overwrite.'
