#!/usr/bin/env python3
"""Inspect this local-only Lupi release archive; never claim App Store acceptance."""
import argparse
import json
import plistlib
import re
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Path to a Lupi .xcarchive")
    args = parser.parse_args()
    app = args.archive / "Products/Applications/Lupi.app"
    receipt = {"schema": "lupi.store-archive-inspection.v1", "checks": {}, "errors": [],
               "appStoreValidation": "not_checked", "uploadAcceptance": "not_checked"}

    def check(name, passed, message):
        receipt["checks"][name] = bool(passed)
        if not passed:
            receipt["errors"].append(message)

    def read_plist(path):
        try:
            value = plistlib.loads(path.read_bytes())
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (OSError, ValueError, plistlib.InvalidFileException):
            check(path.name, False, f"Cannot read {path.name}; regenerate or rebuild the archive.")
            return {}

    def run(command):
        try:
            return subprocess.run(command, capture_output=True, check=False)
        except OSError:
            check(command[0], False, f"Cannot run {command[0]}; use macOS with Xcode command-line tools.")
            return None

    check("archive", args.archive.is_dir() and args.archive.suffix == ".xcarchive" and app.is_dir(),
          "Supply an .xcarchive containing Products/Applications/Lupi.app.")
    info = read_plist(app / "Info.plist")
    check("bundleIdentifier", info.get("CFBundleIdentifier") == "live.lupi.app", "Bundle identifier must be live.lupi.app.")
    for key in ("CFBundleShortVersionString", "CFBundleVersion", "NSCameraUsageDescription"):
        value = info.get(key)
        check(key, isinstance(value, str) and bool(value.strip()) and "$(" not in value, f"Set a resolved, nonempty {key} before archiving.")
    capabilities = info.get("UIRequiredDeviceCapabilities", [])
    check("arkit", "arkit" in capabilities if isinstance(capabilities, list) else
          isinstance(capabilities, dict) and capabilities.get("arkit") is True, "Declare ARKit as a required device capability.")
    check("accountsDisabled", all(info.get(key) is None or info.get(key) == "" for key in
          ("LupiFirebaseAPIKey", "LupiFirebaseProjectID")),
          "This release requires blank Firebase configuration; review privacy and account readiness before enabling it.")
    receipt["app"] = {"bundleIdentifier": info.get("CFBundleIdentifier"),
                      "version": info.get("CFBundleShortVersionString"), "build": info.get("CFBundleVersion")}
    try:
        identity = json.loads((app / "LupiBuildIdentity.json").read_text())
        if not isinstance(identity, dict):
            raise ValueError()
    except (OSError, ValueError):
        identity = {}
    check("buildIdentity", identity.get("schemaVersion") == 1 and identity.get("workTree") == "clean" and
          isinstance(identity.get("revision"), str) and bool(re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", identity["revision"])),
          "Archive a clean, known Git revision with LupiBuildIdentity.json stamped by the build script.")
    receipt["source"] = {key: identity.get(key) for key in ("revision", "workTree", "builtAt")}

    privacy = read_plist(app / "PrivacyInfo.xcprivacy")
    api_reasons = {row.get("NSPrivacyAccessedAPIType"): row.get("NSPrivacyAccessedAPITypeReasons", [])
                   for row in privacy.get("NSPrivacyAccessedAPITypes", [])}
    for category, reason in (("UserDefaults", "CA92.1"), ("SystemBootTime", "35F9.1")):
        check(category, reason in api_reasons.get("NSPrivacyAccessedAPICategory" + category, []),
              f"PrivacyInfo.xcprivacy must declare {category} reason {reason}.")
    collected = privacy.get("NSPrivacyCollectedDataTypes", [])
    searches = [row for row in collected if row.get("NSPrivacyCollectedDataType") == "NSPrivacyCollectedDataTypeSearchHistory"]
    check("searchPrivacy", bool(searches) and all(row.get("NSPrivacyCollectedDataTypeLinked") is True and
          row.get("NSPrivacyCollectedDataTypeTracking") is False and "NSPrivacyCollectedDataTypePurposeAppFunctionality" in
          row.get("NSPrivacyCollectedDataTypePurposes", []) for row in searches),
          "Declare linked SearchHistory for AppFunctionality without tracking.")
    check("noTracking", privacy.get("NSPrivacyTracking") is False and all(
          row.get("NSPrivacyCollectedDataTypeTracking") is False for row in collected), "Tracking must remain false for this release.")

    verified = run(["codesign", "--verify", "--deep", "--strict", str(app)])
    check("codeSignature", verified is not None and verified.returncode == 0,
          "Code signature verification failed; inspect with codesign --verify --deep --strict and rebuild/re-sign.")
    signing = run(["codesign", "-d", "--verbose=4", str(app)])
    metadata = signing.stderr.decode(errors="replace").splitlines() if signing else []
    authorities = [line.removeprefix("Authority=") for line in metadata if line.startswith("Authority=")]
    team = next((line.removeprefix("TeamIdentifier=") for line in metadata if line.startswith("TeamIdentifier=")), None)
    entitlements_result = run(["codesign", "-d", "--entitlements", ":-", str(app)])
    profile_result = run(["security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")])
    decoded = []
    for label, result in (("signed entitlements", entitlements_result), ("embedded provisioning profile", profile_result)):
        try:
            if result is None or result.returncode != 0:
                raise ValueError()
            value = plistlib.loads(result.stdout)
            if not isinstance(value, dict):
                raise ValueError()
            decoded.append(value)
        except (ValueError, plistlib.InvalidFileException):
            decoded.append({})
            check(label, False, f"Cannot decode {label}; use a provisioned, signed device archive.")
    entitlements, profile = decoded
    profile_entitlements = profile.get("Entitlements", {})
    get_task_allow = entitlements.get("get-task-allow")
    check("signingProfile", bool(team) and team != "not set" and
          team in profile.get("TeamIdentifier", []) and isinstance(get_task_allow, bool) and
          get_task_allow == profile_entitlements.get("get-task-allow"),
          "Signed team/get-task-allow must match the embedded provisioning profile.")
    kind = ("development" if get_task_allow is True else "enterprise" if profile.get("ProvisionsAllDevices") else
            "ad-hoc" if profile.get("ProvisionedDevices") else "app-store-distribution-candidate" if profile else "unknown")
    receipt["signing"] = {"authorities": authorities, "teamIdentifier": team,
                          "getTaskAllow": get_task_allow, "profileKind": kind}
    receipt["distribution"] = ("Development-signed archive; cannot upload as App Store distribution."
                               if kind == "development" else "Distribution upload and Apple validation remain unverified.")
    receipt["status"] = "pass" if not receipt["errors"] else "fail"
    print(json.dumps(receipt, indent=2))
    return 0 if not receipt["errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
