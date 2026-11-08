/**
 * @fileoverview Cached, synchronously queryable view of the variables visible to the current request
 * @module variables/VariableContext
 * @typedef {'resolved'|'unresolved'|'dynamic'|'path-param'|'unknown'} VariableStatus
 * @typedef {'environment'|'collection'|'dynamic'|'path-param'|null} VariableScope
 * @typedef {Object} VariableLookup
 * @property {VariableStatus} status
 * @property {string} name
 * @property {VariableScope} scope
 * @property {string|null} value
 * @property {boolean} secret
 * @property {string|null} envName
 * @property {string} [description]
 * @property {string} [example]
 * @property {boolean} [shadowed]
 */

import { ChangeEmitter } from '../services/ChangeEmitter.js';
import { DYNAMIC_VARIABLES, getDynamicVariable } from './dynamicVariables.js';

export const VARIABLES_CHANGED_EVENT = 'resonance:variables-changed';

/**
 * @param {string} name
 * @returns {VariableLookup}
 */
function unresolved(name) {
    return { status: 'unresolved', name, scope: null, value: null, secret: false, envName: null };
}

/**
 * @param {string} name
 * @returns {VariableLookup}
 */
function unknown(name) {
    return { status: 'unknown', name, scope: null, value: null, secret: false, envName: null };
}

/**
 * @param {import('./dynamicVariables.js').DynamicVariableInfo} info
 * @returns {VariableLookup}
 */
function dynamicLookup(info) {
    return {
        status: 'dynamic',
        name: `$${info.name}`,
        scope: 'dynamic',
        value: null,
        secret: false,
        envName: null,
        description: info.description,
        example: info.example
    };
}

export class VariableContext {
    /**
     * @param {Object} deps
     * @param {{getActiveEnvironment: function(): Promise<Object|null>, getActiveEnvironmentVariables: function(): Promise<Object>}} deps.environmentService
     * @param {{getCollectionVariableEntries: function(string): Promise<Array<{name: string, value: string, secret: boolean}>>}} deps.variableService
     * @param {function(): ({collectionId?: string}|null)} deps.getCurrentEndpoint
     * @param {EventTarget|null} [deps.eventTarget]
     */
    constructor({ environmentService, variableService, getCurrentEndpoint, eventTarget = undefined }) {
        this.environmentService = environmentService;
        this.variableService = variableService;
        this.getCurrentEndpoint = getCurrentEndpoint;
        this.eventTarget = eventTarget === undefined
            ? (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' ? document : null)
            : eventTarget;
        this._events = new ChangeEmitter();
        this._seq = 0;
        this._version = 0;
        this._ready = false;
        this._envName = null;
        /** @type {Map<string, {value: string|null, secret: boolean}>} */
        this._environment = new Map();
        /** @type {Map<string, {value: string|null, secret: boolean}>} */
        this._collection = new Map();
    }

    /** @returns {number} */
    get version() {
        return this._version;
    }

    /** @returns {boolean} */
    get ready() {
        return this._ready;
    }

    /** @param {Function} callback */
    addChangeListener(callback) {
        this._events.add(callback);
    }

    /** @param {Function} callback */
    removeChangeListener(callback) {
        this._events.remove(callback);
    }

    /** @returns {Promise<void>} */
    async refresh() {
        const seq = ++this._seq;
        const collectionId = this.getCurrentEndpoint?.()?.collectionId ?? null;
        const [environment, environmentVariables, collectionEntries] = await Promise.all([
            this._safely(() => this.environmentService.getActiveEnvironment(), null),
            this._safely(() => this.environmentService.getActiveEnvironmentVariables(), {}),
            collectionId
                ? this._safely(() => this.variableService.getCollectionVariableEntries(collectionId), [])
                : Promise.resolve([])
        ]);
        if (seq !== this._seq) {
            return;
        }
        this._envName = environment?.name ?? null;
        this._environment = this._buildEnvironmentMap(environment, environmentVariables);
        this._collection = this._buildCollectionMap(collectionEntries);
        this._ready = true;
        this._version += 1;
        this._notify();
    }

    /**
     * @param {string} name
     * @returns {VariableLookup}
     */
    lookup(name) {
        if (typeof name !== 'string' || name === '') {
            return unresolved(String(name ?? ''));
        }
        if (name.startsWith('$')) {
            const info = getDynamicVariable(name.slice(1));
            return info ? dynamicLookup(info) : unresolved(name);
        }
        if (!this._ready) {
            return unknown(name);
        }
        const fromEnvironment = this._environment.get(name);
        if (fromEnvironment) {
            return this._resolved(name, 'environment', fromEnvironment);
        }
        const fromCollection = this._collection.get(name);
        if (fromCollection) {
            return this._resolved(name, 'collection', fromCollection);
        }
        return unresolved(name);
    }

    /** @returns {VariableLookup[]} */
    list() {
        const environment = [...this._environment.keys()].sort().map((name) =>
            this._resolved(name, 'environment', this._environment.get(name)));
        const collection = [...this._collection.keys()].sort().map((name) => ({
            ...this._resolved(name, 'collection', this._collection.get(name)),
            shadowed: this._environment.has(name)
        }));
        const dynamic = DYNAMIC_VARIABLES.map(dynamicLookup);
        return [...environment, ...collection, ...dynamic];
    }

    /**
     * @param {string} name
     * @param {'environment'|'collection'} scope
     * @param {{value: string|null, secret: boolean}} entry
     * @returns {VariableLookup}
     */
    _resolved(name, scope, entry) {
        return {
            status: 'resolved',
            name,
            scope,
            value: entry.secret ? null : entry.value,
            secret: entry.secret,
            envName: scope === 'environment' ? this._envName : null
        };
    }

    /**
     * @param {Object|null} environment
     * @param {Object} variables
     * @returns {Map<string, {value: string|null, secret: boolean}>}
     */
    _buildEnvironmentMap(environment, variables) {
        const secretKeys = new Set(Array.isArray(environment?.secretKeys) ? environment.secretKeys : []);
        const map = new Map();
        for (const [name, value] of Object.entries(variables || {})) {
            const secret = secretKeys.has(name);
            map.set(name, { value: secret ? null : stringify(value), secret });
        }
        for (const name of secretKeys) {
            if (!map.has(name)) {
                map.set(name, { value: null, secret: true });
            }
        }
        return map;
    }

    /**
     * @param {Array<{name: string, value: string, secret: boolean}>} entries
     * @returns {Map<string, {value: string|null, secret: boolean}>}
     */
    _buildCollectionMap(entries) {
        const map = new Map();
        for (const item of Array.isArray(entries) ? entries : []) {
            if (!item || typeof item.name !== 'string' || item.name === '') {
                continue;
            }
            const secret = Boolean(item.secret);
            map.set(item.name, { value: secret ? null : stringify(item.value), secret });
        }
        return map;
    }

    /**
     * @param {function(): Promise<*>} work
     * @param {*} fallback
     * @returns {Promise<*>}
     */
    async _safely(work, fallback) {
        try {
            return await work();
        } catch {
            return fallback;
        }
    }

    /** @returns {void} */
    _notify() {
        const event = { type: 'variables-changed', version: this._version };
        this._events.emit(event);
        if (this.eventTarget && typeof CustomEvent === 'function') {
            this.eventTarget.dispatchEvent(new CustomEvent(VARIABLES_CHANGED_EVENT, { detail: { version: this._version } }));
        }
    }
}

/**
 * @param {*} value
 * @returns {string|null}
 */
function stringify(value) {
    if (value === null || value === undefined) {
        return null;
    }
    return typeof value === 'string' ? value : String(value);
}
