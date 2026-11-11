module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts?(x)"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|@darna/.*|openapi-fetch|i18next|react-i18next))",
  ],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
