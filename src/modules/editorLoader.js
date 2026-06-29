/**
 * @fileoverview Lazy loader for the CodeMirror-based editor bundles.
 * @module editorLoader
 *
 * The editor bundles share a single large CodeMirror chunk (~640 KB). Importing
 * any of them statically pulls that chunk onto the startup parse path even though
 * editors are only instantiated on demand. This module loads each bundle via a
 * cached dynamic `import()` so the CodeMirror chunk stays off the boot critical
 * path, and {@link warmEditors} pre-fetches the common ones during idle time.
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
 * Dynamically import an editor class, caching the in-flight/resolved promise so
 * each bundle is fetched at most once.
 *
 * @param {'requestBody'|'response'|'json'|'graphql'} kind - Which editor to load.
 * @returns {Promise<Function>} Resolves with the editor constructor.
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

/**
 * Pre-fetch the editors most likely to be needed first (request body + response)
 * so the first user interaction doesn't pay the bundle download/parse cost.
 * Safe to call multiple times; loads are cached.
 *
 * @returns {void}
 */
export function warmEditors() {
    loadEditor('requestBody');
    loadEditor('response');
}

/**
 * Non-function properties that callers read directly off an editor instance.
 * Before the real editor exists the proxy must return `undefined` for these
 * (rather than a method-recording stub), so reads like `editor.currentLanguage`
 * behave sanely.
 * @type {Set<string>}
 */
const PASSTHROUGH_PROPS = new Set(['currentLanguage', 'view', 'changeCallback', 'then']);

/**
 * Create a stand-in for an editor whose bundle is still loading.
 *
 * The returned object exposes the editor's full API synchronously: method calls
 * made before the real editor exists are recorded and replayed (in order) once
 * the bundle resolves and the instance is constructed. `getContent()` returns the
 * last content handed to `setContent`/`clear` so reads work pre-load too.
 *
 * @param {'requestBody'|'response'|'json'|'graphql'} kind - Editor bundle to load.
 * @param {HTMLElement} container - Mount point passed to the editor constructor.
 * @param {Array<*>} [ctorArgs=[]] - Extra constructor arguments after `container`.
 * @returns {object} A proxy exposing the editor API; `__ready` resolves with the
 *   real instance (or null if destroyed before load).
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
