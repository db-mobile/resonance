import { app } from '../appContext.js';

/**
 * Builds the protocol-specific URL bars (gRPC, WebSocket, SSE, GraphQL, MQTT)
 * that replace the HTTP method select + URL input while a non-HTTP request mode
 * is active. Each one is a "mirror": it owns the visible input, while the
 * hidden peer input (usually `#url-input`) stays authoritative for everything
 * downstream — tab persistence, the query-params table, autocomplete.
 *
 * Keeping the two in sync is the whole job, and it has to work in both
 * directions:
 *
 * - mirror -> peer: assigning `peer.value` fires no `input` event, so listeners
 *   bound to the peer never run. Modes whose URL can carry a query string
 *   dispatch a real `input` event instead, which drives
 *   `updateQueryParamsFromUrl` and the tab-modified marker.
 * - peer -> mirror: code that rewrites the peer's value directly (the
 *   query-params table, collection loads) dispatches `URL_UPDATED_EVENT`, since
 *   a plain assignment is likewise invisible.
 */

/**
 * Event name dispatched on a peer input after its value is written directly,
 * so mirrored URL sections can pick the change up.
 */
export const URL_UPDATED_EVENT = 'url-updated';

/**
 * Notify any mirrored URL section that a peer input's value was replaced
 * programmatically.
 * @param {HTMLInputElement|null} peerInput
 */
export function notifyUrlUpdated(peerInput) {
    peerInput?.dispatchEvent(new CustomEvent(URL_UPDATED_EVENT));
}

function markTabModified() {
    if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
        app.workspaceTabController.markCurrentTabModified();
    }
}

/**
 * Create a protocol URL section and insert it after the method select.
 * @param {object} config
 * @param {string} config.sectionId - id for the wrapper element.
 * @param {string} config.method - `data-method` on the badge (drives its colour).
 * @param {string} config.label - badge text.
 * @param {string} config.inputId - id for the visible mirror input.
 * @param {string} config.inputType - `type` attribute for the mirror input.
 * @param {string} config.placeholder
 * @param {string} config.ariaLabel
 * @param {string} config.peerId - id of the hidden input this mirrors.
 * @param {boolean} [config.syncQueryParams] - when true, edits dispatch an
 *   `input` event on the peer so the query-params table follows along. Off for
 *   targets that are not query-bearing URLs (gRPC targets, MQTT brokers).
 * @returns {HTMLElement|null} the section, or null when the request URL bar is absent.
 */
export function createMirroredUrlSection({
    sectionId,
    method,
    label,
    inputId,
    inputType,
    placeholder,
    ariaLabel,
    peerId,
    syncQueryParams = false
}) {
    const requestUrlSection = document.querySelector('.request-url-section');
    if (!requestUrlSection) {
        return null;
    }

    const section = document.createElement('div');
    section.id = sectionId;
    section.className = 'grpc-url-section';
    section.style.display = 'none';

    const badge = document.createElement('span');
    badge.className = 'method-pill';
    badge.dataset.method = method;
    badge.textContent = label;

    const targetWrapper = document.createElement('div');
    targetWrapper.className = 'grpc-target-wrapper';

    const mirrorInput = document.createElement('input');
    mirrorInput.type = inputType;
    mirrorInput.id = inputId;
    mirrorInput.className = 'input-base url-input';
    mirrorInput.placeholder = placeholder;
    mirrorInput.setAttribute('aria-label', ariaLabel);

    const peerInput = document.getElementById(peerId);
    if (peerInput) {
        mirrorInput.value = peerInput.value;

        mirrorInput.addEventListener('input', () => {
            peerInput.value = mirrorInput.value;
            if (syncQueryParams) {
                peerInput.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
            markTabModified();
        });

        const copyFromPeer = () => {
            if (mirrorInput.value !== peerInput.value) {
                mirrorInput.value = peerInput.value;
            }
        };
        peerInput.addEventListener('input', copyFromPeer);
        peerInput.addEventListener(URL_UPDATED_EVENT, copyFromPeer);
    }

    targetWrapper.appendChild(mirrorInput);
    section.appendChild(badge);
    section.appendChild(targetWrapper);

    const methodSelectContainer = document.querySelector('.method-select-container');
    if (methodSelectContainer) {
        methodSelectContainer.after(section);
    } else {
        requestUrlSection.prepend(section);
    }

    return section;
}

/**
 * Copy the peer's current value into the mirror, used when a section is shown.
 * @param {string} inputId
 * @param {string} peerId
 */
export function syncMirroredUrlInput(inputId, peerId) {
    const peerInput = document.getElementById(peerId);
    const mirrorInput = document.getElementById(inputId);

    if (peerInput && mirrorInput) {
        mirrorInput.value = peerInput.value;
    }
}
