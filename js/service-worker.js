let debuggerAttached = false;
let tabId;
const PATTERNS_STORAGE_KEY = 'apqPatterns';
const ACTION_MENU_ID = 'apq-toggle-debugger';

function isAttached(value, tab) {
  debuggerAttached = value;
  tabId = tab;
}

function isDebuggerActive(tabId, callback) {
  chrome.debugger.getTargets((targets) => {
    const isActive = targets.some(target => target.tabId === tabId && target.attached);
    callback(isActive);
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

function sendActionUpdate(payload) {
  chrome.runtime.sendMessage({ status: 'ACTION_TOGGLE', ...payload }, () => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to notify DevTools:', chrome.runtime.lastError);
    }
  });
}

function attachDebuggerToTab(currentTab, validPatterns, callback) {
  if (!currentTab.url || !currentTab.url.startsWith('http')) {
    callback({ status: "ERROR", error: "Debugger can only be attached to HTTP/HTTPS pages" });
    return;
  }

  if (debuggerAttached && tabId === currentTab.id) {
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

        isAttached(true, currentTab.id);
        // Update badge to show debugger is ON
        chrome.action.setBadgeText({ text: "ON" });
        chrome.action.setBadgeBackgroundColor({ color: "#5cb85c" });
        callback({
          status: "SUCCESS",
          message: `Network Interception enabled for the following patterns:\n${validPatterns.map((pattern) => pattern.urlPattern).join('\n')}`
        });
      }
    );
  });
}

