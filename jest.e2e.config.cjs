module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/e2e/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/setup.js'],
  testTimeout: 30000,
  globalSetup: '<rootDir>/tests/e2e/globalSetup.js',
  globalTeardown: '<rootDir>/tests/e2e/globalTeardown.js'
};