const attachedTabs = new Set();
const PATTERNS_STORAGE_KEY = 'apqPatterns';
const ATTACHED_TABS_STORAGE_KEY = 'apqAttachedTabs';
const ACTION_MENU_ID = 'apq-toggle-debugger';

function isDebuggerActive(tabId, callback) {
  // First check our internal state - this is authoritative for sessions WE attached
  if (attachedTabs.has(tabId)) {
    callback(true);
    return;
  }

  // Fallback: Check persistent storage for recovery after SW restart
  chrome.storage.local.get([ATTACHED_TABS_STORAGE_KEY], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to get stored tabs:', chrome.runtime.lastError);
      callback(false);
      return;
    }

    const storedTabs = Array.isArray(result[ATTACHED_TABS_STORAGE_KEY])
      ? result[ATTACHED_TABS_STORAGE_KEY]
      : [];

    if (!storedTabs.includes(tabId)) {
      // Not in our stored list, so not our session
      callback(false);
      return;
    }

    // Tab is in our stored list - verify it's still attached via Chrome API
    chrome.debugger.getTargets((targets) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to get debugger targets:', chrome.runtime.lastError);
        callback(false);
        return;
      }

      const target = targets.find(t => t.tabId === tabId && t.attached);

      if (target) {
        // Recover state: tab is in storage AND has debugger attached
        attachedTabs.add(tabId);
        console.log(`Recovered debugger session for tab ${tabId}`);
        callback(true);
      } else {
        // Tab in storage but no longer attached - clean up
        removeTabFromStorage(tabId);
        callback(false);
      }
    });
  });
}

// Helper to save attached tabs to storage
function saveTabToStorage(tabId) {
  chrome.storage.local.get([ATTACHED_TABS_STORAGE_KEY], (result) => {
    const storedTabs = Array.isArray(result[ATTACHED_TABS_STORAGE_KEY])
      ? result[ATTACHED_TABS_STORAGE_KEY]
      : [];

    if (!storedTabs.includes(tabId)) {
      storedTabs.push(tabId);
      chrome.storage.local.set({ [ATTACHED_TABS_STORAGE_KEY]: storedTabs });
    }
  });
}

// Helper to remove tab from storage
function removeTabFromStorage(tabId) {
  chrome.storage.local.get([ATTACHED_TABS_STORAGE_KEY], (result) => {
    const storedTabs = Array.isArray(result[ATTACHED_TABS_STORAGE_KEY])
      ? result[ATTACHED_TABS_STORAGE_KEY]
      : [];

    const index = storedTabs.indexOf(tabId);
    if (index > -1) {
      storedTabs.splice(index, 1);
      chrome.storage.local.set({ [ATTACHED_TABS_STORAGE_KEY]: storedTabs });
    }
  });
}

function validateUrlPattern(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Invalid URL pattern: must be a non-empty string');
  }

  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    throw new Error('Invalid URL pattern: cannot be empty');
  }

  if (trimmed.length > 1000) {
    throw new Error('Invalid URL pattern: too long (max 1000 characters)');
  }

  if (trimmed.includes('<script') || trimmed.includes('javascript:')) {
    throw new Error('Invalid URL pattern: contains potentially dangerous content');
  }

  return trimmed;
}

function getActiveTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      callback(null, "Failed to get current tab");
      return;
    }

    if (!tabs || tabs.length === 0) {
      callback(null, "No active tab found");
      return;
    }

    callback(tabs[0], null);
  });
}

// Get tab info by ID (for when tabId is explicitly provided)
function getTabById(tabId, callback) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      callback(null, `Failed to get tab ${tabId}: ${chrome.runtime.lastError.message}`);
      return;
    }
    callback(tab, null);
  });
}

function sendActionUpdate(payload, tabId) {
  chrome.runtime.sendMessage({ status: 'ACTION_TOGGLE', ...payload, tabId }, () => {
    if (chrome.runtime.lastError) {
      // It's common for this to fail if no DevTools or popup is listening, so we just warn
      // console.warn('Failed to notify DevTools:', chrome.runtime.lastError);
    }
  });
}

