/**
 * @jest-environment jsdom
 */

import { escapeHtml, truncateUrl, getElement, getPatternInputs, getPatternsFromForm } from '../../js/ui/dom-helpers.js';
import { state, MAX_HISTORY, inspectedTabId } from '../../js/ui/state.js';
import { addRequest, getFilteredRequests, renderRequestList } from '../../js/ui/request-list.js';
import { formatGraphQL } from '../../js/ui/request-detail.js';
import { updateDebuggerStatus, showStatusBanner, hideStatusBanner, showError } from '../../js/ui/status.js';
import {
    resetUIState,
    setActiveUIState,
    handleStartSuccess,
    handleStartWarning,
    handleStartError,
    handleStopSuccess,
    handleStopWarning
} from '../../js/ui/debugger-controls.js';

function setupDOM() {
    document.body.innerHTML = `
        <div id="debugger-status" class="status-badge">
            <span class="status-dot"></span>
            <span class="status-text">Ready</span>
        </div>
        <div id="status-banner" class="status-banner hidden">
            <span id="status-banner-text"></span>
        </div>
        <span id="interception-counter">0</span>
        <div id="request-list">
            <div id="empty-state" style="display: flex;"></div>
        </div>
        <div id="detail-panel" class="hidden">
            <div id="detail-content"></div>
            <button id="close-detail"></button>
        </div>
        <form id="myForm">
            <div class="pattern-item">
                <input type="text" class="urlPattern" data-pattern-index="1" value="">
            </div>
        </form>
        <button id="add"></button>
        <button id="form-submit" class="btn btn-primary btn-block">
            <span class="btn-icon-play">&#9654;</span> Start
        </button>
        <input type="text" id="filter-input">
        <button class="chip active" data-filter="all">All</button>
        <button class="chip" data-filter="apq">APQ</button>
        <button class="chip" data-filter="full">Full</button>
    `;
}

function resetAppState() {
    state.totalPatterns = 1;
    state.isDebuggerActive = false;
    state.currentOperation = null;
    state.selectedRequestId = null;
    state.activeFilter = 'all';
    state.filterText = '';
    state.requestHistory = [];
    state.requestIdCounter = 0;
    if (state.statusBannerTimeout) {
        clearTimeout(state.statusBannerTimeout);
    }
    state.statusBannerTimeout = null;
}

