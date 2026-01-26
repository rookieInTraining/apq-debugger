// DevTools Panel Creation
chrome.devtools.panels.create("APQ Debugger",
    "../icons/icon128.png",
    "../frontend/devtools.html",
    function (panel) {
        console.log("APQ Debugger panel created:", panel);
    }
);

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function () {
    // ================================================
    // State Management
    // ================================================
    let totalPatterns = 1;
    let isDebuggerActive = false;
    let currentOperation = null;
    let selectedRequestId = null;
    let activeFilter = 'all';
    let filterText = '';

    const PATTERNS_STORAGE_KEY = 'apqPatterns';

    // Get the tab ID of the inspected window (works even when DevTools is undocked)
    const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

    // Request history storage
    const requestHistory = [];
    let requestIdCounter = 0;

    // ================================================
    // DOM Element Helpers
    // ================================================
    function getElement(id) {
        const element = document.getElementById(id);
        if (!element) {
            console.error(`Element with id '${id}' not found`);
        }
        return element;
    }

    function getPatternInputs() {
        return Array.from(document.querySelectorAll('.urlPattern'));
    }

    function getPatternsFromForm() {
        return getPatternInputs()
            .map((input) => (input ? input.value.trim() : ''))
            .filter((value) => value.length > 0);
    }

    // ================================================
    // Pattern Storage
    // ================================================
    function savePatternsToStorage() {
        const patterns = getPatternsFromForm();
        chrome.storage.local.set({ [PATTERNS_STORAGE_KEY]: patterns }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Failed to save patterns:', chrome.runtime.lastError);
            }
        });
    }

    function restorePatternsFromStorage() {
        chrome.storage.local.get([PATTERNS_STORAGE_KEY], (result) => {
            if (chrome.runtime.lastError) {
                console.warn('Failed to load patterns:', chrome.runtime.lastError);
                return;
            }

            const patterns = Array.isArray(result[PATTERNS_STORAGE_KEY])
                ? result[PATTERNS_STORAGE_KEY]
                : [];

            const inputs = getPatternInputs();
            if (inputs.length === 0) return;

            if (patterns.length > 0) {
                inputs[0].value = patterns[0];
            }

            for (let i = 1; i < patterns.length; i++) {
                addPatternField(patterns[i]);
            }
        });
    }

    // ================================================
    // Pattern Field Management
    // ================================================
    function addPatternField(value = '') {
        const form = document.querySelector("#myForm");
        if (!form) return;

        const patternItem = document.createElement("div");
        patternItem.className = 'pattern-item';

        const input = document.createElement("input");
        input.type = 'text';
        input.className = 'urlPattern';
        input.setAttribute('data-pattern-index', ++totalPatterns);
        input.placeholder = '*graphql*';
        if (value) input.value = value;
        input.addEventListener('input', savePatternsToStorage);

        const removeBtn = document.createElement("button");
        removeBtn.type = 'button';
        removeBtn.className = 'btn-icon btn-remove';
        removeBtn.title = 'Remove pattern';
        removeBtn.innerHTML = '×';
        removeBtn.addEventListener('click', () => {
            patternItem.remove();
            savePatternsToStorage();
        });

        patternItem.appendChild(input);
        patternItem.appendChild(removeBtn);
        form.appendChild(patternItem);

        savePatternsToStorage();
    }

    // Add pattern button
    const addButton = getElement("add");
    if (addButton) {
        addButton.addEventListener('click', () => addPatternField());
    }

    // Initial pattern input listener
    const initialInput = document.querySelector('.urlPattern');
    if (initialInput) {
        initialInput.addEventListener('input', savePatternsToStorage);
    }

    // ================================================
    // Status Management
    // ================================================
    function updateDebuggerStatus(text, type = 'default') {
        const statusBadge = getElement('debugger-status');
        if (!statusBadge) return;

        const statusText = statusBadge.querySelector('.status-text');
        if (statusText) statusText.textContent = text;

        statusBadge.className = 'status-badge';
        if (type === 'active' || type === 'success') {
            statusBadge.classList.add('active');
        } else if (type === 'warning') {
            statusBadge.classList.add('warning');
        } else if (type === 'error') {
            statusBadge.classList.add('error');
        }
    }

    function updateResponse(message) {
        const responseContainer = getElement('response-container');
        const responseElement = getElement('response');

        if (responseContainer) responseContainer.style.display = 'block';
        if (responseElement) responseElement.innerText = message;
    }

    function showError(message) {
        console.error(message);
        updateDebuggerStatus("Error", "error");
        updateResponse(`Error: ${message}`);
    }

    // ================================================
    // Request Counter
    // ================================================
    function updateRequestCount() {
        const counter = getElement('interception-counter');
        if (counter) {
            counter.textContent = requestHistory.length;
            counter.style.transform = 'scale(1.2)';
            setTimeout(() => {
                counter.style.transform = 'scale(1)';
            }, 200);
        }
    }

    // ================================================
    // Request History Management
    // ================================================
    function addRequest(requestData) {
        const request = {
            id: ++requestIdCounter,
            timestamp: new Date(),
            operationName: requestData.operationName || 'Unknown',
            url: requestData.url || '',
            type: requestData.isAPQ ? 'apq' : 'full',
            hash: requestData.hash || '',
            query: requestData.query || '',
            variables: requestData.variables || null,
            responseTime: requestData.responseTime || null
        };

        requestHistory.unshift(request);
        updateRequestCount();
        renderRequestList();

        return request;
    }

    function getFilteredRequests() {
        return requestHistory.filter(req => {
            // Type filter
            if (activeFilter !== 'all' && req.type !== activeFilter) {
                return false;
            }
            // Text filter
            if (filterText) {
                const searchText = filterText.toLowerCase();
                return req.operationName.toLowerCase().includes(searchText) ||
                    req.url.toLowerCase().includes(searchText);
            }
            return true;
        });
    }

    // ================================================
    // Request List Rendering
    // ================================================
    function renderRequestList() {
        const listContainer = getElement('request-list');
        const emptyState = getElement('empty-state');
        if (!listContainer) return;

        const filtered = getFilteredRequests();

        // Clear existing items (except empty state)
        listContainer.querySelectorAll('.request-item').forEach(el => el.remove());

        if (filtered.length === 0) {
            if (emptyState) emptyState.style.display = 'flex';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        filtered.forEach(request => {
            const item = createRequestItem(request);
            listContainer.appendChild(item);
        });
    }

    function createRequestItem(request) {
        const item = document.createElement('div');
        item.className = 'request-item';
        if (request.id === selectedRequestId) {
            item.classList.add('selected');
        }
        item.dataset.requestId = request.id;

        const timeStr = request.timestamp.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        item.innerHTML = `
            <div class="request-info">
                <div class="request-operation">${escapeHtml(request.operationName)}</div>
                <div class="request-url">${escapeHtml(truncateUrl(request.url))}</div>
            </div>
            <div class="request-meta">
                <span class="request-time">${timeStr}</span>
                <span class="request-badge ${request.type}">${request.type.toUpperCase()}</span>
            </div>
        `;

        item.addEventListener('click', () => selectRequest(request.id));

        return item;
    }

    function truncateUrl(url, maxLength = 40) {
        if (url.length <= maxLength) return url;
        return '...' + url.slice(-maxLength);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ================================================
    // Request Selection & Detail Display
    // ================================================
    function selectRequest(requestId) {
        selectedRequestId = requestId;

        // Update selection in list
        document.querySelectorAll('.request-item').forEach(item => {
            item.classList.toggle('selected', parseInt(item.dataset.requestId) === requestId);
        });

        // Show detail panel
        const detailPanel = getElement('detail-panel');
        if (detailPanel) detailPanel.classList.remove('hidden');

        // Render details
        renderRequestDetail(requestId);
    }

    function renderRequestDetail(requestId) {
        const request = requestHistory.find(r => r.id === requestId);
        const detailContent = getElement('detail-content');
        if (!request || !detailContent) return;

        const formattedQuery = request.query ? formatGraphQL(request.query) : 'No query available';
        const variablesJson = request.variables ? JSON.stringify(request.variables, null, 2) : null;

        detailContent.innerHTML = `
            <div class="detail-section">
                <div class="detail-label">Operation</div>
                <div class="detail-value">${escapeHtml(request.operationName)}</div>
            </div>
            
            <div class="detail-section">
                <div class="detail-label">Type</div>
                <div class="detail-value">
                    <span class="request-badge ${request.type}">${request.type.toUpperCase()}</span>
                </div>
            </div>
            
            ${request.hash ? `
            <div class="detail-section">
                <div class="detail-label">SHA256 Hash</div>
                <div class="detail-hash">${escapeHtml(request.hash)}</div>
            </div>
            ` : ''}
            
            <div class="detail-section">
                <div class="detail-label">URL</div>
                <div class="detail-value" style="font-family: var(--font-mono); font-size: 11px; word-break: break-all;">${escapeHtml(request.url)}</div>
            </div>
            
            <div class="detail-section">
                <div class="code-block">
                    <div class="code-header">
                        <span class="code-title">GraphQL Query</span>
                        <button class="btn btn-copy" data-copy="query">Copy</button>
                    </div>
                    <pre class="code-content">${formattedQuery}</pre>
                </div>
            </div>
            
            ${variablesJson ? `
            <div class="detail-section">
                <div class="code-block">
                    <div class="code-header">
                        <span class="code-title">Variables</span>
                        <button class="btn btn-copy" data-copy="variables">Copy</button>
                    </div>
                    <pre class="code-content">${escapeHtml(variablesJson)}</pre>
                </div>
            </div>
            ` : ''}
        `;

        // Add copy handlers
        detailContent.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.copy;
                const text = type === 'query' ? request.query : JSON.stringify(request.variables, null, 2);
                copyToClipboard(text, btn);
            });
        });
    }

    function formatGraphQL(query) {
        // Basic syntax highlighting for GraphQL
        return escapeHtml(query)
            .replace(/\b(query|mutation|subscription|fragment|on)\b/g, '<span class="keyword">$1</span>')
            .replace(/\b(String|Int|Float|Boolean|ID|!)\b/g, '<span class="type">$1</span>')
            .replace(/\$(\w+)/g, '<span class="variable">$$1</span>');
    }

    function copyToClipboard(text, button) {
        navigator.clipboard.writeText(text).then(() => {
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            setTimeout(() => {
                button.textContent = originalText;
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    }

    // Close detail panel
    const closeDetailBtn = getElement('close-detail');
    if (closeDetailBtn) {
        closeDetailBtn.addEventListener('click', () => {
            const detailPanel = getElement('detail-panel');
            if (detailPanel) detailPanel.classList.add('hidden');
            selectedRequestId = null;
            document.querySelectorAll('.request-item.selected').forEach(el => el.classList.remove('selected'));
        });
    }

    // ================================================
    // Filter Functionality
    // ================================================
    const filterInput = getElement('filter-input');
    if (filterInput) {
        filterInput.addEventListener('input', (e) => {
            filterText = e.target.value;
            renderRequestList();
        });
    }

    // Filter chips
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeFilter = chip.dataset.filter;
            renderRequestList();
        });
    });

    // ================================================
    // Start/Stop Debugger
    // ================================================
    function resetUIState() {
        const submitButton = getElement('form-submit');
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = '<span class="btn-icon-play">▶</span> Start';
            submitButton.className = 'btn btn-primary btn-block';
        }
        currentOperation = null;
    }

    function setActiveUIState() {
        const submitButton = getElement('form-submit');
        if (submitButton) {
            submitButton.innerHTML = '<span class="btn-icon-play">⏹</span> Stop';
            submitButton.className = 'btn btn-danger btn-block';
        }
    }

    const submitButton = getElement('form-submit');
    if (submitButton) {
        submitButton.addEventListener('click', handleToggleDebugger);
    }

    function handleToggleDebugger(e) {
        e.preventDefault();

        if (currentOperation) {
            console.log("Operation already in progress");
            return;
        }

        if (isDebuggerActive) {
            stopDebugger();
        } else {
            startDebugger();
        }
    }

    function startDebugger() {
        currentOperation = 'starting';

        const urlPatterns = [];
        document.querySelectorAll('.pattern-item').forEach((d) => {
            const input = d.querySelector('.urlPattern');
            if (input && input.value.trim()) {
                urlPatterns.push({
                    urlPattern: input.value.trim(),
                    requestType: 'XHR',
                    requestStage: 'Request'
                });
            }
        });

        if (urlPatterns.length === 0) {
            showError("Please enter at least one URL pattern");
            currentOperation = null;
            return;
        }

        savePatternsToStorage();
        updateDebuggerStatus("Connecting...", "warning");

        const submitButton = getElement('form-submit');
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.innerHTML = '<span class="btn-icon-play">⏳</span> Starting...';
        }

        const startTimeout = setTimeout(() => {
            handleStartTimeout();
        }, 15000);

        chrome.runtime.sendMessage({ patterns: urlPatterns, tabId: inspectedTabId }, (response) => {
            clearTimeout(startTimeout);
            currentOperation = null;

            if (chrome.runtime.lastError) {
                handleStartError(chrome.runtime.lastError.message);
                return;
            }

            if (response && response.status === "SUCCESS") {
                handleStartSuccess(response.message);
            } else if (response && response.status === "WARNING") {
                handleStartWarning(response.message);
            } else {
                handleStartError(response?.error || "Unknown error");
            }
        });
    }

    function stopDebugger() {
        currentOperation = 'stopping';
        updateDebuggerStatus("Disconnecting...", "warning");

        const submitButton = getElement('form-submit');
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.innerHTML = '<span class="btn-icon-play">⏳</span> Stopping...';
        }

        const stopTimeout = setTimeout(() => {
            handleStopTimeout();
        }, 10000);

        chrome.runtime.sendMessage({ disconnect: true, tabId: inspectedTabId }, (response) => {
            clearTimeout(stopTimeout);
            currentOperation = null;

            if (chrome.runtime.lastError) {
                handleStopError(chrome.runtime.lastError.message);
                return;
            }

            if (response && response.status === "SUCCESS") {
                handleStopSuccess();
            } else if (response && response.status === "WARNING") {
                handleStopWarning(response.message);
            } else {
                handleStopError(response?.error || "Unknown error");
            }
        });
    }

    function handleStartSuccess(message) {
        updateDebuggerStatus("Active", "active");
        updateResponse(message);
        setActiveUIState();
        isDebuggerActive = true;
    }

    function handleStartWarning(message) {
        updateDebuggerStatus("Warning", "warning");
        updateResponse(`Warning: ${message}`);
        resetUIState();
    }

    function handleStartError(error) {
        updateDebuggerStatus("Failed", "error");
        updateResponse(`Error: ${error}`);
        resetUIState();
    }

    function handleStartTimeout() {
        currentOperation = null;
        updateDebuggerStatus("Timeout", "error");
        updateResponse("Start operation timed out");
        resetUIState();
    }

    function handleStopSuccess() {
        updateDebuggerStatus("Stopped", "error");
        updateResponse("Debugger disconnected");
        resetUIState();
        isDebuggerActive = false;
    }

    function handleStopWarning(message) {
        updateDebuggerStatus("Warning", "warning");
        updateResponse(`Warning: ${message}`);
        resetUIState();
        isDebuggerActive = false;
    }

    function handleStopError(error) {
        updateDebuggerStatus("Error", "error");
        updateResponse(`Error: ${error}`);
        resetUIState();
    }

    function handleStopTimeout() {
        currentOperation = null;
        updateDebuggerStatus("Timeout", "error");
        updateResponse("Stop operation timed out");
        resetUIState();
    }

    // ================================================
    // Message Listeners
    // ================================================
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
            if (message.status === 'INTERCEPTED') {
                // Add to request history
                addRequest({
                    operationName: message.operationName || 'Unknown Query',
                    url: message.url || '',
                    isAPQ: message.isAPQ !== false,
                    hash: message.hash || '',
                    query: message.query || '',
                    variables: message.variables || null,
                    responseTime: message.responseTime || null
                });

                sendResponse({ status: 'Message received' });
            } else if (message.status === 'ACTION_TOGGLE') {
                if (message.error) {
                    handleStartError(message.error);
                    return;
                }

                if (message.active) {
                    handleStartSuccess(message.message || 'Debugger attached via toolbar');
                } else {
                    handleStopSuccess();
                }
            }
        } catch (error) {
            console.error('Error handling message:', error);
            sendResponse({ status: 'Error processing message' });
        }
    });

    // Debugger detachment listener
    chrome.debugger.onDetach.addListener((source, reason) => {
        currentOperation = null;
        isDebuggerActive = false;

        const reasonMessages = {
            'target_closed': 'Tab closed',
            'canceled_by_user': 'Manually detached'
        };

        updateDebuggerStatus("Disconnected", "error");
        updateResponse(`Debugger disconnected: ${reasonMessages[reason] || 'Unknown reason'}`);
        resetUIState();
    });

    // Extension suspend handler
    chrome.runtime.onSuspend.addListener(() => {
        resetUIState();
        updateDebuggerStatus("Suspended", "error");
    });

    // ================================================
    // Initialization
    // ================================================
    console.log("APQ Debugger DevTools panel initialized");
    updateDebuggerStatus("Ready", "default");
    restorePatternsFromStorage();
    renderRequestList();

    // Check if debugger is already attached to this tab
    chrome.runtime.sendMessage({ getStatus: true, tabId: inspectedTabId }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn('Failed to get debugger status:', chrome.runtime.lastError);
            return;
        }

        if (response && response.status === "SUCCESS" && response.debuggerActive) {
            console.log("Debugger already active on tab:", inspectedTabId);
            handleStartSuccess("Debugger is already active on this tab");
        }
    });
});