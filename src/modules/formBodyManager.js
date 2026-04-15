/**
 * @fileoverview Manages form-data and URL-encoded body modes using the existing key-value editor
 * @module formBodyManager
 */

import {
    addKeyValueRow,
    parseKeyValuePairs,
    populateKeyValueList,
    clearKeyValueList,
} from './keyValueManager.js';

export class FormBodyManager {
    constructor() {
        this.formdataList = document.getElementById('formdata-list');
        this.urlencodedList = document.getElementById('urlencoded-list');
    }

    initialize() {
        document.getElementById('add-formdata-row-btn')?.addEventListener('click', () => {
            addKeyValueRow(this.formdataList);
        });
        document.getElementById('add-urlencoded-row-btn')?.addEventListener('click', () => {
            addKeyValueRow(this.urlencodedList);
        });

        // Seed each list with one blank row
        addKeyValueRow(this.formdataList);
        addKeyValueRow(this.urlencodedList);
    }

    getFormDataFields() {
        return parseKeyValuePairs(this.formdataList);
    }

    getUrlencodedFields() {
        return parseKeyValuePairs(this.urlencodedList);
    }

    setFormDataFields(data) {
        clearKeyValueList(this.formdataList);
        if (data && Object.keys(data).length > 0) {
            populateKeyValueList(this.formdataList, data);
        } else {
            addKeyValueRow(this.formdataList);
        }
    }

    setUrlencodedFields(data) {
        clearKeyValueList(this.urlencodedList);
        if (data && Object.keys(data).length > 0) {
            populateKeyValueList(this.urlencodedList, data);
        } else {
            addKeyValueRow(this.urlencodedList);
        }
    }
}
