export default {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  moduleFileExtensions: ['js', 'mjs', 'json'],
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/main.js',
    '!src/renderer.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true
};
