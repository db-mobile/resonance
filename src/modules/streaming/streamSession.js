import { app } from '../appContext.js';
import { displayResponseWithLineNumbersForTab } from '../apiHandler.js';
import { updateResponseSize, updateResponseTime, updateStatusDisplay } from '../statusDisplay.js';

/**
 * Shared scaffolding for the streaming-protocol handlers (WebSocket, SSE, MQTT,
 * and gRPC streaming). Each protocol keeps its own backend event handling and
 * connect/cancel logic; this module owns the parts that were previously
 * copy-pasted across all four: per-tab session state, transcript building,
 * active-tab guarded status updates, and the Tauri event-listener bootstrap.
 */

/** @returns {Promise<string|null>} the active workspace tab id, if known. */
export async function getActiveTabId() {
    return app.workspaceTabController
        ? app.workspaceTabController.service.getActiveTabId()
        : null;
}

/**
 * True when the given tab is the one currently shown, so it is safe to write to
 * the shared response DOM. Treated as active when no tab controller is present
 * (e.g. in tests or before the workspace is wired up).
 * @param {string} tabId
 * @returns {Promise<boolean>}
 */
export async function isTabCurrentlyActive(tabId) {
    if (!tabId || !app.workspaceTabController) {
        return true;
    }
    const activeTabId = await app.workspaceTabController.service.getActiveTabId();
    return activeTabId === tabId;
}

/**
 * Build a memoized initializer that subscribes to a backend Tauri event exactly
 * once. Returns a no-op (resolved) promise when running outside Tauri or when
 * the backend for this protocol is unavailable.
 * @param {string} eventName - Tauri event name to listen for.
 * @param {() => boolean} isBackendAvailable - guard; skip when the backend is absent.
 * @param {(event: object) => void} handler - backend event handler.
 * @returns {() => Promise<void>}
 */
export function createBackendEventListener(eventName, isBackendAvailable, handler) {
    let listenerPromise = null;
    return () => {
        if (listenerPromise) {
            return listenerPromise;
        }
        listenerPromise = (async () => {
            if (!('__TAURI_INTERNALS__' in window) || !isBackendAvailable()) {
                return;
            }
            const { invoke, transformCallback } = window.__TAURI_INTERNALS__;
            await invoke('plugin:event|listen', {
                event: eventName,
                target: { kind: 'Any' },
                handler: transformCallback(handler)
            });
        })();
        return listenerPromise;
    };
}

function timestamp() {
    return new Date().toLocaleTimeString();
}

/**
 * Per-tab transcript session shared by the streaming handlers. Holds the live
 * connection state for each tab and renders/persists a running transcript.
 */
export class StreamSession {
    /**
     * @param {object} [options]
     * @param {(entry: object, transcript: string, state: string) => (object|null)} [options.buildResponseMeta]
     *   Maps a tab's session entry to the protocol-specific `response` object to
     *   persist on the tab. Return null (or omit the option) to skip persistence
     *   — gRPC streaming, for example, never persists its transcript.
     */
    constructor({ buildResponseMeta = null } = {}) {
        this._entries = new Map();
        this._buildResponseMeta = buildResponseMeta;
    }

    get(tabId) {
        return this._entries.get(tabId) || null;
    }

    set(tabId, entry) {
        this._entries.set(tabId, entry);
    }

    remove(tabId) {
        this._entries.delete(tabId);
    }

    /**
     * Update the global status display, but only while the owning tab is active.
     */
    async updateStatus(tabId, text, status = null) {
        if (await isTabCurrentlyActive(tabId)) {
            updateStatusDisplay(text, status);
            updateResponseTime(null);
            updateResponseSize(null);
        }
    }

    /**
     * Append a timestamped line to the tab's transcript, render it to the shared
     * response view, and persist it (when a `buildResponseMeta` was provided).
     * @param {string} tabId
     * @param {string} label - line header (e.g. 'RECEIVED', 'CONNECTED ws://...').
     * @param {string} [content] - optional body shown on the next line.
     */
    async append(tabId, label, content = '') {
        const current = this.get(tabId) || {};
        const header = `[${timestamp()}] ${label}`;
        const line = content ? `${header}\n${content}` : header;
        const existing = current.transcript || '';
        const transcript = existing ? `${existing}\n\n${line}` : line;

        this.set(tabId, { ...current, transcript });
        displayResponseWithLineNumbersForTab(transcript, 'text/plain', tabId);
        await this._persist(tabId, transcript);
    }

    async _persist(tabId, transcript) {
        if (!this._buildResponseMeta || !app.workspaceTabController || !tabId) {
            return;
        }
        const entry = this.get(tabId) || {};
        const response = this._buildResponseMeta(entry, transcript, entry.state || 'closed');
        if (!response) {
            return;
        }
        await app.workspaceTabController.service.updateTab(tabId, { response });
    }
}
