/**
 * Viro's Expo plugin currently writes microphone and photo-library usage
 * descriptions even when an app only uses rear-camera AR. Run this plugin
 * immediately after Viro so Lupi's generated Info.plist stays camera-only.
 *
 * @param {import("@expo/config-plugins").ExpoConfig} config
 */
module.exports = function withViroCameraOnly(config) {
  const infoPlist = config.ios?.infoPlist;
  if (!infoPlist) return config;

  delete infoPlist.NSMicrophoneUsageDescription;
  delete infoPlist.NSPhotoLibraryUsageDescription;
  delete infoPlist.NSPhotoLibraryAddUsageDescription;
  delete infoPlist.NSLocationWhenInUseUsageDescription;
  delete infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription;

  return config;
};
