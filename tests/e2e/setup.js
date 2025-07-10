// E2E test setup for Playwright
const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');

// Global setup for Playwright Electron tests
let electronApp;
let firstWindow;

test.beforeAll(async () => {
  // Launch Electron app
  electronApp = await electron.launch({
    args: ['./src/main.js'],
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  });
  
  // Wait for the first BrowserWindow to open
  firstWindow = await electronApp.firstWindow();
});

test.afterAll(async () => {
  // Close Electron app
  await electronApp.close();
});

module.exports = { electronApp, firstWindow };