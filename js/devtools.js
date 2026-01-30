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
    // Initialize variables
    const inspectedTabId = chrome.devtools.inspectedWindow.tabId;
    var totalPatterns = 1;
    var totalInterception = 0;
    var currentOperation = null; // 'starting', 'stopping', null
    const PATTERNS_STORAGE_KEY = 'apqPatterns';

    // Utility function to safely get DOM elements
    function getElement(id) {
        const element = document.getElementById(id);
        if (!element) {
            console.error(`Element with id '${id}' not found`);
            return null;
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

    function savePatternsToStorage() {
        const patterns = getPatternsFromForm();
        chrome.storage.local.set({ [PATTERNS_STORAGE_KEY]: patterns }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Failed to save patterns:', chrome.runtime.lastError);
            }
        });
    }

    function createPatternField(value) {
        let formGroup = document.createElement("div");
        formGroup.setAttribute('class', 'form-group');

        let newFormInput = document.createElement("input");
        newFormInput.setAttribute('type', 'text');
        newFormInput.setAttribute('class', 'urlPattern');
        newFormInput.setAttribute('data-pattern-index', ++totalPatterns);
        newFormInput.setAttribute('placeholder', 'Enter URL pattern to match (e.g., /graphql)');
        if (value) {
            newFormInput.value = value;
        }
        newFormInput.addEventListener('input', savePatternsToStorage);

        let removeButton = document.createElement("button");
        removeButton.setAttribute('type', 'button');
        removeButton.setAttribute('class', 'btn btn-danger');
        removeButton.innerText = "Remove";
        removeButton.addEventListener('click', (e) => {
            try {
                const parent = e.target.parentElement;
                if (parent && parent.parentElement) {
                    parent.parentElement.removeChild(parent);
                    savePatternsToStorage();
                }
            } catch (error) {
                console.error('Error removing pattern field:', error);
            }
        });

        formGroup.appendChild(newFormInput);
        formGroup.appendChild(removeButton);
        return formGroup;
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
            if (inputs.length === 0) {
                return;
            }

            if (patterns.length > 0) {
                inputs[0].value = patterns[0];
            }

            const form = document.querySelector("#myForm");
            if (!form) {
                console.error("Form element not found");
                return;
            }

            for (let i = 1; i < patterns.length; i++) {
                form.appendChild(createPatternField(patterns[i]));
            }
        });
    }

    // Safe DOM manipulation
    function safeUpdateElement(id, property, value) {
        const element = getElement(id);
        if (element) {
            element[property] = value;
        }
    }

    // Add pattern button functionality
    const addButton = getElement("add");
    if (addButton) {
        addButton.addEventListener('click', (e) => {
            console.log("Adding new pattern field...");

            try {
                const form = document.querySelector("#myForm");
                if (form) {
                    form.appendChild(createPatternField(''));
                    console.log("New pattern field added successfully");
                    savePatternsToStorage();
                } else {
                    console.error("Form element not found");
                }
            } catch (error) {
                console.error('Error adding pattern field:', error);
                showError("Failed to add pattern field");
            }
        });
    }

    // Add stop button functionality with error handling
    var addStopButton = () => {
        try {
            // Remove existing stop button if any
            const existingStopButton = document.querySelector("#form-actions .btn-danger");
            if (existingStopButton) {
                existingStopButton.remove();
            }

            let stopDebugger = document.createElement("button");
            stopDebugger.setAttribute('type', 'button');
            stopDebugger.setAttribute('class', 'btn btn-danger');
            stopDebugger.setAttribute('id', 'stop-debugger-btn');
            stopDebugger.innerText = "Stop Debugging";

            const formActions = document.querySelector("#form-actions");
            if (formActions) {
                formActions.appendChild(stopDebugger);

                stopDebugger.addEventListener('click', handleStopDebugger);
                console.log("Stop button added successfully");
            } else {
                console.error("Form actions container not found");
            }
        } catch (error) {
            console.error('Error adding stop button:', error);
            showError("Failed to add stop button");
        }
    };

    // Handle stop debugger with comprehensive error handling
    function handleStopDebugger(e) {
        if (currentOperation === 'stopping') {
            console.log("Stop operation already in progress");
            return;
        }

        try {
            currentOperation = 'stopping';
            console.log("Stopping debugger...");

            updateResponse("Disconnecting Debugger....");
            updateDebuggerStatus("🟡 Disconnecting...", "warning");

            // Disable stop button during operation
            const stopButton = getElement('stop-debugger-btn');
            if (stopButton) {
                stopButton.disabled = true;
                stopButton.textContent = 'Stopping...';
            }

            const dataToSend = { disconnect: true, tabId: inspectedTabId };

            // Add timeout for stop operation
            const stopTimeout = setTimeout(() => {
                console.error("Stop operation timed out");
                handleStopTimeout();
            }, 10000); // 10 second timeout

            chrome.runtime.sendMessage(dataToSend, (response) => {
                clearTimeout(stopTimeout);
                currentOperation = null;

                console.log('Stop response:', response);

                if (chrome.runtime.lastError) {
                    console.error('Stop operation failed:', chrome.runtime.lastError);
                    handleStopError(chrome.runtime.lastError.message);
                    return;
                }

                if (response && response.status === "SUCCESS") {
                    handleStopSuccess();
                } else if (response && response.status === "WARNING") {
                    handleStopWarning(response.message);
                } else {
                    handleStopError(response?.error || "Unknown error occurred");
                }
            });
        } catch (error) {
            currentOperation = null;
            console.error('Error in stop debugger:', error);
            handleStopError("Internal error occurred");
        }
    }

    function handleStopSuccess() {
        updateDebuggerStatus("🔴 Debugger Stopped", "error");
        updateResponse("Debugger Disconnected Successfully!");
        resetUIState();
        isDebuggerActive = false;
    }

    function handleStopWarning(message) {
        updateDebuggerStatus("🟡 Debugger Status Unknown", "warning");
        updateResponse(`Warning: ${message}`);
        resetUIState();
        isDebuggerActive = false;
    }

    function handleStopError(error) {
        updateDebuggerStatus("🔴 Stop Failed", "error");
        updateResponse(`Error: ${error}`);
        resetUIState();
        // Keep debugger as active since stop failed
    }

    function handleStopTimeout() {
        currentOperation = null;
        updateDebuggerStatus("🔴 Stop Timeout", "error");
        updateResponse("Stop operation timed out. Please try again.");
        resetUIState();
    }

    // Update debugger status with validation
    function updateDebuggerStatus(message, type) {
        try {
            const statusElement = getElement('debugger-status');
            if (!statusElement) {
                console.error("Status element not found");
                return;
            }

            statusElement.textContent = message;

            // Reset all styles first
            statusElement.className = 'status';
            statusElement.style.background = '';
            statusElement.style.color = '';

            // Apply type-specific styling
            if (type === 'success') {
                statusElement.style.background = '#28a745';
            } else if (type === 'warning') {
                statusElement.style.background = '#ffc107';
                statusElement.style.color = '#333';
            } else if (type === 'error') {
                statusElement.style.background = '#dc3545';
            } else if (type === 'info') {
                statusElement.style.background = '#17a2b8';
            }
        } catch (error) {
            console.error('Error updating debugger status:', error);
        }
    }

    // Update response with validation
    function updateResponse(message) {
        try {
            const responseContainer = getElement('response-container');
            const responseElement = getElement('response');

            if (responseContainer) {
                responseContainer.style.display = 'block';
            }

            if (responseElement) {
                responseElement.innerText = message;
            } else {
                // Create response element if it doesn't exist
                const newResponse = document.createElement("div");
                newResponse.setAttribute('id', 'response');
                newResponse.setAttribute('class', 'response');
                newResponse.innerText = message;

                if (responseContainer) {
                    responseContainer.appendChild(newResponse);
                }
            }
        } catch (error) {
            console.error('Error updating response:', error);
        }
    }

    // Show error message
    function showError(message) {
        console.error(message);
        updateDebuggerStatus("🔴 Error", "error");
        updateResponse(`Error: ${message}`);
    }

    // Reset UI state
    function resetUIState() {
        try {
            // Reset form submit button
            const submitButton = getElement('form-submit');
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = 'Start Debugging';
                submitButton.className = 'btn btn-primary';
            }

            // Remove stop button
            const stopButton = document.querySelector("#stop-debugger-btn");
            if (stopButton) {
                stopButton.remove();
            }

            // Reset operation state
            currentOperation = null;
        } catch (error) {
            console.error('Error resetting UI state:', error);
        }
    }

    // Form submit functionality with comprehensive error handling
    const submitButton = getElement('form-submit');
    if (submitButton) {
        submitButton.addEventListener('click', handleFormSubmit);
    }

    function handleFormSubmit(e) {
        e.preventDefault();

        if (currentOperation === 'starting') {
            console.log("Start operation already in progress");
            return;
        }

        try {
            // Validate form data
            const urlPatterns = [];
            const formGroups = document.querySelectorAll('.form-group');

            if (formGroups.length === 0) {
                showError("No pattern fields found");
                return;
            }

            formGroups.forEach((d) => {
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
                showError("Please enter at least one URL pattern to match");
                return;
            }

            savePatternsToStorage();
            // Start debugger
            startDebugger(urlPatterns);
        } catch (error) {
            console.error('Error in form submit:', error);
            showError("Form submission failed");
        }
    }

    function startDebugger(urlPatterns) {
        currentOperation = 'starting';

        // Update UI to show processing
        updateDebuggerStatus("🟡 Starting Debugger...", "warning");
        const submitButton = getElement('form-submit');
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = 'Starting...';
        }

        const dataToSend = { patterns: urlPatterns, tabId: inspectedTabId };

        // Add timeout for start operation
        const startTimeout = setTimeout(() => {
            console.error("Start operation timed out");
            handleStartTimeout();
        }, 15000); // 15 second timeout

        // Check if Chrome runtime is available
        if (!chrome.runtime || !chrome.runtime.sendMessage) {
            clearTimeout(startTimeout);
            currentOperation = null;
            showError("Chrome runtime not available");
            return;
        }

        chrome.runtime.sendMessage(dataToSend, (response) => {
            clearTimeout(startTimeout);
            currentOperation = null;

            console.log('Start response:', response);

            if (chrome.runtime.lastError) {
                console.error('Start operation failed:', chrome.runtime.lastError);
                handleStartError(chrome.runtime.lastError.message);
                return;
            }

            if (response && response.status === "SUCCESS") {
                handleStartSuccess(response.message);
            } else if (response && response.status === "WARNING") {
                handleStartWarning(response.message);
            } else {
                handleStartError(response?.error || "Unknown error occurred");
            }
        });
    }

    function handleStartSuccess(message) {
        updateDebuggerStatus("🟢 Debugger Active", "success");
        updateResponse(message);
        addStopButton();
        isDebuggerActive = true;

        const submitButton = getElement('form-submit');
        if (submitButton) {
            submitButton.textContent = 'Debugging Active';
            submitButton.className = 'btn btn-success';
        }
    }

    function handleStartWarning(message) {
        updateDebuggerStatus("🟡 Debugger Status Unknown", "warning");
        updateResponse(`Warning: ${message}`);
        resetUIState();
    }

    function handleStartError(error) {
        updateDebuggerStatus("🔴 Debugger Failed", "error");
        updateResponse(`Error: ${error}`);
        resetUIState();
    }

    function handleStartTimeout() {
        currentOperation = null;
        updateDebuggerStatus("🔴 Start Timeout", "error");
        updateResponse("Start operation timed out. Please try again.");
        resetUIState();
    }

    // Listen for intercepted messages with error handling
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
            if (message.status === 'INTERCEPTED') {
                // Update the UI
                const outputElement = getElement('interception-counter');
                if (outputElement) {
                    outputElement.textContent = ++totalInterception;

                    // Add visual feedback
                    outputElement.style.transform = 'scale(1.1)';
                    setTimeout(() => {
                        outputElement.style.transform = 'scale(1)';
                    }, 200);
                }

                // Send a response back to the sender
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
            console.error('Error handling intercepted message:', error);
            sendResponse({ status: 'Error processing message' });
        }
    });

    // Handle debugger detachment with comprehensive error handling
    chrome.debugger.onDetach.addListener((source, reason) => {
        try {
            console.log(`Debugger detached from tab ID ${source.tabId}. Reason: ${reason}`);

            // Reset operation state
            currentOperation = null;
            isDebuggerActive = false;

            // Update UI based on reason
            if (reason === 'target_closed') {
                console.log('The target tab was closed.');
                updateDebuggerStatus("🔴 Tab Closed", "error");
                updateResponse("Debugger disconnected: Target tab was closed");
            } else if (reason === 'canceled_by_user') {
                console.log('The debugging session was manually detached by the user.');
                updateDebuggerStatus("🔴 Manually Detached", "error");
                updateResponse("Debugger disconnected: Manually detached by user");
            } else {
                console.log('Debugger detached for an unknown reason.');
                updateDebuggerStatus("🔴 Unexpected Disconnect", "error");
                updateResponse("Debugger disconnected: Unknown reason");
            }

            // Reset UI state
            resetUIState();
        } catch (error) {
            console.error('Error handling debugger detachment:', error);
            resetUIState();
        }
    });

    // Handle extension errors
    chrome.runtime.onSuspend.addListener(() => {
        console.log('Extension is being suspended');
        resetUIState();
        updateDebuggerStatus("🔴 Extension Suspended", "error");
    });

    // Initialize the page
    console.log("APQ Debugger DevTools panel initialized");

    // Check if debugger is already attached to this tab
    function checkDebuggerState() {
        chrome.runtime.sendMessage({ getStatus: true, tabId: inspectedTabId }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('Failed to get debugger status:', chrome.runtime.lastError);
                updateDebuggerStatus("🟢 Ready to Start", "success");
                updateResponse("Enter URL patterns and click 'Start Debugging' to begin");
                return;
            }

            if (response && response.status === "SUCCESS" && response.debuggerActive) {
                // Debugger is already active on this tab
                console.log("Debugger already active on tab:", inspectedTabId);
                handleStartSuccess("Debugger is already active on this tab");
            } else {
                // Debugger is not active
                updateDebuggerStatus("🟢 Ready to Start", "success");
                updateResponse("Enter URL patterns and click 'Start Debugging' to begin");
            }
        });
    }

    // Run initial state check
    checkDebuggerState();

    const initialInput = document.querySelector('.urlPattern');
    if (initialInput) {
        initialInput.addEventListener('input', savePatternsToStorage);
    }
    restorePatternsFromStorage();
});