let presence;
let onConnect;

function makePort(name) {
  const disconnectListeners = [];
  return {
    name,
    onDisconnect: { addListener: jest.fn((fn) => disconnectListeners.push(fn)) },
    disconnect() {
      disconnectListeners.forEach((fn) => fn(this));
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.isolateModules(() => {
    presence = require('../../js/sw/panel-presence.js');
  });
});

function init(onLast = jest.fn()) {
  presence.initPanelPresence(onLast);
  onConnect = chrome.runtime.onConnect.addListener.mock.calls[0][0];
  return onLast;
}

test('a gql-panel:<tabId> port marks the tab connected', () => {
  init();
  expect(presence.isPanelConnected(123)).toBe(false);
  onConnect(makePort('gql-panel:123'));
  expect(presence.isPanelConnected(123)).toBe(true);
  expect(presence.isPanelConnected(124)).toBe(false);
});

test('ports with other names are ignored', () => {
  init();
  const other = makePort('something-else');
  onConnect(other);
  onConnect(makePort('gql-panel:abc'));
  onConnect(makePort('gql-panel:'));
  expect(presence.isPanelConnected(123)).toBe(false);
  expect(other.onDisconnect.addListener).not.toHaveBeenCalled();
});

test('onLastDisconnect fires only when the last port for the tab goes', () => {
  const onLast = init();
  const a = makePort('gql-panel:123');
  const b = makePort('gql-panel:123');
  onConnect(a);
  onConnect(b);

  a.disconnect();
  expect(onLast).not.toHaveBeenCalled();
  expect(presence.isPanelConnected(123)).toBe(true);

  b.disconnect();
  expect(onLast).toHaveBeenCalledWith(123);
  expect(onLast).toHaveBeenCalledTimes(1);
  expect(presence.isPanelConnected(123)).toBe(false);
});

test('a throwing disconnect handler does not escape the listener', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation();
  init(() => {
    throw new Error('boom');
  });
  const port = makePort('gql-panel:5');
  onConnect(port);
  expect(() => port.disconnect()).not.toThrow();
  expect(presence.isPanelConnected(5)).toBe(false);
  spy.mockRestore();
});
