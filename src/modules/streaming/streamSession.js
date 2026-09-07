import { app } from '../appContext.js';
import { displayResponseWithLineNumbersForTab } from '../apiHandler.js';
import { updateResponseSize, updateResponseTime, updateStatusDisplay } from '../statusDisplay.js';
import { debounce } from '../utils/debounce.js';

/** @returns {Promise<string|null>} */
export async function getActiveTabId() {
    return app.workspaceTabController
        ? app.workspaceTabController.service.getActiveTabId()
        : null;
}

/**
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
 * @param {string} eventName
 * @param {() => boolean} isBackendAvailable
 * @param {(event: object) => void} handler
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

const MAX_TRANSCRIPT_ENTRIES = 500;
const MAX_TRANSCRIPT_CHARS = 256 * 1024;

const PERSIST_DEBOUNCE_MS = 400;

const RENDER_COALESCE_MS = 80;

const ENTRY_SEPARATOR = '\n\n';

function timestamp() {
    return new Date().toLocaleTimeString();
}

function droppedNotice(count) {
    return count === 1
        ? '[1 earlier entry dropped]'
        : `[${count} earlier entries dropped]`;
}

export class StreamSession {
    /**
     * @param {object} [options]
     * @param {(entry: object, transcript: string, state: string) => (object|null)} [options.buildResponseMeta]
     */
    constructor({ buildResponseMeta = null } = {}) {
        this._entries = new Map();
        this._buffers = new Map();
        this._persisters = new Map();
        this._renderStates = new Map();
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
        this._buffers.delete(tabId);
        this._persisters.get(tabId)?.cancel();
        this._persisters.delete(tabId);
        const renderState = this._renderStates.get(tabId);
        if (renderState?.timer) {
            clearTimeout(renderState.timer);
        }
        this._renderStates.delete(tabId);
    }

    async updateStatus(tabId, text, status = null) {
        if (await isTabCurrentlyActive(tabId)) {
            updateStatusDisplay(text, status);
            updateResponseTime(null);
            updateResponseSize(null);
        }
    }

    /**
     * @param {string} tabId
     * @param {string} label
     * @param {string} [content]
     */
    async append(tabId, label, content = '') {
        const current = this.get(tabId) || {};
        const header = `[${timestamp()}] ${label}`;
        const line = content ? `${header}\n${content}` : header;

        const buffer = this._bufferFor(tabId, current);
        this._push(buffer, line);
        this._trim(buffer);

        const transcript = this._compose(buffer);
        this.set(tabId, { ...current, transcript });
        this._scheduleRender(tabId);
        this._schedulePersist(tabId);
    }

    /**
     * @param {string} tabId
     * @returns {void}
     */
    _scheduleRender(tabId) {
        const activeTabId = app.responseContainerManager?.activeTabId;
        if (activeTabId && activeTabId !== tabId) {
            return;
        }

        let state = this._renderStates.get(tabId);
        if (!state) {
            state = { timer: null, lastRenderedAt: 0 };
            this._renderStates.set(tabId, state);
        }

        if (state.timer) {
            return;
        }

        const elapsed = Date.now() - state.lastRenderedAt;
        if (elapsed >= RENDER_COALESCE_MS) {
            this._renderNow(tabId, state);
            return;
        }

        state.timer = setTimeout(() => {
            state.timer = null;
            this._renderNow(tabId, state);
        }, RENDER_COALESCE_MS - elapsed);
    }

    /**
     * @param {string} tabId
     * @param {{timer: (number|null), lastRenderedAt: number}} state
     * @returns {void}
     */
    _renderNow(tabId, state) {
        const entry = this.get(tabId);
        if (!entry) {
            return;
        }
        state.lastRenderedAt = Date.now();
        displayResponseWithLineNumbersForTab(entry.transcript || '', 'text/plain', tabId);
    }

    _bufferFor(tabId, current) {
        let buffer = this._buffers.get(tabId);
        if (!buffer || !current.transcript) {
            buffer = { sizes: [], dropped: 0, chars: 0, body: '' };
            this._buffers.set(tabId, buffer);
        }
        return buffer;
    }

    _push(buffer, line) {
        buffer.body = buffer.body ? buffer.body + ENTRY_SEPARATOR + line : line;
        buffer.sizes.push(line.length);
        buffer.chars += line.length + ENTRY_SEPARATOR.length;
    }

    _trim(buffer) {
        while (
            buffer.sizes.length > 1
            && (buffer.sizes.length > MAX_TRANSCRIPT_ENTRIES
                || buffer.chars > MAX_TRANSCRIPT_CHARS)
        ) {
            const size = buffer.sizes.shift();
            buffer.body = buffer.body.slice(size + ENTRY_SEPARATOR.length);
            buffer.chars -= size + ENTRY_SEPARATOR.length;
            buffer.dropped += 1;
        }
    }

    _compose(buffer) {
        return buffer.dropped > 0
            ? droppedNotice(buffer.dropped) + ENTRY_SEPARATOR + buffer.body
            : buffer.body;
    }

    _schedulePersist(tabId) {
        if (!this._buildResponseMeta || !tabId) {
            return;
        }
        let persist = this._persisters.get(tabId);
        if (!persist) {
            persist = debounce(() => this._persist(tabId), PERSIST_DEBOUNCE_MS);
            this._persisters.set(tabId, persist);
        }
        persist();
    }

    async _persist(tabId) {
        if (!this._buildResponseMeta || !app.workspaceTabController || !tabId) {
            return;
        }
        const entry = this.get(tabId);
        if (!entry) {
            return;
        }
        const response = this._buildResponseMeta(
            entry,
            entry.transcript || '',
            entry.state || 'closed'
        );
        if (!response) {
            return;
        }
        await app.workspaceTabController.service.updateTab(tabId, { response });
    }
}
