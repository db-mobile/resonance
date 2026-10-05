/**
 * @fileoverview Manages the form-data, URL-encoded, and binary body modes.
 * @module formBodyManager
 */

import { normalizeFormRows, isMeaningfulRow } from './utils/formDataRows.js';
import { markTabModified } from './state/tabModified.js';
import { createEnabledCheckbox, createRemoveRowButton, createTextInput } from './keyValueManager.js';

export class FormBodyManager {
    constructor() {
        this.formdataList = document.getElementById('formdata-list');
        this.urlencodedList = document.getElementById('urlencoded-list');
        this.binaryFilePathInput = document.getElementById('binary-file-path');
        this.binaryContentTypeInput = document.getElementById('binary-content-type');
    }

    initialize() {
        document.getElementById('add-formdata-row-btn')?.addEventListener('click', () => {
            this._addRow(this.formdataList, {}, true);
        });
        document.getElementById('add-urlencoded-row-btn')?.addEventListener('click', () => {
            this._addRow(this.urlencodedList, {}, false);
        });
        document.getElementById('binary-browse-btn')?.addEventListener('click', async () => {
            const path = await window.backendAPI.pickUploadFile();
            if (path && this.binaryFilePathInput) {
                this.binaryFilePathInput.value = path;
                markTabModified();
            }
        });
        document.getElementById('binary-clear-btn')?.addEventListener('click', () => {
            this.setBinaryBody({});
            markTabModified();
        });

        [this.formdataList, this.urlencodedList].forEach((list) => {
            list?.addEventListener('input', () => markTabModified());
            list?.addEventListener('change', () => markTabModified());
        });
        [this.binaryFilePathInput, this.binaryContentTypeInput].forEach((input) => {
            input?.addEventListener('input', () => markTabModified());
        });

        this._addRow(this.formdataList, {}, true);
        this._addRow(this.urlencodedList, {}, false);
    }

    getFormDataRows() {
        return this._parseRows(this.formdataList, true);
    }

    getUrlencodedRows() {
        return this._parseRows(this.urlencodedList, false);
    }

    setFormDataRows(fields) {
        this._populate(this.formdataList, fields, true);
    }

    setUrlencodedRows(fields) {
        this._populate(this.urlencodedList, fields, false);
    }

    /** @returns {{filePath: string, contentType: string}} */
    getBinaryBody() {
        return {
            filePath: this.binaryFilePathInput?.value.trim() || '',
            contentType: this.binaryContentTypeInput?.value.trim() || ''
        };
    }

    setBinaryBody(data) {
        if (this.binaryFilePathInput) {
            this.binaryFilePathInput.value = data?.filePath || '';
        }
        if (this.binaryContentTypeInput) {
            this.binaryContentTypeInput.value = data?.contentType || '';
        }
    }

    _populate(list, fields, allowFile) {
        if (!list) {
            return;
        }
        list.innerHTML = '';
        const rows = normalizeFormRows(fields);
        if (rows.length === 0) {
            this._addRow(list, {}, allowFile);
            return;
        }
        rows.forEach((row) => this._addRow(list, row, allowFile));
    }

    _addRow(list, row, allowFile) {
        if (list) {
            list.appendChild(this._createRow(row, allowFile));
        }
    }

    _parseRows(list, allowFile) {
        if (!list) {
            return [];
        }
        const rows = [];
        list.querySelectorAll('.key-value-row').forEach((rowEl) => {
            const type = allowFile && rowEl.querySelector('.row-type-select')?.value === 'file'
                ? 'file'
                : 'text';
            const row = {
                key: rowEl.querySelector('.key-input')?.value.trim() || '',
                value: type === 'text' ? (rowEl.querySelector('.value-input')?.value.trim() || '') : '',
                type,
                filePath: type === 'file' ? (rowEl.querySelector('.file-path-input')?.value.trim() || '') : '',
                contentType: type === 'file' ? (rowEl.querySelector('.part-content-type-input')?.value.trim() || '') : '',
                enabled: rowEl.querySelector('.row-enabled-checkbox')?.checked !== false
            };
            if (isMeaningfulRow(row)) {
                rows.push(row);
            }
        });
        return rows;
    }

    _createRow(row, allowFile) {
        const rowEl = document.createElement('div');
        rowEl.classList.add('key-value-row', 'form-body-row');
        rowEl.appendChild(createEnabledCheckbox(row.enabled !== false, 'Enable field'));
        rowEl.appendChild(createTextInput('key-input', 'Key', row.key || ''));

        const valueInput = createTextInput('value-input', 'Value', row.value || '');

        if (allowFile) {
            const typeSelect = document.createElement('select');
            typeSelect.classList.add('select-base', 'compact', 'row-type-select');
            typeSelect.setAttribute('aria-label', 'Field type');
            [['text', 'Text'], ['file', 'File']].forEach(([optValue, label]) => {
                const option = document.createElement('option');
                option.value = optValue;
                option.textContent = label;
                typeSelect.appendChild(option);
            });
            typeSelect.value = row.type === 'file' ? 'file' : 'text';
            rowEl.appendChild(typeSelect);

            const fileCell = this._createFileCell(row);
            rowEl.appendChild(valueInput);
            rowEl.appendChild(fileCell);

            const applyRowType = () => {
                const isFile = typeSelect.value === 'file';
                valueInput.hidden = isFile;
                fileCell.hidden = !isFile;
            };
            typeSelect.addEventListener('change', applyRowType);
            applyRowType();
        } else {
            rowEl.appendChild(valueInput);
        }

        rowEl.appendChild(createRemoveRowButton());

        return rowEl;
    }

    /**
     * @param {Object} row
     * @returns {HTMLElement}
     */
    _createFileCell(row) {
        const fileCell = document.createElement('div');
        fileCell.classList.add('file-cell');

        const filePathInput = createTextInput('file-path-input', 'File path or {{variable}}', row.filePath || '');
        filePathInput.title = row.filePath || '';
        fileCell.appendChild(filePathInput);

        const browseButton = document.createElement('button');
        browseButton.type = 'button';
        browseButton.classList.add('button', 'flat', 'small', 'browse-file-btn');
        browseButton.textContent = 'Browse';
        browseButton.addEventListener('click', async () => {
            const path = await window.backendAPI.pickUploadFile();
            if (path) {
                filePathInput.value = path;
                filePathInput.title = path;
                markTabModified();
            }
        });
        fileCell.appendChild(browseButton);

        fileCell.appendChild(createTextInput('part-content-type-input', 'Content-Type (optional)', row.contentType || ''));
        return fileCell;
    }

}
