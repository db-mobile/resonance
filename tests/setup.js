// Mock Electron modules
global.window = {};
global.document = {
  getElementById: jest.fn(),
  createElement: jest.fn(),
  addEventListener: jest.fn(),
  querySelector: jest.fn(),
  querySelectorAll: jest.fn(() => [])
};

// Mock IPC
global.electronAPI = {
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