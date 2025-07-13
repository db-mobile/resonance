const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');

test.describe('Resonance App', () => {
  let electronApp;
  let firstWindow;

  test.beforeAll(async () => {
    // Launch Electron app
    electronApp = await electron.launch({
      args: [
        './src/main.js',
        ...(process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [])
      ],
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

  test('should launch the app', async () => {
    // Check if the window is visible
    await expect(firstWindow).toBeTruthy();
    
    // Check the title
    const title = await firstWindow.title();
    expect(title).toBe('Resonance');
  });

  test('should have main UI elements', async () => {
    // Check for main container
    const mainContainer = await firstWindow.locator('#main-container');
    await expect(mainContainer).toBeVisible();
    
    // Check for collections sidebar
    const collectionsSidebar = await firstWindow.locator('#collections-sidebar');
    await expect(collectionsSidebar).toBeVisible();
    
    // Check for main content area
    const mainContent = await firstWindow.locator('#main-content');
    await expect(mainContent).toBeVisible();
  });

  test('should be able to interact with the app', async () => {
    // Take a screenshot for debugging
    await firstWindow.screenshot({ path: 'tests/screenshots/app-launched.png' });
    
    // Check if URL input is present
    const urlInput = await firstWindow.locator('#url-input');
    await expect(urlInput).toBeVisible();
    
    // Try to type in the URL input
    await urlInput.fill('https://api.example.com/test');
    const value = await urlInput.inputValue();
    expect(value).toBe('https://api.example.com/test');
  });
});