function detachDebuggerFromTab(detachTabId, callback) {
  chrome.debugger.detach({ tabId: detachTabId }, () => {
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

      // Force cleanup even on error - if we failed to detach, we're likely already detached or broken
      isAttached(false, undefined);

      // If the session is not found, it means we are effectively detached already.
      if (errorMessage.includes("Session not found") || errorMessage.includes("Detached") || errorMessage.includes("Debugger is not attached")) {
        console.log("Debugger already detached, treating as success.");
        // Update badge to show debugger is OFF
        chrome.action.setBadgeText({ text: "OFF" });
        chrome.action.setBadgeBackgroundColor({ color: "#d9534f" });
        callback({ status: "SUCCESS", message: "Debugger detached successfully (Session was already gone)" });
        return;
      }

      callback({ status: "ERROR", error: "Failed to detach debugger: " + errorMessage });
      return;
    }
    isAttached(false, undefined);
    // Update badge to show debugger is OFF
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#d9534f" });
    callback({ status: "SUCCESS", message: "Debugger detached successfully" });
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
      sendActionUpdate({ active: false, error });
      return;
    }

    // Use our internal state first for a consistent experience.
    // If we think we are attached, try to detach from the stored tabId.
    if (debuggerAttached && tabId !== undefined) {
      detachDebuggerFromTab(tabId, (result) => {
        if (result.status === "SUCCESS") {
          sendActionUpdate({ active: false });
          chrome.action.setBadgeText({ text: "OFF" });
          chrome.action.setBadgeBackgroundColor({ color: "#d9534f" });
        } else {
          // Even if it failed, our internal state should be cleared by detachDebuggerFromTab
          sendActionUpdate({ active: false, error: result.error || "Failed to detach debugger" });
          chrome.action.setBadgeText({ text: "OFF" });
          chrome.action.setBadgeBackgroundColor({ color: "#d9534f" });
        }
      });
      return;
    }

    // Otherwise, we are not attached (according to our state). Try to attach.
    getStoredPatterns((storedPatterns, storageError) => {
      if (storageError) {
        sendActionUpdate({ active: false, error: storageError });
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
        chrome.action.setBadgeText({ text: "ERR" });
        chrome.action.setBadgeBackgroundColor({ color: "#f0ad4e" });

        sendActionUpdate({ active: false, error: errorMsg });
        return;
      }

      let validPatterns = [];
      try {
        validPatterns = storedPatterns.map((pattern) => ({
          urlPattern: validateUrlPattern(pattern),
          requestStage: "Request"
        }));
      } catch (validationError) {
        sendActionUpdate({ active: false, error: validationError.message });
        return;
      }

      attachDebuggerToTab(currentTab, validPatterns, (result) => {
        if (result.status === "SUCCESS") {
          sendActionUpdate({ active: true, message: result.message });
          chrome.action.setBadgeText({ text: "ON" });
          chrome.action.setBadgeBackgroundColor({ color: "#5cb85c" });
        } else {
          sendActionUpdate({ active: false, error: result.error || "Failed to attach debugger" });
          chrome.action.setBadgeText({ text: "ERR" });
          chrome.action.setBadgeBackgroundColor({ color: "#d9534f" });
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
      // Use tabId from message if provided, otherwise use stored tabId
      const targetTabId = message.tabId !== undefined ? message.tabId : tabId;

      if (targetTabId !== undefined && (debuggerAttached || message.tabId !== undefined)) {
        console.log(`Detaching debugger session for tab id: ${targetTabId}`);
        detachDebuggerFromTab(targetTabId, sendResponse);
      } else {
        sendResponse({ status: "WARNING", message: "No active debugger session to detach" });
      }
    } else if (message.getStatus !== undefined && message.getStatus === true) {
      // Check if our extension has attached a debugger to the specified tab
      const queryTabId = message.tabId;
      if (queryTabId === undefined) {
        sendResponse({ status: "ERROR", error: "No tabId provided for status query" });
        return true;
      }

      // Use internal state to check if WE attached a debugger to this tab
      // chrome.debugger.getTargets() would return true when DevTools is open,
      // which is not what we want - we only want to know if our extension attached
      const isActive = debuggerAttached && tabId === queryTabId;
      sendResponse({
        status: "SUCCESS",
        debuggerActive: isActive,
        tabId: queryTabId
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
        if (Array.isArray(reqBody)) {
          console.log("Request payload is an array");
          for (const req of reqBody) {
            await contaminatePayload(req);
          }
        } else {
          console.log("Request payload is a JSON element");
          await contaminatePayload(reqBody);
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

const contaminatePayload = async (payload) => {
  try {
    if (!payload || typeof payload !== 'object') {
      console.log('Invalid payload format:', payload);
      return;
    }

    if (payload.query === undefined && payload.extensions && payload.extensions.persistedQuery) {
      const hash = await digestMessage('1234567890');
      if (hash) {
        payload.extensions.persistedQuery.sha256Hash = hash;

        chrome.runtime.sendMessage({ status: "INTERCEPTED" }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Failed to send intercepted message:', chrome.runtime.lastError);
          } else {
            console.info('Response sent to devtools:', response);
          }
        });
      } else {
        console.error('Failed to generate hash for payload');
      }
    } else {
      console.log(`Payload does not contain APQ extensions:`, JSON.stringify(payload));
    }
  } catch (error) {
    console.error('Error in contaminatePayload:', error);
  }
};

// Handle debugger detachment events
chrome.debugger.onDetach.addListener((source, reason) => {
  console.log(`Debugger detached from tab ID ${source.tabId}. Reason: ${reason}`);

  if (source.tabId === tabId) {
    isAttached(false, undefined);
  }

  // Additional actions when the debugger is disconnected
  if (reason === 'target_closed') {
    console.log('The target tab was closed.');
  } else if (reason === 'canceled_by_user') {
    console.log('The debugging session was manually detached by the user.');
  } else {
    console.log('Debugger detached for an unknown reason.');
  }
});

// Handle extension installation/update
chrome.runtime.onInstalled.addListener(() => {
  console.log('APQ Debugger service worker installed/updated');
  // Reset state
  debuggerAttached = false;
  tabId = undefined;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: ACTION_MENU_ID,
      title: 'Toggle APQ Debugger',
      contexts: ['action']
    });
  });
});

chrome.action.onClicked.addListener(() => {
  toggleDebuggerFromAction();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === ACTION_MENU_ID) {
    toggleDebuggerFromAction();
  }
});