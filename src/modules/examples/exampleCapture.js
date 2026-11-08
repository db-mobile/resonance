/**
 * @fileoverview Response-toolbar action that stores the current response as a named example
 * @module examples/exampleCapture
 */

import { app } from '../appContext.js';
import { toast } from '../ui/Toast.js';
import { translate } from '../utils/translate.js';
import { ExampleNameDialog } from '../ui/ExampleNameDialog.js';
import { defaultExampleName, exampleFromTab, uniqueExampleName } from './exampleFromResponse.js';

const REASONS = {
    unbound: ['examples.cannot_save_unbound', 'Save the request to a collection before adding examples'],
    protocol: ['examples.cannot_save_protocol', 'Examples are available for HTTP and GraphQL requests'],
    no_response: ['examples.cannot_save_no_response', 'Send the request first to capture a response'],
    truncated: ['examples.cannot_save_truncated', 'This response was too large to keep in full'],
    too_large: ['examples.cannot_save_too_large', 'This response body is too large to save as an example']
};

const FEEDBACK_MS = 2000;

/** @type {ExampleNameDialog|null} */
let dialog = null;

/** @returns {ExampleNameDialog} */
function nameDialog() {
    dialog = dialog ?? new ExampleNameDialog();
    return dialog;
}

/**
 * @param {HTMLElement|null} button
 * @param {boolean} success
 * @returns {void}
 */
function showFeedback(button, success) {
    if (!button) {
        return;
    }
    button.classList.add(success ? 'copied' : 'copy-error');
    setTimeout(() => button.classList.remove('copied', 'copy-error'), FEEDBACK_MS);
}

/**
 * @param {string} tabId
 * @returns {Promise<Object|null>}
 */
async function findTab(tabId) {
    const tabs = await app.workspaceTabController?.service?.getAllTabs?.();
    return (tabs ?? []).find((tab) => tab.id === tabId) ?? null;
}

/**
 * @param {HTMLElement|null} button
 * @param {string} tabId
 * @returns {Promise<Object|null>}
 */
export async function handleSaveExample(button, tabId) {
    const tab = await findTab(tabId);
    const result = exampleFromTab(tab);
    if (!result.ok) {
        const [key, fallback] = REASONS[result.reason] ?? REASONS.no_response;
        toast.error(translate(key, fallback));
        return null;
    }
    const { collectionId, endpointId } = tab.endpoint;
    const existing = await app.examplesService.getExamples(collectionId, endpointId);
    const suggested = uniqueExampleName(defaultExampleName(result.example, existing), existing);
    const name = await nameDialog().show(suggested, {
        title: translate('examples.save_dialog_title', 'Save as example'),
        label: translate('examples.name_label', 'Example name:'),
        confirmText: translate('examples.save_confirm', 'Save')
    });
    if (!name) {
        return null;
    }
    const example = { ...result.example, name: uniqueExampleName(name, existing) };
    try {
        await app.examplesService.addExample(collectionId, endpointId, example);
    } catch (error) {
        toast.error(translate('examples.save_failed', 'Failed to save example: {{message}}', { message: error?.message ?? String(error) }));
        showFeedback(button, false);
        return null;
    }
    toast.success(translate('examples.saved', 'Example "{{name}}" saved', { name: example.name }));
    showFeedback(button, true);
    return example;
}

/**
 * @param {HTMLElement|null} button
 * @param {string} tabId
 * @returns {void}
 */
export function attachSaveExampleHandler(button, tabId) {
    if (button) {
        button.addEventListener('click', () => handleSaveExample(button, tabId));
    }
}
