/**
 * @fileoverview The request-bar / tab-nav / body-panel markup shared by the
 * @module tests/helpers/requestBarMarkup
 */

/** @type {Array<[string, string]>} */
export const ALL_BODY_MODES = [
    ['json', 'JSON'],
    ['formdata', 'Form Data'],
    ['urlencoded', 'URL Encoded'],
    ['text', 'Text'],
    ['binary', 'Binary File']
];

/** @type {string[]} */
export const ALL_REQUEST_TABS = [
    'path-params',
    'query-params',
    'headers',
    'body',
    'grpc',
    'grpc-message',
    'grpc-metadata',
    'mqtt',
    'scripts',
    'authorization',
    'schema'
];

const RESPONSE_TABS = [
    ['response-body', null],
    ['response-headers', 'http'],
    ['response-metadata', 'grpc'],
    ['response-cookies', 'http'],
    ['response-trailers', 'grpc'],
    ['response-performance', 'http'],
    ['response-scripts', 'http']
];

function requestTabButtons() {
    return ALL_REQUEST_TABS
        .map((tab, index) => `<button class="tab-button view-switcher-btn${index === 0 ? ' active' : ''}"
                data-tab="${tab}" role="tab" aria-selected="${index === 0}"></button>`)
        .join('\n');
}

function requestTabPanels() {
    return ALL_REQUEST_TABS
        .filter(tab => tab !== 'body')
        .map((tab, index) => `<div class="tab-content${index === 0 ? ' active' : ''}" id="${tab}" role="tabpanel"></div>`)
        .join('\n');
}

function responseTabButtons() {
    return RESPONSE_TABS
        .map(([tab, protocol], index) => `<button class="tab-button view-switcher-btn${index === 0 ? ' active' : ''}"
                data-tab="${tab}"${protocol ? ` data-protocol="${protocol}"` : ''}
                role="tab" aria-selected="${index === 0}"></button>`)
        .join('\n');
}

function bodyModePanels() {
    return ALL_BODY_MODES
        .map(([mode], index) => `<div class="body-mode-panel${index === 0 ? ' active' : ''}" data-mode="${mode}"></div>`)
        .concat('<div class="body-mode-panel" data-mode="graphql"></div>')
        .join('\n');
}

function bodyModeOptions() {
    return ALL_BODY_MODES
        .map(([value, text]) => `<option value="${value}">${text}</option>`)
        .join('\n');
}

/** @returns {string} */
export function requestBarMarkup() {
    return `
        <section class="request-builder">
            <div class="request-url-section">
                <div class="method-select-container select-wrap">
                    <select id="method-select" class="select-base method-select" aria-label="HTTP Method">
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                        <option value="PATCH">PATCH</option>
                    </select>
                </div>
                <div id="grpc-url-section" class="grpc-url-section" style="display: none;">
                    <span class="method-pill" data-method="GRPC">gRPC</span>
                    <div class="grpc-target-wrapper">
                        <input type="text" id="grpc-target-input" class="entry url-input monospace"
                               placeholder="localhost:50051" aria-label="gRPC Target">
                    </div>
                </div>
                <div class="url-autocomplete-wrapper">
                    <input type="url" id="url-input" class="entry url-input monospace" aria-label="API URL">
                </div>
                <button id="send-request-btn" class="button"></button>
                <button id="cancel-request-btn" class="button" style="display: none;"></button>
                <button id="curl-btn" class="button flat image-button"></button>
            </div>
        </section>

        <section class="request-config">
            <nav class="tab-nav view-switcher flat" role="tablist">
                ${requestTabButtons()}
            </nav>
            ${requestTabPanels()}
            <div class="tab-content" id="body" role="tabpanel">
                <div class="body-header u-flex u-items-center u-justify-between">
                    <span class="heading" data-i18n="tabs.body">Body</span>
                    <div class="body-mode-selector-container select-wrap">
                        <select id="body-mode-select" class="select-base compact body-mode-select"
                                aria-label="Body Mode">
                            ${bodyModeOptions()}
                        </select>
                    </div>
                </div>
                ${bodyModePanels()}
            </div>
        </section>

        <div class="response-display">
            <div class="response-content u-flex u-flex-col">
                <nav class="response-tabs tab-nav view-switcher flat" role="tablist">
                    ${responseTabButtons()}
                </nav>
            </div>
        </div>
    `;
}

/** @returns {string} */
export function requestFormMarkup() {
    return `
        <div id="path-params-list"></div>
        <div id="query-params-list"></div>
        <div id="headers-list"></div>
        <select id="auth-type-select"><option value="none">None</option></select>
        <div id="auth-fields-container"></div>

        <input id="mqtt-client-id-input">
        <input id="mqtt-username-input">
        <input id="mqtt-password-input">
        <input id="mqtt-subscribe-input">
        <input id="mqtt-topic-input">
        <select id="mqtt-qos-select">
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
        </select>

        <div id="response-body-container"></div>
        <div id="response-headers-display"></div>
        <div id="response-cookies-display"></div>
        <span id="status-display"></span>
        <span id="response-time-display"></span>
        <span id="response-size-display"></span>
    `;
}
