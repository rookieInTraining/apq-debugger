// Manual mock of chrome API since jest-chrome requires jsdom
global.chrome = {
  runtime: {
    lastError: null,
    sendMessage: jest.fn((msg, cb) => cb && cb(null)), // simple mock
    onMessage: { addListener: jest.fn() },
    onInstalled: { addListener: jest.fn() },
    onStartup: { addListener: jest.fn() },
    onSuspend: { addListener: jest.fn() },
  },
  debugger: {
    onEvent: { addListener: jest.fn() },
    onDetach: { addListener: jest.fn() },
    attach: jest.fn(),
    detach: jest.fn(),
    sendCommand: jest.fn(),
    getTargets: jest.fn(),
  },
  tabs: {
    query: jest.fn(),
    get: jest.fn(),
    onUpdated: { addListener: jest.fn() },
  },
  action: {
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn(),
    onClicked: { addListener: jest.fn() },
  },
  storage: {
    local: {
      get: jest.fn((keys, cb) => cb && cb({})),
      set: jest.fn((items, cb) => cb && cb()),
      remove: jest.fn((keys, cb) => cb && cb()),
    },
  },
  notifications: {
    create: jest.fn(),
  },
  contextMenus: {
    create: jest.fn(),
    removeAll: jest.fn((cb) => cb && cb()),
    onClicked: { addListener: jest.fn() },
  },
  devtools: {
    inspectedWindow: {
      tabId: 123,
    },
    panels: {
      create: jest.fn(),
    },
  },
};

// Mock TextEncoder/TextDecoder which are not present in all jsdom environments by default
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock btoa/atob for Node.js versions that may not have them
if (typeof btoa === 'undefined') {
  global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
}
if (typeof atob === 'undefined') {
  global.atob = (str) => Buffer.from(str, 'base64').toString('binary');
}

// Mock crypto for JSDOM
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      digest: jest
        .fn()
        .mockResolvedValue(
          new Uint8Array([
            199, 117, 231, 183, 87, 237, 230, 48, 205, 10, 161, 17, 19, 189, 16, 38, 97, 171, 56,
            130, 156, 165, 42, 100, 34, 171, 120, 40, 98, 242, 104, 100,
          ])
        ), // Mock SHA-256 of '1234567890'
    },
  },
});
