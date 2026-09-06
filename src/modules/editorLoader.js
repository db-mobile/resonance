/**
 * @fileoverview Lazy loader for the CodeMirror-based editor bundles.
 * @module editorLoader
 */

/** @type {Record<string, () => Promise<Function>>} */
const importers = {
    requestBody: () => import('./requestBodyEditor.bundle.js').then((m) => m.RequestBodyEditor),
    response: () => import('./responseEditor.bundle.js').then((m) => m.ResponseEditor),
    json: () => import('./jsonEditor.bundle.js').then((m) => m.JSONEditor),
    graphql: () => import('./graphqlEditor.bundle.js').then((m) => m.GraphQLEditor),
    script: () => import('./scriptEditor.bundle.js').then((m) => m.ScriptEditor),
    schema: () => import('./schemaEditor.bundle.js').then((m) => m.SchemaEditor)
};

/** @type {Record<string, Promise<Function>>} */
const cache = {};

/**
 * @param {'requestBody'|'response'|'json'|'graphql'} kind
 * @returns {Promise<Function>}
 */
export function loadEditor(kind) {
    if (!importers[kind]) {
        return Promise.reject(new Error(`Unknown editor kind: ${kind}`));
    }
    if (!cache[kind]) {
        cache[kind] = importers[kind]();
    }
    return cache[kind];
}

/** @returns {void} */
export function warmEditors() {
    loadEditor('requestBody');
    loadEditor('response');
}

/** @type {Set<string>} */
const PASSTHROUGH_PROPS = new Set(['currentLanguage', 'view', 'changeCallback', 'then']);

/**
 * @param {'requestBody'|'response'|'json'|'graphql'} kind
 * @param {HTMLElement} container
 * @param {Array<*>} [ctorArgs=[]]
 * @returns {object}
 */
export function createLazyEditorProxy(kind, container, ctorArgs = []) {
    /** @type {object|null} */
    let real = null;
    let destroyed = false;
    let lastContent = '';
    /** @type {Array<{method: string, args: Array<*>}>} */
    const queue = [];

    const ready = loadEditor(kind).then((EditorClass) => {
        if (destroyed) {
            return null;
        }
        real = new EditorClass(container, ...ctorArgs);
        for (const call of queue) {
            const fn = real[call.method];
            if (typeof fn === 'function') {
                fn.apply(real, call.args);
            }
        }
        queue.length = 0;
        return real;
    });

    return new Proxy(Object.create(null), {
        get(_target, prop) {
            if (prop === '__ready') {
                return ready;
            }
            if (prop === '__instance') {
                return real;
            }
            if (real) {
                const value = real[prop];
                return typeof value === 'function' ? value.bind(real) : value;
            }
            if (prop === 'getContent') {
                return () => lastContent;
            }
            if (prop === 'destroy') {
                return () => {
                    destroyed = true;
                    queue.length = 0;
                };
            }
            if (typeof prop !== 'string' || PASSTHROUGH_PROPS.has(prop)) {
                return undefined;
            }
            return (...args) => {
                if (prop === 'setContent') {
                    lastContent = args[0] ?? '';
                } else if (prop === 'clear') {
                    lastContent = '';
                }
                queue.push({ method: prop, args });
            };
        }
    });
}
