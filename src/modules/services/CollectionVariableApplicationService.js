/**
 * @fileoverview Applies collection variables to request form fields
 * @module services/CollectionVariableApplicationService
 */

import { getRequestBodyContent, setRequestBodyContent } from '../requestBodyHelper.js';

/**
 * Applies variable substitution to request form elements.
 */
export class CollectionVariableApplicationService {
    /**
     * @param {Object} options - Service dependencies
     * @param {VariableService} options.variableService - Variable service
     */
    constructor({ variableService }) {
        this.variableService = variableService;
    }

    async processFormVariables(collectionId, formElements, { includeUrl = true } = {}) {
        try {
            if (includeUrl && formElements.urlInput && formElements.urlInput.value) {
                formElements.urlInput.value = await this.variableService.processTemplate(
                    formElements.urlInput.value,
                    collectionId
                );
            }

            const currentBody = getRequestBodyContent();
            if (currentBody) {
                const processedBody = await this.variableService.processTemplate(currentBody, collectionId);
                setRequestBodyContent(processedBody);
            }

            await this.processKeyValueRows(formElements.headersList, collectionId);
            await this.processKeyValueRows(formElements.queryParamsList, collectionId);
        } catch (error) {
            void error;
        }
    }

    async processKeyValueRows(listElement, collectionId) {
        if (!listElement) {
            return;
        }

        const rows = listElement.querySelectorAll('.key-value-row');
        for (const row of rows) {
            const keyInput = row.querySelector('.key-input');
            const valueInput = row.querySelector('.value-input');

            if (keyInput && keyInput.value) {
                keyInput.value = await this.variableService.processTemplate(keyInput.value, collectionId);
            }

            if (valueInput && valueInput.value) {
                valueInput.value = await this.variableService.processTemplate(valueInput.value, collectionId);
            }
        }
    }
}