describe('DevTools Panel Logic', () => {
    beforeEach(() => {
        setupDOM();
        resetAppState();
        jest.clearAllMocks();
    });

    // ── DOM Helpers ────────────────────────────────────────────────

    describe('DOM Helpers', () => {
        test('getElement should return element by ID', () => {
            const el = getElement('debugger-status');
            expect(el).not.toBeNull();
            expect(el.id).toBe('debugger-status');
        });

        test('getElement should return null for missing ID', () => {
            const spy = jest.spyOn(console, 'error').mockImplementation();
            const el = getElement('nonexistent');
            expect(el).toBeNull();
            spy.mockRestore();
        });

        test('escapeHtml should escape special characters', () => {
            expect(escapeHtml('<script>alert("xss")</script>')).toBe(
                '&lt;script&gt;alert("xss")&lt;/script&gt;'
            );
            expect(escapeHtml('a & b')).toBe('a &amp; b');
        });

        test('escapeHtml should handle empty string', () => {
            expect(escapeHtml('')).toBe('');
        });

        test('truncateUrl should keep short URLs as-is', () => {
            expect(truncateUrl('https://short.com')).toBe('https://short.com');
        });

        test('truncateUrl should truncate long URLs with ellipsis prefix', () => {
            const longUrl = 'https://example.com/very/long/path/to/a/resource/with/many/segments';
            const truncated = truncateUrl(longUrl, 40);
            expect(truncated).toHaveLength(43); // '...' + 40 chars
            expect(truncated.startsWith('...')).toBe(true);
        });

        test('getPatternInputs should return all pattern inputs', () => {
            const inputs = getPatternInputs();
            expect(inputs).toHaveLength(1);
            expect(inputs[0].className).toBe('urlPattern');
        });

        test('getPatternsFromForm should return trimmed non-empty values', () => {
            document.querySelector('.urlPattern').value = '  *graphql*  ';
            const patterns = getPatternsFromForm();
            expect(patterns).toEqual(['*graphql*']);
        });

        test('getPatternsFromForm should skip empty inputs', () => {
            document.querySelector('.urlPattern').value = '   ';
            const patterns = getPatternsFromForm();
            expect(patterns).toEqual([]);
        });
    });

    // ── State ──────────────────────────────────────────────────────

    describe('State', () => {
        test('MAX_HISTORY should be 500', () => {
            expect(MAX_HISTORY).toBe(500);
        });

        test('inspectedTabId should come from chrome.devtools mock', () => {
            expect(inspectedTabId).toBe(123);
        });

        test('initial state should have correct defaults', () => {
            expect(state.isDebuggerActive).toBe(false);
            expect(state.activeFilter).toBe('all');
            expect(state.requestHistory).toEqual([]);
        });
    });

    // ── Request List ───────────────────────────────────────────────

    describe('Request List', () => {
        test('addRequest should add to history and return request', () => {
            const req = addRequest({
                operationName: 'GetUsers',
                url: 'http://test.com/graphql',
                isAPQ: false
            });

            expect(req.id).toBe(1);
            expect(req.operationName).toBe('GetUsers');
            expect(req.type).toBe('full');
            expect(req.timestamp).toBeInstanceOf(Date);
            expect(state.requestHistory).toHaveLength(1);
        });

        test('addRequest should set APQ type correctly', () => {
            const req = addRequest({ operationName: 'GetUser', isAPQ: true });
            expect(req.type).toBe('apq');
        });

        test('addRequest should use defaults for missing fields', () => {
            const req = addRequest({});
            expect(req.operationName).toBe('Unknown');
            expect(req.url).toBe('');
            expect(req.query).toBe('');
            expect(req.variables).toBeNull();
        });

        test('addRequest should cap history at MAX_HISTORY', () => {
            for (let i = 0; i < MAX_HISTORY + 10; i++) {
                addRequest({ operationName: `Op${i}` });
            }
            expect(state.requestHistory.length).toBe(MAX_HISTORY);
            // Most recent should be first (unshift)
            expect(state.requestHistory[0].operationName).toBe(`Op${MAX_HISTORY + 9}`);
        });

        test('updateRequestCount should update counter element', () => {
            addRequest({ operationName: 'Test' });
            const counter = document.getElementById('interception-counter');
            expect(counter.textContent).toBe('1');
        });

        test('getFilteredRequests should return all when filter is "all"', () => {
            addRequest({ operationName: 'A', isAPQ: true });
            addRequest({ operationName: 'B', isAPQ: false });
            expect(getFilteredRequests()).toHaveLength(2);
        });

        test('getFilteredRequests should filter by type', () => {
            addRequest({ operationName: 'A', isAPQ: true });
            addRequest({ operationName: 'B', isAPQ: false });
            state.activeFilter = 'apq';
            const filtered = getFilteredRequests();
            expect(filtered).toHaveLength(1);
            expect(filtered[0].operationName).toBe('A');
        });

        test('getFilteredRequests should filter by text (case-insensitive)', () => {
            addRequest({ operationName: 'GetUsers', url: '' });
            addRequest({ operationName: 'GetPosts', url: '' });
            state.filterText = 'users';
            const filtered = getFilteredRequests();
            expect(filtered).toHaveLength(1);
            expect(filtered[0].operationName).toBe('GetUsers');
        });

        test('getFilteredRequests should also search in URL', () => {
            addRequest({ operationName: 'A', url: 'https://api.example.com/graphql' });
            addRequest({ operationName: 'B', url: 'https://other.com/api' });
            state.filterText = 'example';
            const filtered = getFilteredRequests();
            expect(filtered).toHaveLength(1);
            expect(filtered[0].operationName).toBe('A');
        });

        test('renderRequestList should show empty state when no requests', () => {
            renderRequestList();
            const emptyState = document.getElementById('empty-state');
            expect(emptyState.style.display).toBe('flex');
        });

        test('renderRequestList should render filtered items', () => {
            addRequest({ operationName: 'A', isAPQ: true });
            addRequest({ operationName: 'B', isAPQ: false });
            renderRequestList();
            const items = document.querySelectorAll('.request-item');
            expect(items.length).toBe(2);
        });

        test('renderRequestList should hide empty state when items present', () => {
            addRequest({ operationName: 'A' });
            renderRequestList();
            const emptyState = document.getElementById('empty-state');
            expect(emptyState.style.display).toBe('none');
        });
    });

    // ── Request Detail ─────────────────────────────────────────────

    describe('Request Detail', () => {
        test('formatGraphQL should highlight keywords', () => {
            const result = formatGraphQL('query GetUsers { users { id } }');
            expect(result).toContain('<span class="keyword">query</span>');
        });

        test('formatGraphQL should highlight types', () => {
            const result = formatGraphQL('name: String');
            expect(result).toContain('<span class="type">String</span>');
        });

        test('formatGraphQL should highlight variables', () => {
            const result = formatGraphQL('query ($limit: Int) { users(limit: $limit) { name } }');
            expect(result).toContain('<span class="variable">');
            expect(result).toContain('class="variable"');
        });

        test('formatGraphQL should handle multiple keywords', () => {
            const result = formatGraphQL('mutation CreateUser { fragment on User { id } }');
            expect(result).toContain('<span class="keyword">mutation</span>');
            expect(result).toContain('<span class="keyword">fragment</span>');
            expect(result).toContain('<span class="keyword">on</span>');
        });

        test('formatGraphQL should escape HTML before highlighting', () => {
            const result = formatGraphQL('query <script>alert("xss")</script>');
            expect(result).not.toContain('<script>');
            expect(result).toContain('&lt;script&gt;');
            expect(result).toContain('<span class="keyword">query</span>');
        });
    });

    // ── Status Management ──────────────────────────────────────────

    describe('Status Management', () => {
        test('updateDebuggerStatus should update text and apply active class', () => {
            updateDebuggerStatus('Active', 'active');
            const badge = document.getElementById('debugger-status');
            const text = badge.querySelector('.status-text');
            expect(text.textContent).toBe('Active');
            expect(badge.classList.contains('active')).toBe(true);
        });

        test('updateDebuggerStatus should apply warning class', () => {
            updateDebuggerStatus('Warning', 'warning');
            const badge = document.getElementById('debugger-status');
            expect(badge.classList.contains('warning')).toBe(true);
        });

        test('updateDebuggerStatus should apply error class', () => {
            updateDebuggerStatus('Error', 'error');
            const badge = document.getElementById('debugger-status');
            expect(badge.classList.contains('error')).toBe(true);
        });

        test('updateDebuggerStatus should reset classes for default type', () => {
            updateDebuggerStatus('Error', 'error');
            updateDebuggerStatus('Ready', 'default');
            const badge = document.getElementById('debugger-status');
            expect(badge.classList.contains('error')).toBe(false);
            expect(badge.className).toBe('status-badge');
        });

        test('showStatusBanner should display banner with message and type', () => {
            showStatusBanner('Test message', 'warning');
            const banner = document.getElementById('status-banner');
            const text = document.getElementById('status-banner-text');
            expect(banner.classList.contains('hidden')).toBe(false);
            expect(banner.classList.contains('warning')).toBe(true);
            expect(text.textContent).toBe('Test message');
        });

        test('showStatusBanner should auto-dismiss for success type', () => {
            jest.useFakeTimers();
            showStatusBanner('Success!', 'success');
            const banner = document.getElementById('status-banner');
            expect(banner.classList.contains('hidden')).toBe(false);

            jest.advanceTimersByTime(5000);
            expect(banner.classList.contains('hidden')).toBe(true);
            jest.useRealTimers();
        });

        test('showStatusBanner should auto-dismiss when autoDismiss is true', () => {
            jest.useFakeTimers();
            showStatusBanner('Info', 'default', true);
            expect(state.statusBannerTimeout).not.toBeNull();

            jest.advanceTimersByTime(5000);
            const banner = document.getElementById('status-banner');
            expect(banner.classList.contains('hidden')).toBe(true);
            jest.useRealTimers();
        });

        test('showStatusBanner should clear previous timeout', () => {
            jest.useFakeTimers();
            showStatusBanner('First', 'success');
            const firstTimeout = state.statusBannerTimeout;
            showStatusBanner('Second', 'warning');
            // The first timeout should have been cleared (new timeout or null)
            expect(state.statusBannerTimeout).not.toBe(firstTimeout);
            jest.useRealTimers();
        });

        test('hideStatusBanner should hide banner and clear timeout', () => {
            showStatusBanner('Temp message', 'default');
            hideStatusBanner();
            const banner = document.getElementById('status-banner');
            expect(banner.classList.contains('hidden')).toBe(true);
            expect(state.statusBannerTimeout).toBeNull();
        });

        test('showError should set error status and show error banner', () => {
            const spy = jest.spyOn(console, 'error').mockImplementation();
            showError('Something went wrong');
            const badge = document.getElementById('debugger-status');
            const text = badge.querySelector('.status-text');
            expect(text.textContent).toBe('Error');
            expect(badge.classList.contains('error')).toBe(true);
            const bannerText = document.getElementById('status-banner-text');
            expect(bannerText.textContent).toBe('Something went wrong');
            spy.mockRestore();
        });
    });

    // ── Debugger Controls ──────────────────────────────────────────

    describe('Debugger Controls', () => {
        test('resetUIState should reset button to Start state', () => {
            setActiveUIState(); // First set to active
            resetUIState();
            const btn = document.getElementById('form-submit');
            expect(btn.disabled).toBe(false);
            expect(btn.innerHTML).toContain('Start');
            expect(btn.className).toContain('btn-primary');
            expect(state.currentOperation).toBeNull();
        });

        test('setActiveUIState should set button to Stop state', () => {
            setActiveUIState();
            const btn = document.getElementById('form-submit');
            expect(btn.disabled).toBe(false);
            expect(btn.innerHTML).toContain('Stop');
            expect(btn.className).toContain('btn-danger');
        });

        test('handleStartSuccess should activate UI and set state', () => {
            handleStartSuccess('Connected');
            const badge = document.getElementById('debugger-status');
            expect(badge.querySelector('.status-text').textContent).toBe('Active');
            expect(badge.classList.contains('active')).toBe(true);
            expect(state.isDebuggerActive).toBe(true);
            const btn = document.getElementById('form-submit');
            expect(btn.innerHTML).toContain('Stop');
        });

        test('handleStartWarning should show warning and reset', () => {
            handleStartWarning('Already attached');
            const badge = document.getElementById('debugger-status');
            expect(badge.querySelector('.status-text').textContent).toBe('Warning');
            const btn = document.getElementById('form-submit');
            expect(btn.innerHTML).toContain('Start');
        });

        test('handleStartError should show error and reset', () => {
            handleStartError('Connection failed');
            const badge = document.getElementById('debugger-status');
            expect(badge.querySelector('.status-text').textContent).toBe('Failed');
            expect(badge.classList.contains('error')).toBe(true);
            const btn = document.getElementById('form-submit');
            expect(btn.innerHTML).toContain('Start');
        });

        test('handleStopSuccess should deactivate UI', () => {
            state.isDebuggerActive = true;
            handleStopSuccess();
            expect(state.isDebuggerActive).toBe(false);
            const btn = document.getElementById('form-submit');
            expect(btn.innerHTML).toContain('Start');
            expect(btn.className).toContain('btn-primary');
        });

        test('handleStopWarning should show warning and deactivate', () => {
            state.isDebuggerActive = true;
            handleStopWarning('Session ended');
            expect(state.isDebuggerActive).toBe(false);
            const badge = document.getElementById('debugger-status');
            expect(badge.querySelector('.status-text').textContent).toBe('Warning');
        });
    });
});
