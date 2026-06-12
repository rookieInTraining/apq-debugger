import {
  validateUrlPattern,
  isDebuggerActive,
  attachedTabs,
  attachDebuggerToTab,
  detachDebuggerFromTab,
  restoreDebuggerState,
} from '../../js/sw/debugger-manager.js';
import { contaminatePayload, handleFetchRequestPaused } from '../../js/sw/interceptor.js';
import {
  registerHash,
  lookupHash,
  clearRegistry,
  setPassiveMode,
} from '../../js/sw/hash-registry.js';
import { digestMessage } from '../../js/sw/hash.js';
import { handleMessage, toggleDebuggerFromAction } from '../../js/sw/messaging.js';
import {
  saveTabToStorage,
  removeTabFromStorage,
  getStoredPatterns,
  getStoredTabs,
  setStoredTabs,
} from '../../js/sw/storage.js';

describe('Service Worker Logic', () => {
  beforeEach(() => {
    attachedTabs.clear();
    jest.clearAllMocks();
    chrome.runtime.lastError = null;

    // Default mocks: all Chrome APIs succeed with minimal results
    chrome.storage.local.get.mockImplementation((_keys, cb) => {
      chrome.runtime.lastError = null;
      cb({});
    });
    chrome.storage.local.set.mockImplementation((_items, cb) => {
      chrome.runtime.lastError = null;
      cb && cb();
    });
    chrome.debugger.attach.mockImplementation((_d, _v, cb) => {
      chrome.runtime.lastError = null;
      cb();
    });
    chrome.debugger.detach.mockImplementation((_d, cb) => {
      chrome.runtime.lastError = null;
      cb();
    });
    chrome.debugger.sendCommand.mockImplementation((_d, _m, _p, cb) => {
      chrome.runtime.lastError = null;
      cb && cb();
    });
    chrome.debugger.getTargets.mockImplementation((cb) => {
      cb([]);
    });
    chrome.tabs.query.mockImplementation((_q, cb) => {
      chrome.runtime.lastError = null;
      cb([{ id: 1, url: 'https://example.com' }]);
    });
    chrome.tabs.get.mockImplementation((tabId, cb) => {
      chrome.runtime.lastError = null;
      cb({ id: tabId, url: 'https://example.com' });
    });
    chrome.runtime.sendMessage.mockImplementation((_msg, cb) => cb && cb(null));
  });

  // ── validateUrlPattern ─────────────────────────────────────────

  describe('validateUrlPattern', () => {
    test('should return trimmed pattern for valid input', () => {
      expect(validateUrlPattern(' *graphql* ')).toBe('*graphql*');
      expect(validateUrlPattern('https://example.com/*')).toBe('https://example.com/*');
    });

    test('should throw error for empty pattern', () => {
      expect(() => validateUrlPattern('')).toThrow('must be a non-empty string');
      expect(() => validateUrlPattern('   ')).toThrow('cannot be empty');
    });

    test('should throw error for non-string input', () => {
      expect(() => validateUrlPattern(null)).toThrow('non-empty string');
      expect(() => validateUrlPattern(123)).toThrow('non-empty string');
    });

    test('should throw error for pattern exceeding max length', () => {
      expect(() => validateUrlPattern('a'.repeat(1001))).toThrow('too long');
    });
  });

  // ── isDebuggerActive ───────────────────────────────────────────

  describe('isDebuggerActive', () => {
    test('should return true if tab is in attachedTabs set', async () => {
      attachedTabs.add(123);
      const result = await isDebuggerActive(123);
      expect(result).toBe(true);
      expect(chrome.debugger.getTargets).not.toHaveBeenCalled();
    });

    test('should check chrome.debugger if tab is in storage and still attached', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = null;
        cb({ apqAttachedTabs: [456] });
      });
      chrome.debugger.getTargets.mockImplementation((cb) => {
        cb([{ tabId: 456, attached: true }]);
      });

      const result = await isDebuggerActive(456);
      expect(chrome.debugger.getTargets).toHaveBeenCalled();
      expect(result).toBe(true);
      expect(attachedTabs.has(456)).toBe(true); // recovered to in-memory
    });

    test('should return false if tab is not in storage', async () => {
      const result = await isDebuggerActive(789);
      expect(result).toBe(false);
      expect(chrome.debugger.getTargets).not.toHaveBeenCalled();
    });

    test('should return false if tab is in storage but no longer attached', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = null;
        cb({ apqAttachedTabs: [789] });
      });
      chrome.debugger.getTargets.mockImplementation((cb) => {
        cb([{ tabId: 789, attached: false }]);
      });

      const result = await isDebuggerActive(789);
      expect(result).toBe(false);
    });

    test('should return false on getTargets error', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = null;
        cb({ apqAttachedTabs: [100] });
      });
      chrome.debugger.getTargets.mockImplementation((cb) => {
        chrome.runtime.lastError = { message: 'Failed to get targets' };
        cb([]);
        chrome.runtime.lastError = null;
      });

      const result = await isDebuggerActive(100);
      expect(result).toBe(false);
    });
  });

  // ── digestMessage ──────────────────────────────────────────────

  describe('digestMessage (SHA-256)', () => {
    test('should generate correct hash', async () => {
      const hash = await digestMessage('1234567890');
      expect(hash).toBe('c775e7b757ede630cd0aa11113bd102661ab38829ca52a6422ab782862f26864');
    });

    test('should return null when crypto fails', async () => {
      crypto.subtle.digest.mockRejectedValueOnce(new Error('Crypto unavailable'));
      const hash = await digestMessage('test');
      expect(hash).toBeNull();
    });
  });

  // ── contaminatePayload ─────────────────────────────────────────

  describe('contaminatePayload', () => {
    test('should contaminate APQ hash when query is absent', async () => {
      const payload = {
        extensions: {
          persistedQuery: {
            sha256Hash: 'original-hash',
          },
        },
      };

      await contaminatePayload(payload, 'http://example.com/graphql', 1);
      expect(payload.extensions.persistedQuery.sha256Hash).not.toBe('original-hash');
      expect(payload.extensions.persistedQuery.sha256Hash).toBe(
        'c775e7b757ede630cd0aa11113bd102661ab38829ca52a6422ab782862f26864'
      );
    });

    test('should send INTERCEPTED message for full query requests', async () => {
      const payload = {
        query: '{ users { id } }',
        operationName: 'GetUsers',
        variables: { limit: 10 },
      };
      const headers = [{ name: 'Cookie', value: 'session=abc' }];

      await contaminatePayload(payload, 'http://example.com/graphql', 42, headers);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'INTERCEPTED',
          operationName: 'GetUsers',
          query: '{ users { id } }',
          tabId: 42,
          headers,
        }),
        expect.any(Function)
      );
    });

    test('should use Anonymous Query when operationName is missing', async () => {
      const payload = { query: '{ users { id } }' };
      await contaminatePayload(payload, '', 1);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ operationName: 'Anonymous Query' }),
        expect.any(Function)
      );
    });

    test('should handle null/invalid payloads gracefully', async () => {
      await expect(contaminatePayload(null, '', 1)).resolves.toBe(false);
      await expect(contaminatePayload('not-an-object', '', 1)).resolves.toBe(false);
      await expect(contaminatePayload(42, '', 1)).resolves.toBe(false);
    });

    test('should log payload without query or APQ extensions', async () => {
      const spy = jest.spyOn(console, 'log').mockImplementation();
      await contaminatePayload({ foo: 'bar' }, '', 1);
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('does not contain query or APQ extensions'),
        expect.any(String)
      );
      spy.mockRestore();
    });

    test('should report the APQ phase with the original hash', async () => {
      const payload = {
        operationName: 'GetUsers',
        extensions: { persistedQuery: { sha256Hash: 'original-hash' } },
      };

      await contaminatePayload(payload, 'http://example.com/graphql', 7);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'INTERCEPTED',
          operationName: 'GetUsers',
          hash: 'original-hash',
          isAPQ: true,
          tabId: 7,
        }),
        expect.any(Function)
      );
    });

    test('should register hash from full-query retry containing persistedQuery extension', async () => {
      clearRegistry();
      const payload = {
        query: '{ users { id } }',
        operationName: 'GetUsers',
        variables: { limit: 10 },
        extensions: { persistedQuery: { sha256Hash: 'retry-hash' } },
      };

      await contaminatePayload(payload, 'http://example.com/graphql', 1);

      expect(lookupHash('retry-hash')).toEqual(
        expect.objectContaining({
          query: '{ users { id } }',
          operationName: 'GetUsers',
        })
      );
      clearRegistry();
    });

    test('should report modified=true only when contaminating', async () => {
      const apqPayload = { extensions: { persistedQuery: { sha256Hash: 'h' } } };
      const fullPayload = { query: '{ me }' };

      await expect(contaminatePayload(apqPayload, '', 1)).resolves.toBe(true);
      await expect(contaminatePayload(fullPayload, '', 1)).resolves.toBe(false);
      await expect(contaminatePayload({ foo: 'bar' }, '', 1)).resolves.toBe(false);
    });
  });

  // ── contaminatePayload (passive mode) ──────────────────────────

  describe('contaminatePayload in passive mode', () => {
    beforeEach(async () => {
      clearRegistry();
      await setPassiveMode(true);
      jest.clearAllMocks();
    });

    afterEach(async () => {
      clearRegistry();
      await setPassiveMode(false);
    });

    test('should not contaminate the hash', async () => {
      const payload = { extensions: { persistedQuery: { sha256Hash: 'real-hash' } } };

      const modified = await contaminatePayload(payload, 'http://x.com/graphql', 1);

      expect(modified).toBe(false);
      expect(payload.extensions.persistedQuery.sha256Hash).toBe('real-hash');
    });

    test('should resolve query from the registry', async () => {
      registerHash('known-hash', {
        query: '{ users { id } }',
        operationName: 'GetUsers',
        variables: null,
      });
      jest.clearAllMocks();

      const payload = { extensions: { persistedQuery: { sha256Hash: 'known-hash' } } };
      await contaminatePayload(payload, 'http://x.com/graphql', 3);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'INTERCEPTED',
          operationName: 'GetUsers',
          query: '{ users { id } }',
          hash: 'known-hash',
          isAPQ: true,
          tabId: 3,
        }),
        expect.any(Function)
      );
    });

    test('should report unresolved hashes with an empty query', async () => {
      const payload = { extensions: { persistedQuery: { sha256Hash: 'unknown-hash' } } };
      await contaminatePayload(payload, 'http://x.com/graphql', 3);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'INTERCEPTED',
          query: '',
          hash: 'unknown-hash',
          isAPQ: true,
        }),
        expect.any(Function)
      );
    });

    test('handleFetchRequestPaused should continue without rewriting the body', async () => {
      const payload = { extensions: { persistedQuery: { sha256Hash: 'real-hash' } } };
      handleFetchRequestPaused(
        { tabId: 1 },
        {
          requestId: 'rp1',
          request: {
            hasPostData: true,
            postData: JSON.stringify(payload),
            url: 'https://api.test.com/graphql',
          },
        }
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 1 },
        'Fetch.continueRequest',
        { requestId: 'rp1' },
        expect.any(Function)
      );
    });
  });

  // ── attachDebuggerToTab ────────────────────────────────────────

  describe('attachDebuggerToTab', () => {
    const httpTab = { id: 10, url: 'https://example.com/page' };
    const patterns = [{ urlPattern: '*graphql*', requestStage: 'Request' }];

    test('should attach successfully to HTTP tab', async () => {
      const result = await attachDebuggerToTab(httpTab, patterns);

      expect(result.status).toBe('SUCCESS');
      expect(chrome.debugger.attach).toHaveBeenCalledWith(
        { tabId: 10 },
        '1.3',
        expect.any(Function)
      );
      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 10 },
        'Fetch.enable',
        expect.objectContaining({ patterns: expect.any(Array) }),
        expect.any(Function)
      );
      expect(attachedTabs.has(10)).toBe(true);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'ON', tabId: 10 });
    });

    test('should reject non-HTTP tabs', async () => {
      const chromeTab = { id: 20, url: 'chrome://extensions' };
      const result = await attachDebuggerToTab(chromeTab, patterns);

      expect(result.status).toBe('ERROR');
      expect(result.error).toContain('HTTP/HTTPS');
      expect(chrome.debugger.attach).not.toHaveBeenCalled();
    });

    test('should reject tab with no URL', async () => {
      const noUrlTab = { id: 30 };
      const result = await attachDebuggerToTab(noUrlTab, patterns);

      expect(result.status).toBe('ERROR');
      expect(result.error).toContain('HTTP/HTTPS');
    });

    test('should return warning if already attached', async () => {
      attachedTabs.add(10);
      const result = await attachDebuggerToTab(httpTab, patterns);

      expect(result.status).toBe('WARNING');
      expect(result.message).toContain('already attached');
    });

    test('should return error if chrome.debugger.attach fails', async () => {
      chrome.debugger.attach.mockImplementation((_d, _v, cb) => {
        chrome.runtime.lastError = { message: 'Cannot attach to this target' };
        cb();
        chrome.runtime.lastError = null;
      });

      const result = await attachDebuggerToTab(httpTab, patterns);

      expect(result.status).toBe('ERROR');
      expect(result.error).toContain('Cannot attach');
    });

    test('should return error and cleanup if Fetch.enable fails', async () => {
      chrome.debugger.sendCommand.mockImplementation((_d, _m, _p, cb) => {
        chrome.runtime.lastError = { message: 'Fetch.enable failed' };
        cb && cb();
        chrome.runtime.lastError = null;
      });

      const result = await attachDebuggerToTab(httpTab, patterns);

      expect(result.status).toBe('ERROR');
      expect(result.error).toContain('network interception');
      // Should have tried to detach as cleanup
      expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 10 }, expect.any(Function));
    });
  });

  // ── detachDebuggerFromTab ──────────────────────────────────────

  describe('detachDebuggerFromTab', () => {
    test('should detach successfully', async () => {
      attachedTabs.add(5);
      const result = await detachDebuggerFromTab(5);

      expect(result.status).toBe('SUCCESS');
      expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 5 }, expect.any(Function));
      expect(attachedTabs.has(5)).toBe(false);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'OFF', tabId: 5 });
    });

    test('should succeed if already detached', async () => {
      const result = await detachDebuggerFromTab(99);

      expect(result.status).toBe('SUCCESS');
      expect(result.message).toContain('already detached');
    });

    test('should treat "Session not found" error as success', async () => {
      attachedTabs.add(5);
      chrome.debugger.detach.mockImplementation((_d, cb) => {
        chrome.runtime.lastError = { message: 'Session not found' };
        cb();
        chrome.runtime.lastError = null;
      });

      const result = await detachDebuggerFromTab(5);
      expect(result.status).toBe('SUCCESS');
      expect(attachedTabs.has(5)).toBe(false);
    });

    test('should return error for real detach failures', async () => {
      attachedTabs.add(5);
      chrome.debugger.detach.mockImplementation((_d, cb) => {
        chrome.runtime.lastError = { message: 'Unexpected internal error' };
        cb();
        chrome.runtime.lastError = null;
      });

      const result = await detachDebuggerFromTab(5);
      expect(result.status).toBe('ERROR');
      expect(result.error).toContain('Unexpected internal error');
    });
  });

  // ── restoreDebuggerState ───────────────────────────────────────

  describe('restoreDebuggerState', () => {
    test('should do nothing when no stored tabs', async () => {
      await restoreDebuggerState();
      expect(attachedTabs.size).toBe(0);
    });

    test('should restore still-attached tabs and prune stale ones', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = null;
        cb({ apqAttachedTabs: [1, 2, 3] });
      });
      chrome.debugger.getTargets.mockImplementation((cb) => {
        cb([
          { tabId: 1, attached: true },
          { tabId: 2, attached: false },
          // tab 3 not in targets at all
        ]);
      });

      await restoreDebuggerState();

      expect(attachedTabs.has(1)).toBe(true);
      expect(attachedTabs.has(2)).toBe(false);
      expect(attachedTabs.has(3)).toBe(false);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'ON', tabId: 1 });
      // Should update storage to only include still-attached tabs
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { apqAttachedTabs: [1] },
        expect.any(Function)
      );
    });

    test('should handle getTargets error gracefully', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = null;
        cb({ apqAttachedTabs: [1, 2] });
      });
      chrome.debugger.getTargets.mockImplementation((cb) => {
        chrome.runtime.lastError = { message: 'Targets error' };
        cb([]);
        chrome.runtime.lastError = null;
      });

      // Should not throw
      await expect(restoreDebuggerState()).resolves.toBeUndefined();
    });

    test('should handle storage error gracefully', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = { message: 'Storage error' };
        cb({});
        chrome.runtime.lastError = null;
      });

      await expect(restoreDebuggerState()).resolves.toBeUndefined();
      expect(attachedTabs.size).toBe(0);
    });
  });

  // ── handleMessage ──────────────────────────────────────────────

  describe('handleMessage', () => {
    test('should ignore INTERCEPTED broadcast messages', () => {
      const sendResponse = jest.fn();
      const result = handleMessage({ status: 'INTERCEPTED' }, {}, sendResponse);
      expect(result).toBe(false);
      expect(sendResponse).not.toHaveBeenCalled();
    });

    test('should ignore ACTION_TOGGLE broadcast messages', () => {
      const sendResponse = jest.fn();
      const result = handleMessage({ status: 'ACTION_TOGGLE' }, {}, sendResponse);
      expect(result).toBe(false);
    });

    test('should reject null message', () => {
      const sendResponse = jest.fn();
      handleMessage(null, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ERROR',
          error: expect.stringContaining('non-null object'),
        })
      );
    });

    test('should reject array message', () => {
      const sendResponse = jest.fn();
      handleMessage([], {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ERROR',
          error: expect.stringContaining('array'),
        })
      );
    });

    test('should reject message with invalid patterns type', () => {
      const sendResponse = jest.fn();
      handleMessage({ patterns: 'not-array' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 'ERROR' }));
    });

    test('should handle patterns message and attach debugger', async () => {
      const sendResponse = jest.fn();
      const result = handleMessage(
        { patterns: [{ urlPattern: '*graphql*' }], tabId: 42 },
        {},
        sendResponse
      );

      expect(result).toBe(true); // keeps channel open

      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS' }));
    });

    test('should handle disconnect message with tabId', async () => {
      attachedTabs.add(42);
      const sendResponse = jest.fn();

      handleMessage({ disconnect: true, tabId: 42 }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS' }));
    });

    test('should handle getStatus message', async () => {
      attachedTabs.add(42);
      const sendResponse = jest.fn();

      handleMessage({ getStatus: true, tabId: 42 }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'SUCCESS',
          debuggerActive: true,
          tabId: 42,
        })
      );
    });

    test('should return error for getStatus without tabId', async () => {
      const sendResponse = jest.fn();
      handleMessage({ getStatus: true }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ERROR',
          error: expect.stringContaining('tabId'),
        })
      );
    });

    test('should return error for empty patterns array', async () => {
      const sendResponse = jest.fn();
      handleMessage({ patterns: [] }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ERROR',
          error: expect.stringContaining('Invalid message format'),
        })
      );
    });

    test('should ignore REGISTRY_UPDATED broadcast messages', () => {
      const sendResponse = jest.fn();
      const result = handleMessage({ status: 'REGISTRY_UPDATED', size: 3 }, {}, sendResponse);
      expect(result).toBe(false);
      expect(sendResponse).not.toHaveBeenCalled();
    });

    test('should handle getRegistry message', async () => {
      clearRegistry();
      registerHash('h1', { query: '{ a }' });
      const sendResponse = jest.fn();

      handleMessage({ getRegistry: true }, {}, sendResponse);
      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SUCCESS', size: 1, passiveMode: false })
      );
      clearRegistry();
    });

    test('should handle setPassiveMode message', async () => {
      const sendResponse = jest.fn();

      handleMessage({ setPassiveMode: true }, {}, sendResponse);
      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SUCCESS', passiveMode: true })
      );

      await setPassiveMode(false); // reset module state
    });

    test('should reject non-boolean setPassiveMode', () => {
      const sendResponse = jest.fn();
      handleMessage({ setPassiveMode: 'yes' }, {}, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ERROR',
          error: expect.stringContaining('setPassiveMode'),
        })
      );
    });

    test('should handle clearRegistry message', async () => {
      registerHash('h1', { query: '{ a }' });
      const sendResponse = jest.fn();

      handleMessage({ clearRegistry: true }, {}, sendResponse);
      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SUCCESS', size: 0 })
      );
      expect(lookupHash('h1')).toBeNull();
    });

    test('should return error for loadSchema without tabId', async () => {
      const sendResponse = jest.fn();
      handleMessage({ loadSchema: true }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ERROR',
          error: expect.stringContaining('tabId'),
        })
      );
    });

    test('should reject non-boolean loadSchema', () => {
      const sendResponse = jest.fn();
      handleMessage({ loadSchema: 'yes' }, {}, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ERROR',
          error: expect.stringContaining('loadSchema'),
        })
      );
    });

    test('should handle loadSchema with explicit URL', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: { __schema: { types: [] } } }),
      });

      const sendResponse = jest.fn();
      handleMessage(
        { loadSchema: true, tabId: 42, url: 'https://api.test.com/graphql' },
        {},
        sendResponse
      );

      await new Promise((r) => setTimeout(r, 100));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'SUCCESS',
          endpoint: 'https://api.test.com/graphql',
          introspection: { __schema: { types: [] } },
        })
      );
      delete global.fetch;
    });

    test('should return error when schema detection fails', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('refused'));

      const sendResponse = jest.fn();
      handleMessage({ loadSchema: true, tabId: 42 }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 200));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ERROR',
          error: expect.stringContaining('No GraphQL endpoint detected'),
        })
      );
      delete global.fetch;
    });
  });

  // ── toggleDebuggerFromAction ───────────────────────────────────

  describe('toggleDebuggerFromAction', () => {
    test('should detach if already attached', async () => {
      attachedTabs.add(1);
      await toggleDebuggerFromAction();

      expect(chrome.debugger.detach).toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ACTION_TOGGLE', active: false }),
        expect.any(Function)
      );
    });

    test('should show notification when no patterns stored', async () => {
      await toggleDebuggerFromAction();

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('No URL patterns'),
        })
      );
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'ERR' })
      );
    });

    test('should attach with stored patterns', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        chrome.runtime.lastError = null;
        const result = {};
        const keyArr = Array.isArray(keys) ? keys : [keys];
        if (keyArr.includes('apqPatterns')) {
          result.apqPatterns = ['*graphql*'];
        }
        cb(result);
      });

      await toggleDebuggerFromAction();

      expect(chrome.debugger.attach).toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ACTION_TOGGLE', active: true }),
        expect.any(Function)
      );
    });

    test('should handle no active tab error', async () => {
      chrome.tabs.query.mockImplementation((_q, cb) => {
        chrome.runtime.lastError = null;
        cb([]);
      });

      await toggleDebuggerFromAction();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ACTION_TOGGLE',
          active: false,
          error: expect.any(String),
        }),
        expect.any(Function)
      );
    });
  });

  // ── handleFetchRequestPaused ───────────────────────────────────

  describe('handleFetchRequestPaused', () => {
    test('should continue request without post data', async () => {
      handleFetchRequestPaused({ tabId: 1 }, { requestId: 'r1', request: { hasPostData: false } });

      await new Promise((r) => setTimeout(r, 10));

      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 1 },
        'Fetch.continueRequest',
        { requestId: 'r1' },
        expect.any(Function)
      );
    });

    test('should continue on invalid JSON post data', async () => {
      handleFetchRequestPaused(
        { tabId: 1 },
        { requestId: 'r2', request: { hasPostData: true, postData: 'not-json' } }
      );

      await new Promise((r) => setTimeout(r, 10));

      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 1 },
        'Fetch.continueRequest',
        { requestId: 'r2' },
        expect.any(Function)
      );
    });

    test('should continue full-query requests with original body (no rewrite)', async () => {
      const payload = { query: '{ users { id } }', operationName: 'Test' };
      handleFetchRequestPaused(
        { tabId: 1 },
        {
          requestId: 'r3',
          request: {
            hasPostData: true,
            postData: JSON.stringify(payload),
            url: 'https://api.test.com/graphql',
          },
        }
      );

      await new Promise((r) => setTimeout(r, 50));

      // Full-query requests are not modified, so no postData should be attached
      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 1 },
        'Fetch.continueRequest',
        { requestId: 'r3' },
        expect.any(Function)
      );
    });

    test('should continue APQ requests with rewritten (contaminated) body', async () => {
      const payload = { extensions: { persistedQuery: { sha256Hash: 'real-hash' } } };
      handleFetchRequestPaused(
        { tabId: 1 },
        {
          requestId: 'r3b',
          request: {
            hasPostData: true,
            postData: JSON.stringify(payload),
            url: 'https://api.test.com/graphql',
          },
        }
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 1 },
        'Fetch.continueRequest',
        expect.objectContaining({
          requestId: 'r3b',
          postData: expect.any(String), // base64 encoded
        }),
        expect.any(Function)
      );
    });

    test('should handle batch array payload', async () => {
      const batchPayload = [
        { extensions: { persistedQuery: { sha256Hash: 'hash1' } } },
        { query: '{ me { name } }', operationName: 'GetMe' },
      ];

      handleFetchRequestPaused(
        { tabId: 1 },
        {
          requestId: 'r4',
          request: {
            hasPostData: true,
            postData: JSON.stringify(batchPayload),
            url: 'https://api.example.com/graphql',
          },
        }
      );

      await new Promise((r) => setTimeout(r, 50));

      // Should have sent message for the full query item
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ operationName: 'GetMe', status: 'INTERCEPTED' }),
        expect.any(Function)
      );
      // Should continue with modified post data
      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 1 },
        'Fetch.continueRequest',
        expect.objectContaining({ requestId: 'r4', postData: expect.any(String) }),
        expect.any(Function)
      );
    });

    test('should continue when request object is missing', async () => {
      handleFetchRequestPaused({ tabId: 1 }, { requestId: 'r5' });

      await new Promise((r) => setTimeout(r, 10));

      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 1 },
        'Fetch.continueRequest',
        { requestId: 'r5' },
        expect.any(Function)
      );
    });
  });

  // ── Storage helpers ────────────────────────────────────────────

  describe('Storage helpers', () => {
    test('saveTabToStorage should add tab to stored list', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = null;
        cb({ apqAttachedTabs: [1, 2] });
      });

      await saveTabToStorage(3);

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { apqAttachedTabs: [1, 2, 3] },
        expect.any(Function)
      );
    });

    test('saveTabToStorage should not duplicate existing tab', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = null;
        cb({ apqAttachedTabs: [1, 2] });
      });

      await saveTabToStorage(2);

      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('removeTabFromStorage should remove tab from stored list', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = null;
        cb({ apqAttachedTabs: [1, 2, 3] });
      });

      await removeTabFromStorage(2);

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { apqAttachedTabs: [1, 3] },
        expect.any(Function)
      );
    });

    test('removeTabFromStorage should noop for non-existing tab', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = null;
        cb({ apqAttachedTabs: [1, 2] });
      });

      await removeTabFromStorage(99);

      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('getStoredPatterns should return empty array on error', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = { message: 'Error' };
        cb({});
        chrome.runtime.lastError = null;
      });

      const patterns = await getStoredPatterns();
      expect(patterns).toEqual([]);
    });

    test('getStoredTabs should return stored tab IDs', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = null;
        cb({ apqAttachedTabs: [10, 20] });
      });

      const tabs = await getStoredTabs();
      expect(tabs).toEqual([10, 20]);
    });

    test('getStoredTabs should return empty array when not set', async () => {
      const tabs = await getStoredTabs();
      expect(tabs).toEqual([]);
    });

    test('setStoredTabs should persist tab list', async () => {
      await setStoredTabs([5, 10]);

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { apqAttachedTabs: [5, 10] },
        expect.any(Function)
      );
    });
  });
});
