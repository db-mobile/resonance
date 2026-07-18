/**
 * @fileoverview Helper functions for managing request body content
 * Provides unified interface for both textarea and CodeMirror editor
 * @module modules/requestBodyHelper
 */

import { app } from './appContext.js';

/**
 * Get the current request body content
 * Prioritizes CodeMirror editor, falls back to textarea
 * @returns {string}
 */
export function getRequestBodyContent() {
    if (app.requestBodyEditor) {
        return app.requestBodyEditor.getContent();
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

    if (bodyInput) {
        bodyInput.value = content;
    }

    if (app.requestBodyEditor) {
        app.requestBodyEditor.setContent(content);
    }
}
