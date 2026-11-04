/**
 * Long-lived port that tells the service worker a panel is open for this
 * tab. Requests are only held while the port is connected, so it is
 * reopened whenever it drops (for example when the service worker restarts).
 * @module ui/panel-port
 */

import { PANEL_PORT_PREFIX } from '../shared/constants.js';

/** Delay before reopening a dropped port. */
const RECONNECT_DELAY_MS = 500;

/**
 * Connect the panel port for a tab and keep it connected.
 * @param {number} tabId - Inspected tab ID.
 */
export function connectPanelPort(tabId) {
  let port;
  try {
    port = chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${tabId}` });
  } catch (error) {
    // The extension was reloaded or removed; this panel can no longer connect.
    console.warn('Failed to connect panel port:', error);
    return;
  }

  port.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
      // Expected when the service worker stops; reconnecting below
    }
    setTimeout(() => connectPanelPort(tabId), RECONNECT_DELAY_MS);
  });
}
