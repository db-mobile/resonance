// Mock Tauri API
global.window = {
  __TAURI__: true
};

global.document = {
  getElementById: jest.fn(),
  createElement: jest.fn(),
  addEventListener: jest.fn(),
  querySelector: jest.fn(),
  querySelectorAll: jest.fn(() => [])
};

// Mock Tauri invoke API (used by ipcBridge)
global.__TAURI_INTERNALS__ = {
  invoke: jest.fn()
};

// Mock IPC Bridge (Tauri-compatible)
global.ipcBridge = {
  sendApiRequest: jest.fn(),
  importCollection: jest.fn(),
  store: {
    get: jest.fn(),
    set: jest.fn()
  },
  settings: {
    get: jest.fn(),
    set: jest.fn()
  }
};

// Mock localStorage
global.localStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn()
};

// Suppress console warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn()
};
