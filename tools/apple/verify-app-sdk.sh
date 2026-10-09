#!/bin/sh
# Native app acceptance uses the owner's Mac, per docs/ar/plan.md §9.
# This checks unsigned SDK compilation and records the exact clean revision.
set -eu

if [ "$(uname -s)" != Darwin ]; then
  echo 'Apple SDK verification requires macOS with Xcode 26 or later.' >&2
  exit 1
fi
for binary in git xcodegen xcodebuild; do
  if ! command -v "$binary" >/dev/null 2>&1; then
    echo "Missing $binary; install Xcode and XcodeGen before running this check." >&2
    exit 1
  fi
done

script_dir=$(CDPATH='' cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH='' cd "$script_dir/../.." && pwd)
source_revision=$(git -C "$repo_root" rev-parse HEAD)
if ! git -C "$repo_root" diff --quiet || ! git -C "$repo_root" diff --cached --quiet; then
  echo 'Commit or preserve tracked changes first; a build receipt must identify exact source.' >&2
  exit 1
fi
mkdir -p "$repo_root/.verify-artifacts/apple-sdk"
receipt_dir=$(mktemp -d "$repo_root/.verify-artifacts/apple-sdk/$source_revision-XXXXXX")
{
  printf 'source_revision=%s\n' "$source_revision"
  date -u '+started_at=%Y-%m-%dT%H:%M:%SZ'
  xcodebuild -version
  xcodegen --version
  xcodebuild -showsdks
  echo 'signing=disabled; device_behavior=not_checked'
} > "$receipt_dir/receipt.txt"

cd "$repo_root/apps/apple"
xcodegen generate > "$receipt_dir/generate.log" 2>&1
for lane in device simulator; do
  if [ "$lane" = device ]; then
    destination='generic/platform=iOS'
  else
    destination='generic/platform=iOS Simulator'
  fi
  if xcodebuild -project Lupi.xcodeproj -scheme Lupi -configuration Debug \
      -destination "$destination" -derivedDataPath "$receipt_dir/DerivedData-$lane" \
      -resultBundlePath "$receipt_dir/$lane.xcresult" \
      CODE_SIGNING_ALLOWED=NO build > "$receipt_dir/$lane.log" 2>&1; then
    printf '%s=pass\n' "$lane" >> "$receipt_dir/receipt.txt"
  else
    printf '%s=fail\n' "$lane" >> "$receipt_dir/receipt.txt"
    tail -n 60 "$receipt_dir/$lane.log" >&2
    echo "Build failed. Receipt: $receipt_dir/receipt.txt" >&2
    exit 1
  fi
done
if ! git -C "$repo_root" diff --quiet || ! git -C "$repo_root" diff --cached --quiet; then
  echo 'Tracked source changed during the build; do not accept this receipt.' >&2
  exit 1
fi
date -u '+finished_at=%Y-%m-%dT%H:%M:%SZ' >> "$receipt_dir/receipt.txt"
printf 'Unsigned device and Simulator SDK builds passed. Receipt: %s/receipt.txt\n' "$receipt_dir"
echo 'Signing, installation, AR, audio, haptics and installed-host acceptance remain separate checks.'
