let pq;

const held = (over = {}) => ({
  id: 'r1',
  networkId: 'n1',
  tabId: 1,
  url: 'https://x.test/graphql',
  method: 'POST',
  heldAt: 1,
  reason: 'breakpoint',
  state: 'paused',
  body: {},
  rawHeaders: {},
  operations: [],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  chrome.runtime.lastError = undefined;
  chrome.storage.session.get.mockImplementation((k, cb) => cb({}));
  chrome.storage.session.set.mockImplementation((i, cb) => cb && cb());
  chrome.debugger.sendCommand.mockImplementation((t, m, p, cb) => cb && cb({}));
  jest.isolateModules(() => {
    pq = require('../../js/sw/pause-queue.js');
  });
});

afterEach(() => {
  chrome.runtime.lastError = undefined;
});

function failCdp() {
  chrome.debugger.sendCommand.mockImplementation((t, m, p, cb) => {
    chrome.runtime.lastError = { message: 'Invalid InterceptionId.' };
    cb();
    chrome.runtime.lastError = undefined;
  });
}

test('holdRequest lists and persists under gqlPausedQueue', async () => {
  expect(await pq.holdRequest(held())).toBe(true);
  expect(pq.listPaused(1)).toHaveLength(1);
  expect(pq.getHeld(1, 'r1').networkId).toBe('n1');
  expect(chrome.storage.session.set).toHaveBeenCalledWith(
    { gqlPausedQueue: expect.objectContaining({ 1: [expect.objectContaining({ id: 'r1' })] }) },
    expect.any(Function)
  );
});

test('51st hold on one tab is refused', async () => {
  for (let i = 0; i < 50; i++) {
    expect(await pq.holdRequest(held({ id: `r${i}` }))).toBe(true);
  }
  expect(await pq.holdRequest(held({ id: 'extra' }))).toBe(false);
  expect(await pq.holdRequest(held({ id: 'other', tabId: 2 }))).toBe(true);
});

test('continueHeld sends the edit and removes the item', async () => {
  await pq.holdRequest(held());
  expect(await pq.continueHeld(1, 'r1', { postData: 'abc' })).toBe('sent');
  expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
    { tabId: 1 },
    'Fetch.continueRequest',
    { requestId: 'r1', postData: 'abc' },
    expect.any(Function)
  );
  expect(pq.listPaused(1)).toEqual([]);
});

test('continueHeld on CDP error marks the item cancelled and keeps it listed', async () => {
  await pq.holdRequest(held());
  failCdp();
  expect(await pq.continueHeld(1, 'r1', { postData: 'abc' })).toBe('cancelled');
  expect(pq.getHeld(1, 'r1').state).toBe('cancelled');
  expect(pq.listPaused(1)).toHaveLength(1);
});

test('markCancelled flips state; continueHeld then skips CDP', async () => {
  await pq.holdRequest(held());
  expect(await pq.markCancelled(1, 'n1')).toBe(true);
  expect(await pq.markCancelled(1, 'nope')).toBe(false);
  expect(pq.getHeld(1, 'r1').state).toBe('cancelled');
  expect(await pq.continueHeld(1, 'r1')).toBe('cancelled');
  expect(chrome.debugger.sendCommand).not.toHaveBeenCalled();
  expect(pq.listPaused(1)).toHaveLength(1);
});

test('failHeld sends Fetch.failRequest Aborted and removes the item', async () => {
  await pq.holdRequest(held());
  expect(await pq.failHeld(1, 'r1')).toBe('failed');
  expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
    { tabId: 1 },
    'Fetch.failRequest',
    { requestId: 'r1', errorReason: 'Aborted' },
    expect.any(Function)
  );
  expect(pq.listPaused(1)).toEqual([]);
});

test('failHeld on CDP error marks cancelled', async () => {
  await pq.holdRequest(held());
  failCdp();
  expect(await pq.failHeld(1, 'r1')).toBe('cancelled');
  expect(pq.getHeld(1, 'r1').state).toBe('cancelled');
});

test('failHeld on an already-cancelled item removes it without CDP', async () => {
  await pq.holdRequest(held());
  await pq.markCancelled(1, 'n1');
  expect(await pq.failHeld(1, 'r1')).toBe('cancelled');
  expect(chrome.debugger.sendCommand).not.toHaveBeenCalled();
  expect(pq.listPaused(1)).toEqual([]);
});

test('releaseAll continues paused items unmodified and drops cancelled ones silently', async () => {
  await pq.holdRequest(held({ id: 'r1', networkId: 'n1' }));
  await pq.holdRequest(held({ id: 'r2', networkId: 'n2' }));
  await pq.markCancelled(1, 'n2');
  await pq.releaseAll(1);
  expect(chrome.debugger.sendCommand).toHaveBeenCalledTimes(1);
  expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
    { tabId: 1 },
    'Fetch.continueRequest',
    { requestId: 'r1' },
    expect.any(Function)
  );
  expect(pq.listPaused(1)).toEqual([]);
});

test('releaseAll ignores CDP errors', async () => {
  await pq.holdRequest(held());
  failCdp();
  await expect(pq.releaseAll(1)).resolves.toBeUndefined();
  expect(pq.listPaused(1)).toEqual([]);
});

test('dropTab clears without sending', async () => {
  await pq.holdRequest(held());
  await pq.dropTab(1);
  expect(chrome.debugger.sendCommand).not.toHaveBeenCalled();
  expect(pq.listPaused(1)).toEqual([]);
});

test('ensurePausedLoaded restores from session storage', async () => {
  chrome.storage.session.get.mockImplementation((k, cb) => cb({ gqlPausedQueue: { 1: [held()] } }));
  await pq.ensurePausedLoaded();
  await pq.ensurePausedLoaded();
  expect(chrome.storage.session.get).toHaveBeenCalledTimes(1);
  expect(pq.getHeld(1, 'r1')).not.toBeNull();
});

test('onQueueChanged fires after hold, continue and release', async () => {
  const listener = jest.fn();
  pq.onQueueChanged(listener);
  await pq.holdRequest(held());
  expect(listener).toHaveBeenLastCalledWith(1);
  listener.mockClear();
  await pq.continueHeld(1, 'r1');
  expect(listener).toHaveBeenCalledWith(1);
  await pq.holdRequest(held({ id: 'r2' }));
  listener.mockClear();
  await pq.releaseAll(1);
  expect(listener).toHaveBeenCalledWith(1);
});

describe('fresh module after service worker restart', () => {
  const restore = (stored) =>
    chrome.storage.session.get.mockImplementation((k, cb) => cb({ gqlPausedQueue: stored }));

  test('continueHeld works without an explicit ensurePausedLoaded', async () => {
    restore({ 1: [held()] });
    expect(await pq.continueHeld(1, 'r1')).toBe('sent');
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 },
      'Fetch.continueRequest',
      { requestId: 'r1' },
      expect.any(Function)
    );
  });

  test('releaseAll continues every restored paused item', async () => {
    restore({ 1: [held(), held({ id: 'r2', networkId: 'n2' })] });
    await pq.releaseAll(1);
    expect(chrome.debugger.sendCommand).toHaveBeenCalledTimes(2);
  });

  test('dropTab does not wipe other tabs stored entries', async () => {
    restore({ 1: [held()], 2: [held({ id: 'r9', tabId: 2 })] });
    await pq.dropTab(1);
    const written = chrome.storage.session.set.mock.calls.at(-1)[0].gqlPausedQueue;
    expect(Object.keys(written)).toEqual(['2']);
  });
});
