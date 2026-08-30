import { app } from '../appContext.js';
import { displayResponseWithLineNumbersForTab } from '../apiHandler.js';
import { updateResponseSize, updateResponseTime, updateStatusDisplay } from '../statusDisplay.js';
import { debounce } from '../utils/debounce.js';

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

/**
 * A transcript is a debugging view of a live stream, not a log file: a chatty
 * endpoint would otherwise grow it without limit, and since every event
 * re-renders and re-persists the whole thing, the cost per event would grow
 * with the transcript. The oldest entries are dropped once either bound is hit.
 */
const MAX_TRANSCRIPT_ENTRIES = 500;
const MAX_TRANSCRIPT_CHARS = 256 * 1024;

/**
 * Persisting on every event turns a fast stream into a write storm against the
 * tab store. Only the last write in a burst matters, so coalesce them.
 */
const PERSIST_DEBOUNCE_MS = 400;

/**
 * Rendering rebuilds the entire editor state, so a fast stream renders at most
 * once per interval: immediately when idle, then trailing for the burst.
 */
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
        // The tab is gone; a queued write would target a tab that no longer exists.
        this._persisters.get(tabId)?.cancel();
        this._persisters.delete(tabId);
        const renderState = this._renderStates.get(tabId);
        if (renderState?.timer) {
            clearTimeout(renderState.timer);
        }
        this._renderStates.delete(tabId);
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

        const buffer = this._bufferFor(tabId, current);
        this._push(buffer, line);
        this._trim(buffer);

        const transcript = this._compose(buffer);
        this.set(tabId, { ...current, transcript });
        this._scheduleRender(tabId);
        this._schedulePersist(tabId);
    }

    /**
     * Renders the tab's latest transcript at most once per coalesce interval, skipping hidden tabs entirely.
     * @private
     * @param {string} tabId - Tab whose transcript changed
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
     * Renders the tab's current transcript into the response view.
     * @private
     * @param {string} tabId - Tab to render
     * @param {{timer: (number|null), lastRenderedAt: number}} state - Render state to stamp
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

    /**
     * The entry buffer backing a tab's transcript. Handlers reset a transcript
     * by setting it to `''` when a new connection starts, so an empty
     * transcript means the buffer is stale and starts again.
     */
    _bufferFor(tabId, current) {
        let buffer = this._buffers.get(tabId);
        if (!buffer || !current.transcript) {
            buffer = { sizes: [], dropped: 0, chars: 0, body: '' };
            this._buffers.set(tabId, buffer);
        }
        return buffer;
    }

    /**
     * The composed body is maintained incrementally rather than re-joined from
     * the entries on every event: at steady state each append drops one entry
     * and adds one, so a rebuild would cost the full cap per event. Only entry
     * *sizes* are kept, which is all trimming needs.
     */
    _push(buffer, line) {
        buffer.body = buffer.body ? buffer.body + ENTRY_SEPARATOR + line : line;
        buffer.sizes.push(line.length);
        buffer.chars += line.length + ENTRY_SEPARATOR.length;
    }

    /**
     * Drop oldest entries until both bounds hold. The newest entry is always
     * kept, however large it is — truncating an event's body would misrepresent
     * what the server actually sent.
     */
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
