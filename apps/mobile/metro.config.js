// Expo's default Metro config detects npm workspaces automatically (watchFolders + nodeModulesPaths),
// so the shared @darna/* packages under /packages resolve without extra configuration.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
