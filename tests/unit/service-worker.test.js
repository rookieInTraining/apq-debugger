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
import { recordEndpoint, clearObservedEndpoints } from '../../js/sw/endpoint-tracker.js';
import {
  saveTabToStorage,
  removeTabFromStorage,
  getStoredPatterns,
  getStoredTabs,
  setStoredTabs,
} from '../../js/sw/storage.js';
import { encodeBase64Json } from '../../js/sw/resume-body.js';
import {
  initBreakpoints,
  setBreakpoints,
  setDebugMode,
  setPauseNext,
  getDebugState,
  clearDebugState,
} from '../../js/sw/breakpoints.js';
import { holdRequest, listPaused, dropTab } from '../../js/sw/pause-queue.js';

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

    test('should handle getObservedEndpoints message', async () => {
      recordEndpoint(4242, 'https://api.example.com/graphql', []);
      const sendResponse = jest.fn();

      handleMessage({ getObservedEndpoints: true, tabId: 4242 }, {}, sendResponse);
      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'SUCCESS',
          endpoints: expect.arrayContaining(['https://api.example.com/graphql']),
        })
      );
      clearObservedEndpoints(4242);
    });

    test('should return error for getObservedEndpoints without tabId', async () => {
      const sendResponse = jest.fn();

      handleMessage({ getObservedEndpoints: true }, {}, sendResponse);
      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 'ERROR' }));
    });

    test('should reject non-boolean getObservedEndpoints', () => {
      const sendResponse = jest.fn();
      handleMessage({ getObservedEndpoints: 'yes', tabId: 42 }, {}, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ERROR',
          error: expect.stringContaining('getObservedEndpoints'),
        })
      );
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

  // ── Request breakpoints ────────────────────────────────────────

  describe('request breakpoints', () => {
    const BOGUS = 'c775e7b757ede630cd0aa11113bd102661ab38829ca52a6422ab782862f26864';
    const URL = 'https://api.test.com/graphql';
    const HEADERS = { 'Content-Type': 'application/json', Authorization: 'Bearer t' };
    const flush = () => new Promise((r) => setTimeout(r, 50));
    const cdp = () => chrome.debugger.sendCommand.mock.calls.map((c) => c.slice(0, 3));
    const cdpMethods = () => chrome.debugger.sendCommand.mock.calls.map((c) => c[1]);
    const send = (message) => new Promise((resolve) => handleMessage(message, {}, resolve));

    /** Fetch.requestPaused params for a GraphQL POST. */
    const paused = (requestId, body) => ({
      requestId,
      networkId: `net-${requestId}`,
      request: {
        method: 'POST',
        url: URL,
        hasPostData: true,
        postData: JSON.stringify(body),
        headers: HEADERS,
      },
    });

    const heldItem = (over = {}) => ({
      id: 'p1',
      networkId: 'net-p1',
      tabId: 1,
      url: URL,
      method: 'POST',
      heldAt: 1,
      reason: 'breakpoint',
      state: 'paused',
      body: { query: 'query A { a }', operationName: 'A' },
      rawHeaders: {},
      operations: [
        {
          index: 0,
          operationName: 'A',
          query: 'query A { a }',
          querySource: 'request',
          variables: null,
          hash: '',
          isHashOnly: false,
        },
      ],
      ...over,
    });

    let listeners;
    let disconnects = [];

    /** Connect a fake panel port through the SW's onConnect listener. */
    function connectPanel(tabId) {
      const onDisconnect = [];
      const port = {
        name: `gql-panel:${tabId}`,
        onDisconnect: { addListener: (fn) => onDisconnect.push(fn) },
      };
      listeners.onConnect(port);
      const disconnect = () => onDisconnect.forEach((fn) => fn(port));
      disconnects.push(disconnect);
      return disconnect;
    }

    beforeAll(() => {
      // index.js registers every listener at load; capture them before mocks are cleared
      global.self = { addEventListener: jest.fn() };
      require('../../js/sw/index.js');
      const last = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];
      listeners = {
        onConnect: last(chrome.runtime.onConnect.addListener),
        onEvent: last(chrome.debugger.onEvent.addListener),
        onDetach: last(chrome.debugger.onDetach.addListener),
        onUpdated: last(chrome.tabs.onUpdated.addListener),
        onRemoved: last(chrome.tabs.onRemoved.addListener),
      };
    });

    afterAll(() => {
      delete global.self;
    });

    beforeEach(async () => {
      await initBreakpoints();
      await setBreakpoints([]);
      for (const tabId of [1, 123]) {
        await clearDebugState(tabId);
        await dropTab(tabId);
      }
      clearRegistry();
      await setPassiveMode(false);
      jest.clearAllMocks();
    });

    afterEach(async () => {
      disconnects.forEach((disconnect) => disconnect());
      disconnects = [];
      await flush();
    });

    describe('breakpoints in handleFetchRequestPaused', () => {
      test('debug off and no pause-next: CDP calls are identical to the panel-less path', async () => {
        // Same fixtures as the existing handleFetchRequestPaused tests (r3, r3b)
        const run = async () => {
          handleFetchRequestPaused(
            { tabId: 1 },
            {
              requestId: 'r3',
              request: {
                hasPostData: true,
                postData: JSON.stringify({ query: '{ users { id } }', operationName: 'Test' }),
                url: URL,
              },
            }
          );
          await flush();
          handleFetchRequestPaused(
            { tabId: 1 },
            {
              requestId: 'r3b',
              request: {
                hasPostData: true,
                postData: JSON.stringify({
                  extensions: { persistedQuery: { sha256Hash: 'real-hash' } },
                }),
                url: URL,
              },
            }
          );
          await flush();
          const calls = cdp();
          chrome.debugger.sendCommand.mockClear();
          return calls;
        };
        const expected = [
          [{ tabId: 1 }, 'Fetch.continueRequest', { requestId: 'r3' }],
          [
            { tabId: 1 },
            'Fetch.continueRequest',
            {
              requestId: 'r3b',
              postData: encodeBase64Json({ extensions: { persistedQuery: { sha256Hash: BOGUS } } }),
            },
          ],
        ];

        const noPanel = await run();
        connectPanel(1);
        await setBreakpoints([
          { name: 'Test', enabled: true },
          { name: 'GetCart', enabled: true },
        ]);
        const panelDebugOff = await run();
        await setDebugMode(1, true);
        await setBreakpoints([{ name: 'Other', enabled: true }]);
        const panelNoMatch = await run();

        expect(noPanel).toEqual(expected);
        expect(panelDebugOff).toEqual(expected);
        expect(panelNoMatch).toEqual(expected);
        expect(listPaused(1)).toEqual([]);
      });

      test('debug on + breakpoint + panel: full-query request is held, not continued', async () => {
        await setBreakpoints([{ name: 'GetCart', enabled: true }]);
        await setDebugMode(1, true);
        connectPanel(1);
        const body = {
          query: 'query GetCart { cart { id } }',
          operationName: 'GetCart',
          variables: { a: 1 },
          extensions: { persistedQuery: { version: 1, sha256Hash: 'cart-hash' } },
        };

        handleFetchRequestPaused({ tabId: 1 }, paused('h1', body));
        await flush();

        expect(cdpMethods()).not.toContain('Fetch.continueRequest');
        const items = listPaused(1);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
          id: 'h1',
          networkId: 'net-h1',
          tabId: 1,
          url: URL,
          method: 'POST',
          reason: 'breakpoint',
          state: 'paused',
          body,
          rawHeaders: HEADERS,
        });
        expect(items[0].heldAt).toEqual(expect.any(Number));
        expect(items[0].operations).toEqual([
          {
            index: 0,
            operationName: 'GetCart',
            query: body.query,
            querySource: 'request',
            variables: { a: 1 },
            hash: 'cart-hash',
            isHashOnly: false,
          },
        ]);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'INTERCEPTED', operationName: 'GetCart' }),
          expect.any(Function)
        );
        expect(lookupHash('cart-hash')).toMatchObject({ operationName: 'GetCart' });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
          {
            status: 'PAUSED_UPDATED',
            tabId: 1,
            paused: [expect.objectContaining({ id: 'h1' })],
            pauseNext: false,
          },
          expect.any(Function)
        );
      });

      test('same request with no panel connected is continued as today', async () => {
        await setBreakpoints([{ name: 'GetCart', enabled: true }]);
        await setDebugMode(1, true);

        handleFetchRequestPaused(
          { tabId: 1 },
          paused('h2', { query: 'query GetCart { cart { id } }', operationName: 'GetCart' })
        );
        await flush();

        expect(cdp()).toEqual([[{ tabId: 1 }, 'Fetch.continueRequest', { requestId: 'h2' }]]);
        expect(listPaused(1)).toEqual([]);
      });

      test('active mode: hash-only request is contaminated and continued, never held', async () => {
        await setBreakpoints([{ name: 'GetCart', enabled: true }]);
        await setDebugMode(1, true);
        connectPanel(1);

        handleFetchRequestPaused(
          { tabId: 1 },
          paused('h3', {
            operationName: 'GetCart',
            extensions: { persistedQuery: { sha256Hash: 'cart-hash' } },
          })
        );
        await flush();

        expect(cdp()).toEqual([
          [
            { tabId: 1 },
            'Fetch.continueRequest',
            {
              requestId: 'h3',
              postData: encodeBase64Json({
                operationName: 'GetCart',
                extensions: { persistedQuery: { sha256Hash: BOGUS } },
              }),
            },
          ],
        ]);
        expect(listPaused(1)).toEqual([]);
      });

      test('passive mode: hash-only request is held with the registry query', async () => {
        await setPassiveMode(true);
        registerHash('known-hash', {
          query: 'query GetCart { cart { id } }',
          operationName: 'GetCart',
          variables: null,
        });
        await setBreakpoints([{ name: 'GetCart', enabled: true }]);
        await setDebugMode(1, true);
        connectPanel(1);
        const body = {
          variables: { id: 1 },
          extensions: { persistedQuery: { sha256Hash: 'known-hash' } },
        };

        handleFetchRequestPaused({ tabId: 1 }, paused('h4', body));
        await flush();

        expect(cdpMethods()).not.toContain('Fetch.continueRequest');
        const [item] = listPaused(1);
        expect(item.body).toEqual(body);
        expect(item.operations).toEqual([
          {
            index: 0,
            operationName: 'GetCart',
            query: 'query GetCart { cart { id } }',
            querySource: 'registry',
            variables: { id: 1 },
            hash: 'known-hash',
            isHashOnly: true,
          },
        ]);
      });

      test('passive mode: unknown hash is held with no query', async () => {
        await setPassiveMode(true);
        await setBreakpoints([{ name: 'GetCart', enabled: true }]);
        await setDebugMode(1, true);
        connectPanel(1);

        handleFetchRequestPaused(
          { tabId: 1 },
          paused('h5', {
            operationName: 'GetCart',
            extensions: { persistedQuery: { sha256Hash: 'unknown-hash' } },
          })
        );
        await flush();

        expect(cdpMethods()).not.toContain('Fetch.continueRequest');
        const [item] = listPaused(1);
        expect(item.operations[0]).toMatchObject({
          operationName: 'GetCart',
          query: '',
          querySource: 'none',
          hash: 'unknown-hash',
          isHashOnly: true,
        });
      });

      test('pause-next holds one request, then disarms', async () => {
        await setPauseNext(1, true);
        connectPanel(1);

        handleFetchRequestPaused({ tabId: 1 }, paused('n1', { query: '{ a }' }));
        await flush();
        expect(listPaused(1)).toEqual([
          expect.objectContaining({ id: 'n1', reason: 'pause-next' }),
        ]);
        expect(getDebugState(1).pauseNext).toBe(false);
        expect(chrome.storage.session.set).toHaveBeenCalledWith(
          { gqlDebugState: expect.objectContaining({ 1: { debugMode: false, pauseNext: false } }) },
          expect.any(Function)
        );

        handleFetchRequestPaused({ tabId: 1 }, paused('n2', { query: '{ a }' }));
        await flush();
        expect(cdp()).toEqual([[{ tabId: 1 }, 'Fetch.continueRequest', { requestId: 'n2' }]]);
        expect(listPaused(1)).toHaveLength(1);
      });

      test('pause-next wins over a breakpoint as the reason', async () => {
        await setBreakpoints([{ name: 'GetCart', enabled: true }]);
        await setDebugMode(1, true);
        await setPauseNext(1, true);
        connectPanel(1);

        handleFetchRequestPaused(
          { tabId: 1 },
          paused('n3', { query: 'query GetCart { cart { id } }', operationName: 'GetCart' })
        );
        await flush();

        expect(listPaused(1)[0].reason).toBe('pause-next');
      });

      test('batch [GetUser, GetCart] with breakpoint GetCart: one held item, contaminated body', async () => {
        await setBreakpoints([{ name: 'GetCart', enabled: true }]);
        await setDebugMode(1, true);
        connectPanel(1);
        const batch = [
          { operationName: 'GetUser', extensions: { persistedQuery: { sha256Hash: 'user-hash' } } },
          { query: 'query GetCart { cart { id } }', operationName: 'GetCart' },
        ];

        handleFetchRequestPaused({ tabId: 1 }, paused('b1', batch));
        await flush();

        expect(cdpMethods()).not.toContain('Fetch.continueRequest');
        const items = listPaused(1);
        expect(items).toHaveLength(1);
        expect(items[0].body).toEqual([
          { operationName: 'GetUser', extensions: { persistedQuery: { sha256Hash: BOGUS } } },
          batch[1],
        ]);
        expect(items[0].operations).toEqual([
          expect.objectContaining({
            index: 0,
            operationName: 'GetUser',
            hash: 'user-hash',
            isHashOnly: true,
            querySource: 'none',
          }),
          expect.objectContaining({
            index: 1,
            operationName: 'GetCart',
            querySource: 'request',
            isHashOnly: false,
          }),
        ]);
      });

      test('queue full: request is continued unmodified', async () => {
        for (let i = 0; i < 50; i++) await holdRequest(heldItem({ id: `q${i}` }));
        await setBreakpoints([{ name: 'GetCart', enabled: true }]);
        await setDebugMode(1, true);
        connectPanel(1);
        chrome.debugger.sendCommand.mockClear();

        handleFetchRequestPaused(
          { tabId: 1 },
          paused('full', { query: 'query GetCart { cart { id } }', operationName: 'GetCart' })
        );
        await flush();

        expect(cdp()).toEqual([[{ tabId: 1 }, 'Fetch.continueRequest', { requestId: 'full' }]]);
        expect(listPaused(1)).toHaveLength(50);
      });
    });

    describe('breakpoint messages', () => {
      test.each([
        [{ getBreakpointState: 'yes', tabId: 1 }, 'getBreakpointState'],
        [{ setDebugMode: 'yes', tabId: 1 }, 'setDebugMode'],
        [{ setPauseNext: 1, tabId: 1 }, 'setPauseNext'],
        [{ resumeAllPaused: 'all', tabId: 1 }, 'resumeAllPaused'],
        [{ resumePaused: 5, tabId: 1 }, 'resumePaused'],
        [{ failPaused: null, tabId: 1 }, 'failPaused'],
        [{ setBreakpoints: 'x' }, 'setBreakpoints'],
        [{ setBreakpoints: [{ name: 1, enabled: true }] }, 'setBreakpoints'],
        [{ setBreakpoints: [{ name: 'A' }] }, 'setBreakpoints'],
        [{ setBreakpoints: [null] }, 'setBreakpoints'],
        [{ resumePaused: 'p1', tabId: 1, edits: null }, 'edits'],
        [{ resumePaused: 'p1', tabId: 1, edits: 'x' }, 'edits'],
        [{ resumePaused: 'p1', tabId: 1, edits: [] }, 'edits'],
        [{ setDebugMode: true, tabId: '1' }, 'tabId'],
      ])('rejects %j', (message, field) => {
        const sendResponse = jest.fn();
        expect(handleMessage(message, {}, sendResponse)).toBe(false);
        expect(sendResponse).toHaveBeenCalledWith({
          status: 'ERROR',
          error: expect.stringContaining(`"${field}"`),
        });
      });

      test('ignores PAUSED_UPDATED broadcasts', () => {
        const sendResponse = jest.fn();
        expect(handleMessage({ status: 'PAUSED_UPDATED', tabId: 1 }, {}, sendResponse)).toBe(false);
        expect(sendResponse).not.toHaveBeenCalled();
      });

      test('per-tab messages without tabId are rejected', async () => {
        expect(await send({ setDebugMode: true })).toMatchObject({ status: 'ERROR' });
        expect(await send({ getBreakpointState: true })).toMatchObject({ status: 'ERROR' });
      });

      test('setBreakpoints stores and returns the cleaned list', async () => {
        const response = await send({
          setBreakpoints: [
            { name: ' GetCart ', enabled: true },
            { name: 'GetCart', enabled: false },
          ],
        });
        expect(response).toEqual({
          status: 'SUCCESS',
          breakpoints: [{ name: 'GetCart', enabled: true }],
        });
      });

      test('getBreakpointState returns breakpoints, flags and the paused queue', async () => {
        await setBreakpoints([{ name: 'A', enabled: true }]);
        await setDebugMode(1, true);
        await holdRequest(heldItem());

        expect(await send({ getBreakpointState: true, tabId: 1 })).toEqual({
          status: 'SUCCESS',
          breakpoints: [{ name: 'A', enabled: true }],
          debugMode: true,
          pauseNext: false,
          paused: [heldItem()],
        });
      });

      test('setDebugMode / setPauseNext toggle Network events on an attached tab', async () => {
        attachedTabs.add(1);

        expect(await send({ setDebugMode: true, tabId: 1 })).toEqual({
          status: 'SUCCESS',
          debugMode: true,
          pauseNext: false,
        });
        expect(cdp()).toEqual([
          [{ tabId: 1 }, 'Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 }],
        ]);

        await send({ setPauseNext: true, tabId: 1 });
        await send({ setDebugMode: false, tabId: 1 });
        chrome.debugger.sendCommand.mockClear();
        expect(await send({ setPauseNext: false, tabId: 1 })).toEqual({
          status: 'SUCCESS',
          debugMode: false,
          pauseNext: false,
        });
        expect(cdp()).toEqual([[{ tabId: 1 }, 'Network.disable', {}]]);
      });

      test('setDebugMode on a tab without the debugger sends no CDP command', async () => {
        await send({ setDebugMode: true, tabId: 1 });
        expect(getDebugState(1).debugMode).toBe(true);
        expect(chrome.debugger.sendCommand).not.toHaveBeenCalled();
      });

      test('resumePaused builds the edited request and continues it', async () => {
        await holdRequest(heldItem());

        const response = await send({
          resumePaused: 'p1',
          tabId: 1,
          edits: { operations: [{ index: 0, query: 'query A { b }' }] },
        });

        expect(response).toEqual({ status: 'SUCCESS', result: 'sent' });
        expect(cdp()).toEqual([
          [
            { tabId: 1 },
            'Fetch.continueRequest',
            {
              requestId: 'p1',
              postData: encodeBase64Json({ query: 'query A { b }', operationName: 'A' }),
            },
          ],
        ]);
        expect(listPaused(1)).toEqual([]);
      });

      test('resumePaused for an unknown id reports cancelled', async () => {
        expect(await send({ resumePaused: 'nope', tabId: 1 })).toEqual({
          status: 'SUCCESS',
          result: 'cancelled',
        });
        expect(chrome.debugger.sendCommand).not.toHaveBeenCalled();
      });

      test('failPaused aborts the held request', async () => {
        await holdRequest(heldItem());

        expect(await send({ failPaused: 'p1', tabId: 1 })).toEqual({
          status: 'SUCCESS',
          result: 'failed',
        });
        expect(cdp()).toEqual([
          [{ tabId: 1 }, 'Fetch.failRequest', { requestId: 'p1', errorReason: 'Aborted' }],
        ]);
      });

      test('resumeAllPaused continues every paused item unmodified', async () => {
        await holdRequest(heldItem({ id: 'a' }));
        await holdRequest(heldItem({ id: 'b' }));

        expect(await send({ resumeAllPaused: true, tabId: 1 })).toEqual({ status: 'SUCCESS' });
        expect(cdp()).toEqual([
          [{ tabId: 1 }, 'Fetch.continueRequest', { requestId: 'a' }],
          [{ tabId: 1 }, 'Fetch.continueRequest', { requestId: 'b' }],
        ]);
        expect(listPaused(1)).toEqual([]);
      });
    });

    describe('breakpoint lifecycle', () => {
      test('detachDebuggerFromTab releases held requests before detaching', async () => {
        attachedTabs.add(1);
        await holdRequest(heldItem());

        await detachDebuggerFromTab(1);

        const continueCall = chrome.debugger.sendCommand.mock.calls.findIndex(
          (c) => c[1] === 'Fetch.continueRequest' && c[2].requestId === 'p1'
        );
        expect(continueCall).toBeGreaterThanOrEqual(0);
        expect(chrome.debugger.sendCommand.mock.invocationCallOrder[continueCall]).toBeLessThan(
          chrome.debugger.detach.mock.invocationCallOrder[0]
        );
        expect(listPaused(1)).toEqual([]);
      });

      test('attaching with debug mode already on enables Network events', async () => {
        await setDebugMode(1, true);
        await attachDebuggerToTab({ id: 1, url: 'https://example.com' }, [{ urlPattern: '*' }]);
        expect(cdpMethods()).toEqual(['Fetch.enable', 'Network.enable']);
        expect(cdp()[1][2]).toEqual({ maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
      });

      test('attaching with debug mode off sends no Network command', async () => {
        await attachDebuggerToTab({ id: 1, url: 'https://example.com' }, [{ urlPattern: '*' }]);
        expect(cdpMethods()).toEqual(['Fetch.enable']);
      });

      test('onDetach drops the queue without CDP and keeps debug state', async () => {
        await holdRequest(heldItem());
        await setDebugMode(1, true);

        listeners.onDetach({ tabId: 1 }, 'canceled_by_user');
        await flush();

        expect(listPaused(1)).toEqual([]);
        expect(chrome.debugger.sendCommand).not.toHaveBeenCalled();
        expect(getDebugState(1).debugMode).toBe(true);
      });

      test('onDetach for a closed tab also clears its debug state', async () => {
        await holdRequest(heldItem());
        await setDebugMode(1, true);

        listeners.onDetach({ tabId: 1 }, 'target_closed');
        await flush();

        expect(listPaused(1)).toEqual([]);
        expect(getDebugState(1)).toEqual({ debugMode: false, pauseNext: false });
      });

      test('tabs.onRemoved drops the queue and debug state', async () => {
        await holdRequest(heldItem());
        await setPauseNext(1, true);

        listeners.onRemoved(1, {});
        await flush();

        expect(listPaused(1)).toEqual([]);
        expect(getDebugState(1)).toEqual({ debugMode: false, pauseNext: false });
      });

      test('navigation (status loading) releases held requests and clears pause-next', async () => {
        await holdRequest(heldItem());
        await setPauseNext(1, true);
        await setDebugMode(1, true);

        await listeners.onUpdated(1, { status: 'loading' });
        await flush();

        expect(listPaused(1)).toEqual([]);
        expect(cdp()).toContainEqual([{ tabId: 1 }, 'Fetch.continueRequest', { requestId: 'p1' }]);
        expect(getDebugState(1)).toEqual({ debugMode: true, pauseNext: false });
      });

      test('last panel port disconnecting releases held requests and disarms pause-next', async () => {
        const disconnect = connectPanel(123);
        await holdRequest(heldItem({ tabId: 123 }));
        await setPauseNext(123, true);
        chrome.debugger.sendCommand.mockClear();

        disconnect();
        await flush();

        expect(cdp()).toEqual([[{ tabId: 123 }, 'Fetch.continueRequest', { requestId: 'p1' }]]);
        expect(listPaused(123)).toEqual([]);
        expect(getDebugState(123).pauseNext).toBe(false);
      });

      test('Network.loadingFailed with canceled marks the held request cancelled', async () => {
        await holdRequest(heldItem({ networkId: 'n1' }));

        listeners.onEvent({ tabId: 1 }, 'Network.loadingFailed', {
          requestId: 'n1',
          canceled: false,
        });
        await flush();
        expect(listPaused(1)[0].state).toBe('paused');

        listeners.onEvent({ tabId: 1 }, 'Network.loadingFailed', {
          requestId: 'n1',
          canceled: true,
        });
        await flush();
        expect(listPaused(1)[0].state).toBe('cancelled');
      });
    });
  });
});
