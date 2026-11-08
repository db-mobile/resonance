/**
 * @fileoverview Lists the saved examples of the open request and routes view, rename and delete actions
 * @module controllers/ExamplesController
 */

import { templateLoader } from '../templateLoader.js';
import { toast } from '../ui/Toast.js';
import { translate, translateCount } from '../utils/translate.js';
import { statusCategory } from '../utils/statusCategory.js';
import { exampleMeta } from '../examples/exampleFormat.js';
import { EXAMPLES_CHANGED_EVENT } from '../services/ExamplesService.js';

const ROW_TEMPLATE = './src/templates/examples/exampleRow.html';

export class ExamplesController {
    /**
     * @param {Object} deps
     * @param {Object} deps.service
     * @param {{show: Function}} deps.confirmDialog
     * @param {{show: Function}} deps.renameDialog
     * @param {{show: Function}} deps.previewModal
     * @param {EventTarget|null} [deps.eventTarget]
     */
    constructor({ service, confirmDialog, renameDialog, previewModal, eventTarget = undefined }) {
        this.service = service;
        this.confirmDialog = confirmDialog;
        this.renameDialog = renameDialog;
        this.previewModal = previewModal;
        this.eventTarget = eventTarget === undefined
            ? (typeof document !== 'undefined' && typeof document.addEventListener === 'function' ? document : null)
            : eventTarget;
        this.list = null;
        this.empty = null;
        this.count = null;
        this.examples = [];
        this.currentCollectionId = null;
        this.currentEndpointId = null;
        this._contextRevision = 0;
        this._initialized = false;
        this._onChanged = (event) => this._handleChanged(event.detail);
        this._onClick = (event) => this._handleClick(event);
    }

    /** @returns {void} */
    initialize() {
        if (this._initialized) {
            return;
        }
        this.list = document.getElementById('examples-list');
        this.empty = document.getElementById('examples-empty');
        this.count = document.getElementById('examples-count');
        if (!this.list) {
            return;
        }
        this.list.addEventListener('click', this._onClick);
        this.eventTarget?.addEventListener(EXAMPLES_CHANGED_EVENT, this._onChanged);
        this._initialized = true;
        this.render([]);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async loadExamples(collectionId, endpointId) {
        const revision = ++this._contextRevision;
        this.currentCollectionId = collectionId;
        this.currentEndpointId = endpointId;
        if (!this._initialized) {
            this.initialize();
        }
        let examples = [];
        try {
            examples = await this.service.getExamples(collectionId, endpointId);
        } catch (error) {
            if (revision === this._contextRevision) {
                toast.error(translate('examples.load_failed', 'Failed to load examples: {{message}}', { message: error?.message ?? String(error) }));
            }
        }
        if (revision !== this._contextRevision) {
            return;
        }
        this.render(examples);
    }

    /** @returns {void} */
    clearContext() {
        this._contextRevision += 1;
        this.currentCollectionId = null;
        this.currentEndpointId = null;
        this.render([]);
    }

    /**
     * @param {Array<Object>} examples
     * @returns {void}
     */
    render(examples) {
        this.examples = Array.isArray(examples) ? examples : [];
        if (!this.list) {
            return;
        }
        this.list.replaceChildren(...this.examples.map((example) => this._row(example)));
        this.empty?.classList.toggle('is-hidden', this.examples.length > 0);
        if (this.count) {
            this.count.textContent = translateCount('examples.count', this.examples.length, {
                one: '{{count}} example', other: '{{count}} examples'
            });
            this.count.classList.toggle('is-hidden', this.examples.length === 0);
        }
    }

    /**
     * @param {Object} example
     * @returns {HTMLElement}
     */
    _row(example) {
        const row = templateLoader.cloneSync(ROW_TEMPLATE, 'tpl-example-row').firstElementChild;
        row.dataset.exampleId = example.id;
        const status = row.querySelector('.example-status');
        status.textContent = String(example.status);
        status.classList.add(`status-${statusCategory(example.status)}`);
        row.querySelector('.example-name').textContent = example.name;
        row.querySelector('.example-meta').textContent = exampleMeta(example);
        for (const [action, key, fallback] of [
            ['view', 'examples.view', 'View example'],
            ['rename', 'examples.rename', 'Rename example'],
            ['delete', 'examples.delete', 'Delete example']
        ]) {
            const button = row.querySelector(`[data-action="${action}"]`);
            const label = translate(key, fallback);
            button.setAttribute('aria-label', label);
            button.title = label;
        }
        return row;
    }

    /**
     * @param {MouseEvent} event
     * @returns {void}
     */
    _handleClick(event) {
        const button = event.target.closest('[data-action]');
        const row = button?.closest('.example-row');
        if (!button || !row || !this.list.contains(row)) {
            return;
        }
        const id = row.dataset.exampleId;
        const handlers = { view: () => this.viewExample(id), rename: () => this.renameExample(id), delete: () => this.deleteExample(id) };
        handlers[button.dataset.action]?.();
    }

    /**
     * @param {{collectionId: string, endpointId: string, examples: Array<Object>}} detail
     * @returns {void}
     */
    _handleChanged(detail) {
        if (detail?.collectionId === this.currentCollectionId && detail?.endpointId === this.currentEndpointId) {
            this.render(detail.examples);
        }
    }

    /**
     * @param {string} id
     * @returns {Object|null}
     */
    _find(id) {
        return this.examples.find((example) => example.id === id) ?? null;
    }

    /**
     * @param {string} id
     * @returns {void}
     */
    viewExample(id) {
        const example = this._find(id);
        if (example) {
            this.previewModal.show(example);
        }
    }

    /**
     * @param {string} id
     * @returns {Promise<void>}
     */
    async renameExample(id) {
        const example = this._find(id);
        if (!example) {
            return;
        }
        const name = await this.renameDialog.show(example.name, {
            title: translate('examples.rename_title', 'Rename example'),
            label: translate('examples.name_label', 'Example name:'),
            confirmText: translate('common.rename', 'Rename')
        });
        if (!name || name === example.name) {
            return;
        }
        try {
            await this.service.renameExample(this.currentCollectionId, this.currentEndpointId, id, name);
            toast.success(translate('examples.renamed', 'Example renamed'));
        } catch (error) {
            toast.error(translate('examples.save_failed', 'Failed to save example: {{message}}', { message: error?.message ?? String(error) }));
        }
    }

    /**
     * @param {string} id
     * @returns {Promise<void>}
     */
    async deleteExample(id) {
        const example = this._find(id);
        if (!example) {
            return;
        }
        const confirmed = await this.confirmDialog.show(
            translate('examples.delete_confirm', 'Delete the example "{{name}}"? This cannot be undone.', { name: example.name }),
            {
                title: translate('examples.delete_title', 'Delete example'),
                confirmText: translate('common.delete', 'Delete'),
                cancelText: translate('common.cancel', 'Cancel'),
                dangerous: true
            }
        );
        if (!confirmed) {
            return;
        }
        try {
            await this.service.deleteExample(this.currentCollectionId, this.currentEndpointId, id);
            toast.success(translate('examples.deleted', 'Example deleted'));
        } catch (error) {
            toast.error(translate('examples.save_failed', 'Failed to save example: {{message}}', { message: error?.message ?? String(error) }));
        }
    }

    /** @returns {void} */
    destroy() {
        this._contextRevision += 1;
        this.list?.removeEventListener('click', this._onClick);
        this.eventTarget?.removeEventListener(EXAMPLES_CHANGED_EVENT, this._onChanged);
        this._initialized = false;
    }
}