function attachDebuggerToTab(currentTab, validPatterns, callback) {
  if (!currentTab.url || !currentTab.url.startsWith('http')) {
    callback({ status: "ERROR", error: "Debugger can only be attached to HTTP/HTTPS pages" });
    return;
  }

  // Check actual debugger state, not just in-memory state
  isDebuggerActive(currentTab.id, (alreadyAttached) => {
    if (alreadyAttached) {
      callback({ status: "WARNING", message: "Debugger already attached to this tab" });
      return;
    }

    chrome.debugger.attach({ tabId: currentTab.id }, '1.3', () => {
      if (chrome.runtime.lastError) {
        console.error('Debugger attach failed:', chrome.runtime.lastError);
        let errorMessage = "Unknown error";
        if (chrome.runtime.lastError.message) {
          errorMessage = chrome.runtime.lastError.message;
        } else {
          try {
            errorMessage = JSON.stringify(chrome.runtime.lastError);
          } catch (e) {
            errorMessage = "Error object could not be stringified";
          }
        }
        callback({ status: "ERROR", error: "Failed to attach debugger: " + errorMessage });
        return;
      }

      chrome.debugger.sendCommand(
        { tabId: currentTab.id },
        "Fetch.enable",
        {
          patterns: validPatterns.map(pattern => ({
            urlPattern: pattern.urlPattern,
            requestStage: pattern.requestStage || "Request"
          }))
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error('Fetch.enable failed:', chrome.runtime.lastError);
            chrome.debugger.detach({ tabId: currentTab.id }, () => {
              callback({ status: "ERROR", error: "Failed to enable network interception" });
            });
            return;
          }

          attachedTabs.add(currentTab.id);
          saveTabToStorage(currentTab.id);  // Persist for SW restart recovery
          // Update badge to show debugger is ON for specific tab
          chrome.action.setBadgeText({ text: "ON", tabId: currentTab.id });
          chrome.action.setBadgeBackgroundColor({ color: "#5cb85c", tabId: currentTab.id });

          callback({
            status: "SUCCESS",
            message: `Network Interception enabled for logic`
          });
        }
      );
    });
  });
}

function detachDebuggerFromTab(detachTabId, callback) {
  // Check actual debugger state first
  isDebuggerActive(detachTabId, (isAttached) => {
    if (!isAttached) {
      // Clean up internal state, storage, and badge
      attachedTabs.delete(detachTabId);
      removeTabFromStorage(detachTabId);
      chrome.action.setBadgeText({ text: "OFF", tabId: detachTabId });
      chrome.action.setBadgeBackgroundColor({ color: "#d9534f", tabId: detachTabId });

      callback({
        status: "SUCCESS",
        message: "Debugger already detached"
      });
      return;
    }

    // Proceed with actual detach
    chrome.debugger.detach({ tabId: detachTabId }, () => {
      attachedTabs.delete(detachTabId);
      removeTabFromStorage(detachTabId);

      // Update badge to show debugger is OFF
      chrome.action.setBadgeText({ text: "OFF", tabId: detachTabId });
      chrome.action.setBadgeBackgroundColor({ color: "#d9534f", tabId: detachTabId });

      if (chrome.runtime.lastError) {
        console.error('Debugger detach failed:', chrome.runtime.lastError);

        let errorMessage = "Unknown error";
        if (chrome.runtime.lastError.message) {
          errorMessage = chrome.runtime.lastError.message;
        } else {
          try {
            errorMessage = JSON.stringify(chrome.runtime.lastError);
          } catch (e) {
            errorMessage = "Error object could not be stringified";
          }
        }

        // If the session is not found, it means we are effectively detached already.
        if (errorMessage.includes("Session not found") || errorMessage.includes("Detached") || errorMessage.includes("Debugger is not attached")) {
          console.log("Debugger already detached, treating as success.");
          callback({ status: "SUCCESS", message: "Debugger detached successfully (Session was already gone)" });
          return;
        }

        callback({ status: "ERROR", error: "Failed to detach debugger: " + errorMessage });
        return;
      }

      callback({ status: "SUCCESS", message: "Debugger detached successfully" });
    });
  });
}

function getStoredPatterns(callback) {
  chrome.storage.local.get([PATTERNS_STORAGE_KEY], (result) => {
    if (chrome.runtime.lastError) {
      callback(null, "Failed to load saved patterns");
      return;
    }

    const stored = Array.isArray(result[PATTERNS_STORAGE_KEY])
      ? result[PATTERNS_STORAGE_KEY]
      : [];

    callback(stored, null);
  });
}

