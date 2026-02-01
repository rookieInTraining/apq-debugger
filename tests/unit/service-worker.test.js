const {
    validateUrlPattern,
    isDebuggerActive,
    attachedTabs,
    contaminatePayload,
    digestMessage
} = require('../../js/service-worker');

describe('Service Worker Logic', () => {
    beforeEach(() => {
        attachedTabs.clear();
        jest.clearAllMocks();
    });

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

        test('should throw error for dangerous content', () => {
            expect(() => validateUrlPattern('javascript:alert(1)')).toThrow('potentially dangerous');
            expect(() => validateUrlPattern('<script>')).toThrow('potentially dangerous');
        });
    });

    describe('isDebuggerActive', () => {
        test('should return true if tab is in attachedTabs set', () => {
            attachedTabs.add(123);
            const callback = jest.fn();

            isDebuggerActive(123, callback);

            expect(callback).toHaveBeenCalledWith(true);
            expect(chrome.debugger.getTargets).not.toHaveBeenCalled();
        });

        test('should check chrome.debugger if not in attachedTabs', () => {
            const callback = jest.fn();
            chrome.debugger.getTargets.mockImplementation((cb) => {
                cb([{ tabId: 456, attached: true }]);
            });

            isDebuggerActive(456, callback);

            expect(chrome.debugger.getTargets).toHaveBeenCalled();
            expect(callback).toHaveBeenCalledWith(true);
        });

        test('should return false if not attached anywhere', () => {
            const callback = jest.fn();
            chrome.debugger.getTargets.mockImplementation((cb) => {
                cb([{ tabId: 789, attached: false }]);
            });

            isDebuggerActive(789, callback);

            expect(callback).toHaveBeenCalledWith(false);
        });
    });

    describe('digestMessage (SHA-256)', () => {
        test('should generate correct hash', async () => {
            // Known hash for '1234567890'
            const hash = await digestMessage('1234567890');
            expect(hash).toBe('c775e7b757ede630cd0aa11113bd102661ab38829ca52a6422ab782862f26864'); // Matches mock value
        });
    });
});
