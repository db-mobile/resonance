/**
 * @fileoverview Helper functions for managing request body content
 * Provides unified interface for both textarea and CodeMirror editor
 * @module modules/requestBodyHelper
 */

/**
 * Get the current request body content
 * Prioritizes CodeMirror editor, falls back to textarea
 * @returns {string}
 */
export function getRequestBodyContent() {
    if (window.requestBodyEditor) {
        return window.requestBodyEditor.getContent();
    }
    const bodyInput = document.getElementById('body-input');
    return bodyInput ? bodyInput.value : '';
}

/**
 * Set the request body content
 * Updates both CodeMirror editor and textarea (for backward compatibility)
 * @param {string} content - The content to set
 */
export function setRequestBodyContent(content) {
    const bodyInput = document.getElementById('body-input');

    // Update textarea (for backward compatibility)
    if (bodyInput) {
        bodyInput.value = content;
    }

    // Update CodeMirror editor
    if (window.requestBodyEditor) {
        window.requestBodyEditor.setContent(content);
    }
}

/**
 * Clear the request body content
 */
export function clearRequestBodyContent() {
    setRequestBodyContent('');
}

/**
 * Format the JSON content in the request body
 * @returns {boolean} - True if formatting succeeded, false otherwise
 */
export function formatRequestBodyJSON() {
    if (window.requestBodyEditor) {
        return window.requestBodyEditor.formatJSON();
    }

    // Fallback: try to format textarea content
    const bodyInput = document.getElementById('body-input');
    if (!bodyInput) {
        return false;
    }

    try {
        const content = bodyInput.value.trim();
        if (!content) {
            return true;
        }
        const parsed = JSON.parse(content);
        const formatted = JSON.stringify(parsed, null, 2);
        bodyInput.value = formatted;
        return true;
    } catch (e) {
        return false;
    }
}
