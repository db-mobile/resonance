// E2E test setup
const { Application } = require('spectron');

global.beforeEach(async () => {
  // Setup before each E2E test
  jest.setTimeout(30000);
});