function toggleDebuggerFromAction() {
  getActiveTab((currentTab, error) => {
    if (error) {
      // Can't set tab-specific badge if we don't have a tab, but we can try to send message
      sendActionUpdate({ active: false, error }, null);
      return;
    }

    // Use our internal state
    if (attachedTabs.has(currentTab.id)) {
      detachDebuggerFromTab(currentTab.id, (result) => {
        if (result.status === "SUCCESS") {
          sendActionUpdate({ active: false }, currentTab.id);
        } else {
          sendActionUpdate({ active: false, error: result.error || "Failed to detach debugger" }, currentTab.id);
        }
      });
      return;
    }

    // Otherwise, we are not attached. Try to attach.
    getStoredPatterns((storedPatterns, storageError) => {
      if (storageError) {
        sendActionUpdate({ active: false, error: storageError }, currentTab.id);
        return;
      }

      if (!storedPatterns || storedPatterns.length === 0) {
        const errorMsg = "No URL patterns configured. Please open DevTools > APQ Debugger to add patterns.";

        // Show system notification
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'APQ Debugger',
          message: errorMsg
        });

        // Set error badge
        chrome.action.setBadgeText({ text: "ERR", tabId: currentTab.id });
        chrome.action.setBadgeBackgroundColor({ color: "#f0ad4e", tabId: currentTab.id });

        sendActionUpdate({ active: false, error: errorMsg }, currentTab.id);
        return;
      }

      let validPatterns = [];
      try {
        validPatterns = storedPatterns.map((pattern) => ({
          urlPattern: validateUrlPattern(pattern),
          requestStage: "Request"
        }));
      } catch (validationError) {
        sendActionUpdate({ active: false, error: validationError.message }, currentTab.id);
        return;
      }

      attachDebuggerToTab(currentTab, validPatterns, (result) => {
        if (result.status === "SUCCESS") {
          sendActionUpdate({ active: true, message: result.message }, currentTab.id);
        } else {
          sendActionUpdate({ active: false, error: result.error || "Failed to attach debugger" }, currentTab.id);
          chrome.action.setBadgeText({ text: "ERR", tabId: currentTab.id });
          chrome.action.setBadgeBackgroundColor({ color: "#d9534f", tabId: currentTab.id });
        }
      });
    });
  });
}

