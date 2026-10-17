/**
 * @fileoverview Reads the request editor form into plain data so services never touch the DOM
 * @module requestFormReader
 */

import { getProtocol } from './protocols/protocolRegistry.js';
import { parseKeyValuePairs, parseKeyValueRows } from './keyValueManager.js';
import { captureFormBody, getRequestBodyContent, setRequestBodyContent } from './requestBodyHelper.js';
import { readMqttForm } from './mqtt/mqttFields.js';

/**
 * @typedef {Object} RequestFormSnapshot
 * @property {string|null} url
 * @property {string|null} method
 * @property {Object|null} pathParams
 * @property {Array<Object>|null} queryParams
 * @property {Array<Object>|null} headers
 * @property {Object|null} bodyState
 * @property {Object|null} authConfig
 */

export class RequestFormReader {
    /**
     * @param {Object} [deps]
     * @param {{getAuthConfig: function(): (Object|null)}|null} [deps.authManager]
     * @param {Object|null} [deps.graphqlBodyManager]
     * @param {(function(): Object)|null} [deps.captureGrpcState]
     */
    constructor({ authManager = null, graphqlBodyManager = null, captureGrpcState = null } = {}) {
        this.authManager = authManager;
        this.graphqlBodyManager = graphqlBodyManager;
        this.captureGrpcState = captureGrpcState;
    }

    /**
     * @param {Object} [descriptor]
     * @returns {{urlInput: HTMLInputElement|null, methodSelect: HTMLSelectElement|null, pathParamsList: HTMLElement|null, queryParamsList: HTMLElement|null, headersList: HTMLElement|null, bodyInput: HTMLElement|null}}
     */
    elements(descriptor = getProtocol('http')) {
        const ownUrlInput = descriptor.urlInputId
            ? document.getElementById(descriptor.urlInputId)
            : null;
        return {
            urlInput: ownUrlInput || document.getElementById('url-input'),
            methodSelect: document.getElementById('method-select'),
            pathParamsList: document.getElementById('path-params-list'),
            queryParamsList: document.getElementById('query-params-list'),
            headersList: document.getElementById('headers-list'),
            bodyInput: document.getElementById('body-input')
        };
    }

    /** @returns {boolean} */
    hasBody() {
        return Boolean(document.getElementById('body-input'));
    }

    /** @returns {string} */
    bodyMode() {
        return document.getElementById('body-mode-select')?.value || 'json';
    }

    /** @returns {{modifiedBody: string|null, formBodyData: Object|null, graphqlData: Object|null}} */
    readBodyState() {
        const state = { modifiedBody: null, formBodyData: null, graphqlData: null };

        const formBody = captureFormBody(this.bodyMode());
        if (formBody) {
            state.formBodyData = formBody;
        } else if (this.graphqlBodyManager && this.graphqlBodyManager.isGraphQLMode()) {
            state.graphqlData = {
                mode: 'graphql',
                query: this.graphqlBodyManager.getGraphQLQuery(),
                variables: this.graphqlBodyManager.getGraphQLVariables()
            };
        } else {
            const currentBody = getRequestBodyContent().trim();
            state.modifiedBody = currentBody || null;
        }

        return state;
    }

    /**
     * @param {Object} [descriptor]
     * @returns {RequestFormSnapshot}
     */
    read(descriptor = getProtocol('http')) {
        const { urlInput, methodSelect, pathParamsList, queryParamsList, headersList, bodyInput } = this.elements(descriptor);
        return {
            url: urlInput ? urlInput.value : null,
            method: methodSelect ? methodSelect.value : null,
            pathParams: pathParamsList ? parseKeyValuePairs(pathParamsList) : null,
            queryParams: queryParamsList ? parseKeyValueRows(queryParamsList) : null,
            headers: headersList ? parseKeyValueRows(headersList) : null,
            bodyState: bodyInput ? this.readBodyState() : null,
            authConfig: this.readAuthConfig()
        };
    }

    /** @returns {Object} */
    readTabBody() {
        return captureFormBody(this.bodyMode()) ?? { mode: 'json', content: getRequestBodyContent() };
    }

    /** @returns {{query: string, variables: string, operationName: string|null}|null} */
    readGraphQLData() {
        const manager = this.graphqlBodyManager;
        if (!manager) {
            return null;
        }
        return {
            query: manager.getGraphQLQuery(),
            variables: manager.getGraphQLVariables(),
            operationName: manager.getSelectedOperationName?.() || null
        };
    }

    /** @returns {Object} */
    readGrpcState() {
        return this.captureGrpcState ? this.captureGrpcState() : {};
    }

    /** @returns {Object} */
    readMqttData() {
        return readMqttForm();
    }

    /** @returns {Object|null} */
    readAuthConfig() {
        return this.authManager?.getAuthConfig() ?? null;
    }

    /** @returns {void} */
    clear() {
        const { urlInput, methodSelect, pathParamsList, headersList, queryParamsList } = this.elements();
        if (urlInput) {
            urlInput.value = '';
        }
        if (methodSelect) {
            methodSelect.value = 'GET';
        }
        setRequestBodyContent('');
        for (const list of [pathParamsList, headersList, queryParamsList]) {
            while (list && list.firstChild) {
                list.removeChild(list.firstChild);
            }
        }
    }
}
