import { app } from './appContext.js';

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * @param {HTMLElement} button
 * @param {boolean} success
 */
function showCopyFeedback(button, success) {
    const originalTitle = button.title;
    const originalHTML = button.innerHTML;

    if (success) {
        button.title = 'Copied!';
        button.innerHTML = `
            <span class="icon icon-16 icon-check"></span>
        `;
        button.classList.add('copied');
    } else {
        button.title = 'Copy failed';
        button.classList.add('copy-error');
    }

    setTimeout(() => {
        button.title = originalTitle;
        button.innerHTML = originalHTML;
        button.classList.remove('copied', 'copy-error');
    }, 2000);
}

/**
 * @param {HTMLElement} button
 * @param {string} tabId
 * @param {'editor'|'headersEditor'} editorKey
 * @param {string|null} placeholderText
 * @returns {Promise<void>}
 */
async function handleCopy(button, tabId, editorKey, placeholderText) {
    const { responseContainerManager } = app;
    if (!responseContainerManager) {
        showCopyFeedback(button, false);
        return;
    }

    const containerElements = responseContainerManager.getOrCreateContainer(tabId);
    if (!containerElements) {
        showCopyFeedback(button, false);
        return;
    }

    const editor = containerElements[editorKey];
    const textToCopy = editor ? editor.getContent() : '';

    if (!textToCopy || textToCopy.trim() === '' || textToCopy === placeholderText) {
        showCopyFeedback(button, false);
        return;
    }

    const success = await copyToClipboard(textToCopy);
    showCopyFeedback(button, success);
}

/**
 * @param {HTMLElement} button
 * @param {string} tabId
 * @param {'editor'|'headersEditor'} editorKey
 * @param {string|null} placeholderText
 * @returns {void}
 */
function attach(button, tabId, editorKey, placeholderText) {
    if (button) {
        button.addEventListener('click', () => {
            handleCopy(button, tabId, editorKey, placeholderText);
        });
    }
}

/**
 * @param {HTMLElement} button
 * @param {string} tabId
 */
export function attachCopyHandler(button, tabId) {
    attach(button, tabId, 'editor', null);
}

/**
 * @param {HTMLElement} button
 * @param {string} tabId
 */
export function attachHeadersCopyHandler(button, tabId) {
    attach(button, tabId, 'headersEditor', 'No response headers.');
}
