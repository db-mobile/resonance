/**
 * Copy text to clipboard and show visual feedback
 * @param {string} text - The text to copy
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
 * Show visual feedback on the copy button
 * @param {HTMLElement} button - The button element
 * @param {boolean} success - Whether the copy was successful
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
 * Handle copy button click for a specific tab
 * @param {HTMLElement} button - The copy button that was clicked
 * @param {string} tabId - The workspace tab ID
 */
export async function handleCopyResponse(button, tabId) {
    // Get the response container manager from the window
    const { responseContainerManager } = window;
    if (!responseContainerManager) {
        showCopyFeedback(button, false);
        return;
    }

    // Get the container elements for this tab
    const containerElements = responseContainerManager.getOrCreateContainer(tabId);
    if (!containerElements) {
        showCopyFeedback(button, false);
        return;
    }

    // Get the response body content from the editor
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
 * Handle copy button click for headers
 * @param {HTMLElement} button - The copy button that was clicked
 * @param {string} tabId - The workspace tab ID
 */
export async function handleCopyHeaders(button, tabId) {
    const { responseContainerManager } = window;
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
 * Attach copy handler to a copy button
 * @param {HTMLElement} button - The copy button element
 * @param {string} tabId - The workspace tab ID
 */
export function attachCopyHandler(button, tabId) {
    if (button) {
        button.addEventListener('click', () => {
            handleCopyResponse(button, tabId);
        });
    }
}

/**
 * Attach copy handler for headers button
 * @param {HTMLElement} button - The copy button element
 * @param {string} tabId - The workspace tab ID
 */
export function attachHeadersCopyHandler(button, tabId) {
    if (button) {
        button.addEventListener('click', () => {
            handleCopyHeaders(button, tabId);
        });
    }
}

/**
 * Initialize copy functionality (legacy support)
 */
export function initializeCopyHandler() {
    // This function is kept for backwards compatibility
    // The new approach uses attachCopyHandler() for per-tab buttons
}
