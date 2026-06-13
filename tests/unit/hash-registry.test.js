import {
  initRegistry,
  registerHash,
  lookupHash,
  getRegistrySize,
  getRegistryEntries,
  clearRegistry,
  isPassiveMode,
  setPassiveMode,
} from '../../js/sw/hash-registry.js';
import { HASH_REGISTRY_MAX_ENTRIES } from '../../js/shared/constants.js';

describe('Hash Registry', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    chrome.runtime.lastError = null;

    chrome.storage.local.get.mockImplementation((_keys, cb) => {
      chrome.runtime.lastError = null;
      cb({});
    });
    chrome.storage.local.set.mockImplementation((_items, cb) => {
      chrome.runtime.lastError = null;
      cb && cb();
    });
    chrome.runtime.sendMessage.mockImplementation((_msg, cb) => cb && cb(null));

    // Reset module state between tests
    clearRegistry();
    await setPassiveMode(false);
    jest.clearAllMocks();
  });

  describe('registerHash / lookupHash', () => {
    test('should register and resolve a hash', () => {
      registerHash('abc123', {
        query: '{ users { id } }',
        operationName: 'GetUsers',
        variables: { limit: 10 },
      });

      const entry = lookupHash('abc123');
      expect(entry).not.toBeNull();
      expect(entry.query).toBe('{ users { id } }');
      expect(entry.operationName).toBe('GetUsers');
      expect(entry.variables).toEqual({ limit: 10 });
      expect(getRegistrySize()).toBe(1);
    });

    test('should return null for unknown hash', () => {
      expect(lookupHash('does-not-exist')).toBeNull();
    });

    test('should ignore invalid hashes', () => {
      registerHash(null, { query: 'x' });
      registerHash(42, { query: 'x' });
      registerHash('', { query: 'x' });
      expect(getRegistrySize()).toBe(0);
    });

    test('should persist registry to storage on register', () => {
      registerHash('abc123', { query: '{ me }' });

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          apqHashRegistry: expect.objectContaining({
            abc123: expect.objectContaining({ query: '{ me }' }),
          }),
        }),
        expect.any(Function)
      );
    });

    test('should broadcast REGISTRY_UPDATED for new hashes only', () => {
      registerHash('abc123', { query: '{ me }' });
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'REGISTRY_UPDATED', size: 1 }),
        expect.any(Function)
      );

      jest.clearAllMocks();
      registerHash('abc123', { query: '{ me }' }); // re-register same hash
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('size cap', () => {
    const fillRegistry = () => {
      for (let i = 0; i < HASH_REGISTRY_MAX_ENTRIES; i++) {
        registerHash(`hash-${i}`, { query: `{ q${i} }` });
      }
    };

    test('should evict the oldest hash once the cap is exceeded', () => {
      fillRegistry();
      expect(getRegistrySize()).toBe(HASH_REGISTRY_MAX_ENTRIES);

      registerHash('one-more', { query: '{ extra }' });

      expect(getRegistrySize()).toBe(HASH_REGISTRY_MAX_ENTRIES);
      expect(lookupHash('hash-0')).toBeNull();
      expect(lookupHash('one-more')).not.toBeNull();
    });

    test('should refresh recency when a hash is re-registered', () => {
      fillRegistry();
      registerHash('hash-0', { query: '{ q0 }' }); // refresh the oldest entry

      registerHash('one-more', { query: '{ extra }' });

      expect(lookupHash('hash-0')).not.toBeNull();
      expect(lookupHash('hash-1')).toBeNull();
    });

    test('initRegistry should trim oversized persisted registries', async () => {
      const stored = {};
      for (let i = 0; i < HASH_REGISTRY_MAX_ENTRIES + 5; i++) {
        stored[`hash-${i}`] = {
          query: `{ q${i} }`,
          operationName: '',
          variables: null,
          registeredAt: i,
        };
      }
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = null;
        cb({ apqHashRegistry: stored });
      });

      await initRegistry();

      expect(getRegistrySize()).toBe(HASH_REGISTRY_MAX_ENTRIES);
      expect(lookupHash('hash-0')).toBeNull();
      expect(lookupHash(`hash-${HASH_REGISTRY_MAX_ENTRIES + 4}`)).not.toBeNull();
    });
  });

  describe('clearRegistry', () => {
    test('should empty the registry and broadcast', () => {
      registerHash('abc123', { query: '{ me }' });
      jest.clearAllMocks();

      clearRegistry();

      expect(getRegistrySize()).toBe(0);
      expect(lookupHash('abc123')).toBeNull();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'REGISTRY_UPDATED', size: 0 }),
        expect.any(Function)
      );
    });
  });

  describe('passive mode', () => {
    test('should default to false', () => {
      expect(isPassiveMode()).toBe(false);
    });

    test('should persist passive mode flag', async () => {
      await setPassiveMode(true);

      expect(isPassiveMode()).toBe(true);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { apqPassiveMode: true },
        expect.any(Function)
      );
    });
  });

  describe('initRegistry', () => {
    test('should load entries and passive mode from storage', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = null;
        cb({
          apqHashRegistry: {
            stored1: { query: '{ a }', operationName: 'A', variables: null, registeredAt: 1 },
          },
          apqPassiveMode: true,
        });
      });

      await initRegistry();

      expect(lookupHash('stored1')).toEqual(
        expect.objectContaining({ query: '{ a }', operationName: 'A' })
      );
      expect(isPassiveMode()).toBe(true);
    });

    test('should handle storage errors gracefully', async () => {
      chrome.storage.local.get.mockImplementation((_keys, cb) => {
        chrome.runtime.lastError = { message: 'Storage error' };
        cb({});
        chrome.runtime.lastError = null;
      });

      await expect(initRegistry()).resolves.toBeUndefined();
    });
  });

  describe('getRegistryEntries', () => {
    test('should return a plain object snapshot', () => {
      registerHash('h1', { query: '{ a }' });
      registerHash('h2', { query: '{ b }' });

      const entries = getRegistryEntries();
      expect(Object.keys(entries).sort()).toEqual(['h1', 'h2']);
      expect(entries.h1.query).toBe('{ a }');
    });
  });
});
