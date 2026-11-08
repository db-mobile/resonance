/**
 * @fileoverview Read-only modal showing one saved example: status, headers and body
 * @module examples/ExamplePreviewModal
 */

import { BaseModal } from '../ui/BaseModal.js';
import { createLazyEditorProxy } from '../editorLoader.js';
import { statusCategory } from '../utils/statusCategory.js';
import { translate } from '../utils/translate.js';
import { exampleBodyBytes } from './exampleFormat.js';

/** @augments */
export class ExamplePreviewModal extends BaseModal {
    constructor() {
        super();
        this.editor = null;
    }

    /**
     * @param {Object} example
     * @returns {void}
     */
    show(example) {
        const dialog = this.mount({
            overlayClass: 'example-preview-overlay',
            dialogClass: 'example-preview-dialog modal-dialog modal-dialog--example-preview',
            templatePath: './src/templates/examples/examplePreviewDialog.html',
            templateId: 'tpl-example-preview-dialog'
        });

        dialog.querySelector('[data-role="title"]').textContent = example.name;
        const status = dialog.querySelector('.example-preview-status');
        status.textContent = `${example.status} ${example.statusText ?? ''}`.trim();
        status.classList.add(`status-${statusCategory(example.status)}`);
        dialog.querySelector('.example-preview-content-type').textContent = example.contentType ?? '';

        this._renderHeaders(dialog.querySelector('.example-preview-headers'), example.headers ?? []);
        this._renderBody(dialog, example);
        dialog.querySelector('#example-preview-close-btn').addEventListener('click', () => this.destroy());
    }

    /**
     * @param {HTMLElement} container
     * @param {Array<{key: string, value: string}>} headers
     * @returns {void}
     */
    _renderHeaders(container, headers) {
        container.replaceChildren();
        for (const header of headers) {
            const row = document.createElement('div');
            row.className = 'row property';
            const content = document.createElement('div');
            content.className = 'row-content';
            const title = document.createElement('span');
            title.className = 'title';
            title.textContent = header.key;
            const value = document.createElement('span');
            value.className = 'subtitle';
            value.textContent = header.value;
            content.append(title, value);
            row.appendChild(content);
            container.appendChild(row);
        }
        container.classList.toggle('is-hidden', headers.length === 0);
    }

    /**
     * @param {HTMLElement} dialog
     * @param {Object} example
     * @returns {void}
     */
    _renderBody(dialog, example) {
        const binary = dialog.querySelector('.example-preview-binary');
        const editorHost = dialog.querySelector('.example-preview-editor');
        if (example.bodyEncoding === 'base64') {
            binary.textContent = translate('examples.preview_binary', 'Binary body ({{bytes}} bytes, base64)', { bytes: exampleBodyBytes(example) });
            binary.classList.remove('is-hidden');
            editorHost.classList.add('is-hidden');
            return;
        }
        this.editor = createLazyEditorProxy('response', editorHost);
        this.editor.setContent(example.body ?? '', example.contentType ?? null);
    }

    /** @returns {void} */
    destroy() {
        this.editor?.destroy();
        this.editor = null;
        super.destroy();
    }
}
