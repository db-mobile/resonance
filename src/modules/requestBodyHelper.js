/**
 * @fileoverview Helper functions for managing request body content
 * @module modules/requestBodyHelper
 */

import { app } from './appContext.js';

/** @returns {string} */
export function getRequestBodyContent() {
    if (app.requestBodyEditor) {
        return app.requestBodyEditor.getContent();
    }
    const bodyInput = document.getElementById('body-input');
    return bodyInput ? bodyInput.value : '';
}

/**
 * @param {{bodyMode: string, formBodyManager: Object|null, requestBodyTextEditor: Object|null, jsonContent: string, processor: Object, variables: Object}} options
 * @returns {{body: (string|Object|Array|undefined), bodyType: (string|undefined), error: (string|undefined)}}
 */
export function captureSnippetBody({ bodyMode, formBodyManager, requestBodyTextEditor, jsonContent, processor, variables }) {
    if ((bodyMode === 'formdata' || bodyMode === 'urlencoded') && formBodyManager) {
        const rows = bodyMode === 'formdata'
            ? formBodyManager.getFormDataRows()
            : formBodyManager.getUrlencodedRows();
        const processed = rows
            .filter((row) => row.enabled !== false)
            .map((row) => ({
                key: processor.processTemplate(row.key, variables),
                value: row.type === 'file' ? '' : processor.processTemplate(row.value || '', variables),
                type: row.type || 'text',
                filePath: row.filePath ? processor.processTemplate(row.filePath, variables) : undefined,
                contentType: row.contentType || undefined
            }));
        if (processed.length === 0) {
            return {};
        }
        return { body: processed, bodyType: bodyMode };
    }

    if (bodyMode === 'binary' && formBodyManager) {
        const binary = formBodyManager.getBinaryBody();
        if (!binary.filePath) {
            return {};
        }
        return {
            body: {
                filePath: processor.processTemplate(binary.filePath, variables),
                contentType: binary.contentType || undefined
            },
            bodyType: 'binary'
        };
    }

    if (bodyMode === 'text') {
        const rawText = requestBodyTextEditor ? requestBodyTextEditor.getContent() : '';
        if (!rawText) {
            return {};
        }
        return { body: processor.processTemplate(rawText, variables), bodyType: 'text' };
    }

    const bodyText = (jsonContent || '').trim();
    if (!bodyText) {
        return {};
    }
    try {
        return { body: JSON.parse(processor.processTemplate(bodyText, variables)) };
    } catch (e) {
        return { error: e.message };
    }
}

/** @param {string} content */
export function setRequestBodyContent(content) {
    const bodyInput = document.getElementById('body-input');

    if (bodyInput) {
        bodyInput.value = content;
    }

    if (app.requestBodyEditor) {
        app.requestBodyEditor.setContent(content);
    }
}
