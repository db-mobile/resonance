import { copyResponseBtn, responseBodyDisplay, responseHeadersDisplay, responseTabButtons } from './domElements.js';

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
        console.error('Failed to copy to clipboard:', error);
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
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
 * Get the currently active response tab
 * @returns {string} - 'body' or 'headers'
 */
function getActiveResponseTab() {
    for (const button of responseTabButtons) {
        if (button.classList.contains('active')) {
            const tabName = button.getAttribute('data-tab');
            if (tabName === 'response-body') return 'body';
            if (tabName === 'response-headers') return 'headers';
        }
    }
    return 'body'; // Default to body
}

/**
 * Update copy button tooltip based on active tab
 */
function updateCopyButtonTooltip() {
    const activeTab = getActiveResponseTab();
    if (copyResponseBtn) {
        if (activeTab === 'body') {
            copyResponseBtn.title = 'Copy Response Body';
        } else {
            copyResponseBtn.title = 'Copy Response Headers';
        }
    }
}

/**
 * Handle copy button click
 */
export async function handleCopyResponse() {
    const activeTab = getActiveResponseTab();
    let textToCopy = '';

    if (activeTab === 'body') {
        textToCopy = responseBodyDisplay.textContent;
    } else {
        textToCopy = responseHeadersDisplay.textContent;
    }

    if (!textToCopy || textToCopy.trim() === '') {
        showCopyFeedback(copyResponseBtn, false);
        return;
    }

    const success = await copyToClipboard(textToCopy);
    showCopyFeedback(copyResponseBtn, success);
}

/**
 * Initialize copy functionality
 */
export function initializeCopyHandler() {
    if (copyResponseBtn) {
        copyResponseBtn.addEventListener('click', handleCopyResponse);

        // Update tooltip initially
        updateCopyButtonTooltip();

        // Update tooltip when response tabs are clicked
        for (const button of responseTabButtons) {
            button.addEventListener('click', () => {
                // Use setTimeout to ensure the active class has been updated
                setTimeout(updateCopyButtonTooltip, 0);
            });
        }
    }
}