async function digestMessage(message) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    console.error('Hash generation failed:', error);
    return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages that are internal broadcasts (like INTERCEPTED)
  if (message.status === 'INTERCEPTED' || message.status === 'ACTION_TOGGLE') {
    return false; // Don't process internal status messages
  }

  console.info('Received message:', message);

  try {
    if (message.patterns !== undefined && message.patterns.length > 0) {
      const validPatterns = [];
      const errors = [];

      for (const pattern of message.patterns) {
        try {
          if (!pattern || pattern.urlPattern === undefined) {
            throw new Error('Invalid pattern entry');
          }

          validPatterns.push({
            ...pattern,
            urlPattern: validateUrlPattern(pattern.urlPattern)
          });
        } catch (error) {
          errors.push(`Pattern "${pattern?.urlPattern || ''}": ${error.message}`);
        }
      }

      if (validPatterns.length === 0) {
        sendResponse({ status: "ERROR", error: "No valid URL patterns provided. " + errors.join('; ') });
        return true;
      }

      // Use tabId from message if provided (from DevTools panel), otherwise query active tab
      if (message.tabId !== undefined) {
        getTabById(message.tabId, (currentTab, error) => {
          if (error) {
            sendResponse({ status: "ERROR", error });
            return;
          }
          attachDebuggerToTab(currentTab, validPatterns, sendResponse);
        });
      } else {
        getActiveTab((currentTab, error) => {
          if (error) {
            sendResponse({ status: "ERROR", error });
            return;
          }
          attachDebuggerToTab(currentTab, validPatterns, sendResponse);
        });
      }
    } else if (message.disconnect !== undefined && message.disconnect === true) {
      // Use tabId from message if provided
      const targetTabId = message.tabId;

      if (targetTabId !== undefined) {
        // Always attempt detach - let detachDebuggerFromTab handle state checking
        console.log(`Detaching debugger session for tab id: ${targetTabId}`);
        detachDebuggerFromTab(targetTabId, sendResponse);
      } else {
        // If no specific tab ID (fallback logic, though normally DevTools sends tabId)
        getActiveTab((currentTab, error) => {
          if (!error && currentTab) {
            detachDebuggerFromTab(currentTab.id, sendResponse);
          } else {
            sendResponse({ status: "WARNING", message: "No tab specified" });
          }
        });
      }
    } else if (message.getStatus !== undefined && message.getStatus === true) {
      // Check if our extension has attached a debugger to the specified tab
      const queryTabId = message.tabId;
      if (queryTabId === undefined) {
        sendResponse({ status: "ERROR", error: "No tabId provided for status query" });
        return true;
      }

      // Use isDebuggerActive to get accurate state from Chrome API
      isDebuggerActive(queryTabId, (isActive) => {
        sendResponse({
          status: "SUCCESS",
          debuggerActive: isActive,
          tabId: queryTabId
        });
      });
    } else {
      sendResponse({ status: "ERROR", error: "Invalid message format or empty patterns" });
    }
  } catch (error) {
    console.error('Message handling error:', error);
    sendResponse({ status: "ERROR", error: "Internal error: " + error.message });
  }

  return true; // Keep message channel open for async response
});

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  try {
    if (method === 'Fetch.requestPaused') {
      console.info('Request paused:', params);

      if (!params.request || !params.request.hasPostData) {
        // Continue request without modification if no post data
        chrome.debugger.sendCommand(
          { tabId: source.tabId },
          "Fetch.continueRequest",
          { requestId: params.requestId }
        );
        return;
      }

      let reqBody;
      try {
        reqBody = JSON.parse(params.request.postData);
      } catch (parseError) {
        console.error('Failed to parse request data:', parseError);
        // Continue request without modification if parsing fails
        chrome.debugger.sendCommand(
          { tabId: source.tabId },
          "Fetch.continueRequest",
          { requestId: params.requestId }
        );
        return;
      }

      console.info('Parsed request body:', reqBody);

      try {
        const requestUrl = params.request.url || '';

        if (Array.isArray(reqBody)) {
          console.log("Request payload is an array");
          for (const req of reqBody) {
            await contaminatePayload(req, requestUrl, source.tabId);
          }
        } else {
          console.log("Request payload is a JSON element");
          await contaminatePayload(reqBody, requestUrl, source.tabId);
        }

        // Convert modified request back to base64
        const modifiedJson = JSON.stringify(reqBody);
        const encoder = new TextEncoder();
        const bytes = encoder.encode(modifiedJson);
        const base64Data = btoa(String.fromCharCode(...bytes));

        console.info(`Modified Request: ${modifiedJson}\nBase64: ${base64Data}`);
        console.info("Executing Fetch.continueRequest...");

        chrome.debugger.sendCommand(
          { tabId: source.tabId },
          "Fetch.continueRequest",
          {
            requestId: params.requestId,
            postData: base64Data
          },
          (error) => {
            if (chrome.runtime.lastError) {
              console.error('Fetch.continueRequest failed:', chrome.runtime.lastError);
            }
          }
        );
      } catch (processingError) {
        console.error('Error processing request:', processingError);
        // Continue request without modification if processing fails
        chrome.debugger.sendCommand(
          { tabId: source.tabId },
          "Fetch.continueRequest",
          { requestId: params.requestId }
        );
      }
    }
  } catch (error) {
    console.error('Debugger event handling error:', error);
  }
});

const contaminatePayload = async (payload, requestUrl, tabId) => {
  try {
    if (!payload || typeof payload !== 'object') {
      console.log('Invalid payload format:', payload);
      return;
    }

    if (payload.query === undefined && payload.extensions && payload.extensions.persistedQuery) {
      // APQ request without query - contaminate the hash
      const hash = await digestMessage('1234567890');
      if (hash) {
        payload.extensions.persistedQuery.sha256Hash = hash;
        console.info('Contaminated APQ request hash');
      } else {
        console.error('Failed to generate hash for payload');
      }
    } else if (payload.query !== undefined) {
      // Full query request - capture and send to DevTools
      console.log('Captured full query request:', payload.operationName);

      chrome.runtime.sendMessage({
        status: "INTERCEPTED",
        operationName: payload.operationName || 'Anonymous Query',
        url: requestUrl || '',
        query: payload.query || '',
        variables: payload.variables || null,
        isAPQ: false,
        tabId: tabId
      }, (response) => {
        if (chrome.runtime.lastError) {
          // This happens if the devtools panel for this tab isn't open, which is fine
          // console.error('Failed to send intercepted message:', chrome.runtime.lastError);
        } else {
          console.info('Request data sent to devtools:', response);
        }
      });
    } else {
      // Use try-catch for JSON.stringify to avoid stack overflow on circular references
      try {
        console.log('Payload does not contain query or APQ extensions:', JSON.stringify(payload));
      } catch (stringifyError) {
        console.log('Payload does not contain query or APQ extensions (could not stringify)');
      }
    }
  } catch (error) {
    console.error('Error in contaminatePayload:', error);
  }
};

