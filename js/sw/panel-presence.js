/**
 * Tracks which tabs have a DevTools panel connected, via long-lived ports
 * named `${PANEL_PORT_PREFIX}${tabId}`. Requests are only held while a panel
 * for the tab is connected. In-memory only: after a service-worker restart the
 * panel reconnects, and requests that arrive before it does are not paused.
 * @module sw/panel-presence
 */

import { PANEL_PORT_PREFIX } from '../shared/constants.js';

/** @type {Map<number, number>} tabId -> number of connected panel ports */
const connections = new Map();

/**
 * Parse the tab id out of a panel port name.
 * @param {string} name - Port name.
 * @returns {number|null} The tab id, or null if this is not a panel port.
 */
function parsePortTabId(name) {
  if (typeof name !== 'string' || !name.startsWith(PANEL_PORT_PREFIX)) return null;
  const raw = name.slice(PANEL_PORT_PREFIX.length);
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Start tracking panel ports.
 * @param {(tabId: number) => void} onLastDisconnect - Called when the last
 *   panel port for a tab disconnects.
 * @returns {void}
 */
export function initPanelPresence(onLastDisconnect) {
  chrome.runtime.onConnect.addListener((port) => {
    const tabId = parsePortTabId(port && port.name);
    if (tabId === null) return;

    connections.set(tabId, (connections.get(tabId) || 0) + 1);

    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        // Disconnect reason is irrelevant — the panel is gone either way
      }
      const remaining = (connections.get(tabId) || 1) - 1;
      if (remaining > 0) {
        connections.set(tabId, remaining);
        return;
      }
      connections.delete(tabId);
      try {
        onLastDisconnect(tabId);
      } catch (error) {
        console.error('Panel disconnect handler failed:', error);
      }
    });
  });
}

/**
 * Whether a DevTools panel for the tab is currently connected.
 * @param {number} tabId - Tab ID.
 * @returns {boolean}
 */
export function isPanelConnected(tabId) {
  return (connections.get(tabId) || 0) > 0;
}
