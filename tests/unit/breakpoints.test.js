let bp;

beforeEach(() => {
  jest.clearAllMocks();
  chrome.storage.local.get.mockImplementation((k, cb) => cb({}));
  chrome.storage.local.set.mockImplementation((i, cb) => cb && cb());
  chrome.storage.session.get.mockImplementation((k, cb) => cb({}));
  chrome.storage.session.set.mockImplementation((i, cb) => cb && cb());
  jest.isolateModules(() => {
    bp = require('../../js/sw/breakpoints.js');
  });
});

const active = { tabId: 1, passive: false };
const named = { operationName: 'GetCart', isHashOnly: false };

test('nothing pauses when debug mode is off and pause-next is off', async () => {
  await bp.setBreakpoints([{ name: 'GetCart', enabled: true }]);
  expect(bp.decidePause(named, active)).toBeNull();
});

test('enabled breakpoint pauses a full-query request in active mode', async () => {
  await bp.setBreakpoints([{ name: 'GetCart', enabled: true }]);
  await bp.setDebugMode(1, true);
  expect(bp.decidePause(named, active)).toBe('breakpoint');
});

test('disabled breakpoint and other names do not pause', async () => {
  await bp.setBreakpoints([
    { name: 'GetCart', enabled: false },
    { name: 'X', enabled: true },
  ]);
  await bp.setDebugMode(1, true);
  expect(bp.decidePause(named, active)).toBeNull();
});

test('matching is case-sensitive', async () => {
  await bp.setBreakpoints([{ name: 'getcart', enabled: true }]);
  await bp.setDebugMode(1, true);
  expect(bp.decidePause(named, active)).toBeNull();
});

test('hash-only never pauses in active mode, even with pause-next', async () => {
  await bp.setBreakpoints([{ name: 'GetCart', enabled: true }]);
  await bp.setDebugMode(1, true);
  await bp.setPauseNext(1, true);
  expect(bp.decidePause({ operationName: 'GetCart', isHashOnly: true }, active)).toBeNull();
});

test('hash-only pauses in passive mode', async () => {
  await bp.setBreakpoints([{ name: 'GetCart', enabled: true }]);
  await bp.setDebugMode(1, true);
  expect(
    bp.decidePause({ operationName: 'GetCart', isHashOnly: true }, { tabId: 1, passive: true })
  ).toBe('breakpoint');
});

test('pause-next catches anonymous requests regardless of debug mode, and is one-shot', async () => {
  await bp.setPauseNext(1, true);
  const anon = { operationName: '', isHashOnly: false };
  expect(bp.decidePause(anon, active)).toBe('pause-next');
  await bp.consumePauseNext(1);
  expect(bp.decidePause(anon, active)).toBeNull();
});

test('pause-next wins over breakpoint for the reason', async () => {
  await bp.setBreakpoints([{ name: 'GetCart', enabled: true }]);
  await bp.setDebugMode(1, true);
  await bp.setPauseNext(1, true);
  expect(bp.decidePause(named, active)).toBe('pause-next');
});

test('anonymous never matches a breakpoint', async () => {
  await bp.setBreakpoints([{ name: '', enabled: true }]);
  await bp.setDebugMode(1, true);
  expect(bp.decidePause({ operationName: '', isHashOnly: false }, active)).toBeNull();
});

test('setBreakpoints trims, dedupes and drops empties', async () => {
  expect(
    await bp.setBreakpoints([
      { name: ' A ', enabled: true },
      { name: 'A', enabled: false },
      { name: '', enabled: true },
    ])
  ).toEqual([{ name: 'A', enabled: true }]);
});

test('setBreakpoints caps the list and persists to local storage', async () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ name: `Op${i}`, enabled: true }));
  const stored = await bp.setBreakpoints(many);
  expect(stored).toHaveLength(100);
  expect(chrome.storage.local.set).toHaveBeenCalledWith(
    { gqlBreakpoints: stored },
    expect.any(Function)
  );
});

test('state is per tab and persisted to session storage', async () => {
  await bp.setDebugMode(1, true);
  expect(bp.getDebugState(2)).toEqual({ debugMode: false, pauseNext: false });
  expect(chrome.storage.session.set).toHaveBeenCalledWith(
    { gqlDebugState: { 1: { debugMode: true, pauseNext: false } } },
    expect.any(Function)
  );
});

test('clearDebugState removes a tab', async () => {
  await bp.setDebugMode(1, true);
  await bp.clearDebugState(1);
  expect(bp.getDebugState(1)).toEqual({ debugMode: false, pauseNext: false });
});

test('initBreakpoints restores list from local and debug state from session', async () => {
  chrome.storage.local.get.mockImplementation((k, cb) =>
    cb({ gqlBreakpoints: [{ name: 'A', enabled: true }] })
  );
  chrome.storage.session.get.mockImplementation((k, cb) =>
    cb({ gqlDebugState: { 1: { debugMode: true, pauseNext: false } } })
  );
  await bp.initBreakpoints();
  expect(bp.getBreakpoints()).toEqual([{ name: 'A', enabled: true }]);
  expect(bp.getDebugState(1).debugMode).toBe(true);
});

test('initBreakpoints is idempotent', async () => {
  const p = bp.initBreakpoints();
  expect(bp.initBreakpoints()).toBe(p);
  await p;
  expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
});