// Handle debugger detachment events
chrome.debugger.onDetach.addListener((source, reason) => {
  console.log(`Debugger detached from tab ID ${source.tabId}. Reason: ${reason}`);

  // Clean up internal state and storage
  attachedTabs.delete(source.tabId);
  removeTabFromStorage(source.tabId);
  chrome.action.setBadgeText({ text: "OFF", tabId: source.tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#d9534f", tabId: source.tabId });

  // Additional actions when the debugger is disconnected
  if (reason === 'target_closed') {
    console.log('The target tab was closed.');
  } else if (reason === 'canceled_by_user') {
    console.log('The debugging session was manually detached by the user.');
  } else {
    console.log('Debugger detached for an unknown reason.');
  }
});

// State restoration function - uses persistent storage cross-referenced with Chrome API
function restoreDebuggerState() {
  chrome.storage.local.get([ATTACHED_TABS_STORAGE_KEY], (storageResult) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to get stored tabs:', chrome.runtime.lastError);
      return;
    }

    const storedTabs = Array.isArray(storageResult[ATTACHED_TABS_STORAGE_KEY])
      ? storageResult[ATTACHED_TABS_STORAGE_KEY]
      : [];

    if (storedTabs.length === 0) {
      console.log('No stored tabs to restore');
      attachedTabs.clear();
      return;
    }

    // Verify which stored tabs still have debuggers attached
    chrome.debugger.getTargets((targets) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to get debugger targets:', chrome.runtime.lastError);
        return;
      }

      attachedTabs.clear();
      const stillAttached = [];

      storedTabs.forEach(tabId => {
        const target = targets.find(t => t.tabId === tabId && t.attached);
        if (target) {
          // Tab is in storage AND has debugger attached - restore it
          attachedTabs.add(tabId);
          stillAttached.push(tabId);
          chrome.action.setBadgeText({ text: "ON", tabId: tabId });
          chrome.action.setBadgeBackgroundColor({ color: "#5cb85c", tabId: tabId });
        }
      });

      // Update storage to only contain still-attached tabs
      if (stillAttached.length !== storedTabs.length) {
        chrome.storage.local.set({ [ATTACHED_TABS_STORAGE_KEY]: stillAttached });
      }

      console.log('Restored debugger state for tabs:', stillAttached);
    });
  });
}

// Handle extension installation/update
chrome.runtime.onInstalled.addListener(() => {
  console.log('APQ Debugger service worker installed/updated');

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: ACTION_MENU_ID,
      title: 'Toggle APQ Debugger',
      contexts: ['action']
    });
  });

  // Restore state after installation/update
  restoreDebuggerState();
});

// Handle service worker startup
chrome.runtime.onStartup.addListener(() => {
  console.log('APQ Debugger service worker starting up');
  restoreDebuggerState();
});

chrome.action.onClicked.addListener(() => {
  toggleDebuggerFromAction();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === ACTION_MENU_ID) {
    toggleDebuggerFromAction();
  }
});

// Handle tab updates (navigation) - restore badge state if tab is still tracked
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only care about completed page loads
  if (changeInfo.status !== 'complete') {
    return;
  }

  // Check if this tab is in our storage (we might have lost internal state)
  chrome.storage.local.get([ATTACHED_TABS_STORAGE_KEY], (result) => {
    if (chrome.runtime.lastError) {
      return;
    }

    const storedTabs = Array.isArray(result[ATTACHED_TABS_STORAGE_KEY])
      ? result[ATTACHED_TABS_STORAGE_KEY]
      : [];

    if (storedTabs.includes(tabId)) {
      // Tab is in our storage - check if debugger is still attached
      chrome.debugger.getTargets((targets) => {
        if (chrome.runtime.lastError) {
          return;
        }

        const target = targets.find(t => t.tabId === tabId && t.attached);
        if (target) {
          // Debugger still attached - restore badge
          attachedTabs.add(tabId);
          chrome.action.setBadgeText({ text: "ON", tabId: tabId });
          chrome.action.setBadgeBackgroundColor({ color: "#5cb85c", tabId: tabId });
          console.log(`Restored badge for tab ${tabId} after navigation`);
        } else {
          // Debugger no longer attached - clean up storage
          removeTabFromStorage(tabId);
          attachedTabs.delete(tabId);
        }
      });
    }
  });
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    attachedTabs,
    validateUrlPattern,
    isDebuggerActive,
    contaminatePayload,
    digestMessage
  };
}