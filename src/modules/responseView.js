/**
 * @fileoverview Response pane rendering shared by every protocol handler: body editor, schema and GraphQL badges
 * @module responseView
 */

import { responseBodyContainer, responseHeadersDisplay, responseCookiesDisplay, responsePerformanceDisplay, languageSelector } from './domElements.js';
import { createLazyEditorProxy } from './editorLoader.js';
import { responseContainerFor } from './ResponseDisplayHelper.js';

let responseEditor = null;

export function globalResponseElements() {
    return {
        headersDisplay: responseHeadersDisplay,
        cookiesDisplay: responseCookiesDisplay,
        performanceDisplay: responsePerformanceDisplay
    };
}

function initResponseEditor() {
    if (!responseEditor && responseBodyContainer) {
        responseEditor = createLazyEditorProxy('response', responseBodyContainer);

        responseEditor.onLanguageChange((languageType) => {
            if (languageSelector) {
                languageSelector.value = languageType || 'text';
            }
        });

        if (languageSelector) {
            languageSelector.addEventListener('change', (e) => {
                const selectedLanguage = e.target.value;
                responseEditor.setLanguage(selectedLanguage);
            });
        }
    }
}

/**
 * @param {string|null} tabId
 * @returns {HTMLElement|null}
 */
function statusContainerFor(tabId) {
    return responseContainerFor(tabId)?.statusContainer || document.querySelector('.status-info-container');
}

/** @param {string|null} tabId */
export function clearSchemaValidationBadge(tabId = null) {
    const statusContainer = statusContainerFor(tabId);
    if (!statusContainer) {
        return;
    }

    const existingBadge = statusContainer.querySelector('.response-validation-badge');
    if (existingBadge) {
        existingBadge.remove();
    }
}

/**
 * @param {Object} validationResult
 * @param {string|null} tabId
 */
export function displaySchemaValidationResult(validationResult, tabId = null) {
    clearSchemaValidationBadge(tabId);

    if (!validationResult.hasSchema) {
        return;
    }

    const statusContainer = statusContainerFor(tabId);
    if (!statusContainer) {
        return;
    }

    const badge = document.createElement('span');
    badge.className = `status-badge response-validation-badge ${validationResult.valid ? 'is-success' : 'is-error'}`;
    badge.textContent = validationResult.valid ? 'Schema Valid' :
        validationResult.errors.some(error => error.keyword === 'backend') ? 'Schema validation unavailable' :
            validationResult.schemaValid === false ? 'Invalid JSON Schema' : `Schema Invalid (${validationResult.errors.length})`;

    if (!validationResult.valid && validationResult.errors.length > 0) {
        badge.title = validationResult.errors.map(e => `${e.path}: ${e.message}`).join('\n');
    }

    statusContainer.appendChild(badge);
}

/** @param {string|null} tabId */
export function clearGraphQLErrorsBadge(tabId = null) {
    const statusContainer = statusContainerFor(tabId);
    const existingBadge = statusContainer?.querySelector('.graphql-errors-badge');
    if (existingBadge) {
        existingBadge.remove();
    }
}


/**
 * @param {Array} errors
 * @param {string|null} tabId
 */
export function renderGraphQLErrorsBadge(errors, tabId = null) {
    const statusContainer = statusContainerFor(tabId);
    if (!statusContainer) {
        return;
    }

    const badge = document.createElement('span');
    badge.className = 'status-badge graphql-errors-badge is-error';
    badge.textContent = `GraphQL Errors (${errors.length})`;
    badge.title = errors
        .map(e => (e && typeof e.message === 'string') ? e.message : JSON.stringify(e))
        .join('\n');

    statusContainer.appendChild(badge);
}

export function displayResponseWithLineNumbersForTab(content, contentType = null, tabId = null, languageHint = undefined) {
    const containerElements = responseContainerFor(tabId);

    if (containerElements && containerElements.editor) {
        containerElements.renderedResponse = null;
        containerElements.inspection?.setSource(null);
        containerElements.editor.setContent(content, contentType, languageHint);

        if (containerElements.previewManager && containerElements.tabId) {
            const language = containerElements.editor.currentLanguage;

            containerElements.previewManager.updateButtonState(containerElements.tabId, language);

            if (containerElements.previewManager.isPreviewable(language)) {
                containerElements.previewManager.refreshPreviewContent(containerElements.tabId, content, language);
            } else {
                containerElements.previewManager.clearPreview(containerElements.tabId);
            }
        }
    } else {
        initResponseEditor();
        if (responseEditor) {
            responseEditor.setContent(content, contentType, languageHint);
        }
    }
}


export function clearResponseDisplayForTab(tabId = null) {
    const containerElements = responseContainerFor(tabId);

    if (containerElements && containerElements.editor) {
        containerElements.renderedResponse = null;
        containerElements.inspection?.setSource(null);
        containerElements.editor.clear();
    } else {
        initResponseEditor();
        if (responseEditor) {
            responseEditor.clear();
        }
    }
}
