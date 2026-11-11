import type { ExpoConfig } from "expo/config";

/**
 * Darna mobile app config.
 *
 * Env:
 *   EXPO_PUBLIC_API_URL  API base URL. Default http://localhost:8000 (on the Android emulator the
 *                        runtime default becomes http://10.0.2.2:8000, see src/config.ts).
 */
const config: ExpoConfig = {
  name: "Darna",
  slug: "darna",
  scheme: "darna",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "com.darna.app", // placeholder: replace with the registered App ID
    supportsTablet: false,
  },
  android: {
    package: "com.darna.app", // placeholder: replace with the Play Console application id
    adaptiveIcon: { foregroundImage: "./assets/icon.png", backgroundColor: "#2E4A3C" },
  },
  web: { bundler: "metro", output: "single", favicon: "./assets/icon.png" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    // Arabic is a first-class language: the native layout may flip to RTL.
    ["expo-localization", { supportsRTL: true }],
    [
      "expo-image-picker",
      {
        photosPermission: "Darna uses your photos so you can add pictures of your property and upload documents.",
        cameraPermission: "Darna uses the camera so you can photograph your property and documents.",
      },
    ],
  ],
  extra: {
    supportsRTL: true,
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000",
  },
};

export default config;
