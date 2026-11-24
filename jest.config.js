const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "testHelpers\\.ts$",
    "Mocks\\.ts$",
  ],
  moduleNameMapper: {
    "service_key\\.json$": "<rootDir>/src/__mocks__/service_key.json",
    "^firebase-admin$": "<rootDir>/src/__mocks__/firebaseAdmin.js",
  },
};