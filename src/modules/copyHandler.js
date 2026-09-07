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
 */
export async function handleCopyResponse(button, tabId) {
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

    const { editor } = containerElements;
    let textToCopy = '';
    if (editor) {
        textToCopy = editor.getContent();
    }

    if (!textToCopy || textToCopy.trim() === '') {
        showCopyFeedback(button, false);
        return;
    }

    const success = await copyToClipboard(textToCopy);
    showCopyFeedback(button, success);
}

/**
 * @param {HTMLElement} button
 * @param {string} tabId
 */
export async function handleCopyHeaders(button, tabId) {
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

    const { headersEditor } = containerElements;
    let textToCopy = '';
    if (headersEditor) {
        textToCopy = headersEditor.getContent();
    }

    if (!textToCopy || textToCopy.trim() === '' || textToCopy === 'No response headers.') {
        showCopyFeedback(button, false);
        return;
    }

    const success = await copyToClipboard(textToCopy);
    showCopyFeedback(button, success);
}

/**
 * @param {HTMLElement} button
 * @param {string} tabId
 */
export function attachCopyHandler(button, tabId) {
    if (button) {
        button.addEventListener('click', () => {
            handleCopyResponse(button, tabId);
        });
    }
}

/**
 * @param {HTMLElement} button
 * @param {string} tabId
 */
export function attachHeadersCopyHandler(button, tabId) {
    if (button) {
        button.addEventListener('click', () => {
            handleCopyHeaders(button, tabId);
        });
    }
}

export function initializeCopyHandler() {
}
