/**
 * @fileoverview Manages GraphQL body mode including editor lifecycle and mode switching
 * @module graphqlBodyManager
 */

import { app } from './appContext.js';
import { loadEditor } from './editorLoader.js';
import { toast } from './ui/Toast.js';
import { debounce } from './utils/debounce.js';
import { fetchGraphQLIntrospection, buildSchemaFromIntrospection } from './apiHandler.js';
import { GraphQLExplorer } from './graphqlExplorer.js';

const SCHEMA_STORE_KEY = 'graphqlSchemaCache';
const SCHEMA_STORE_LIMIT = 50;

export class GraphQLBodyManager {
    constructor(domElements) {
        this.dom = domElements;
        this.graphqlEditor = null;
        this._initializingGql = null;
        this._pendingQuery = null;
        this._variablesString = '';
        this.currentMode = 'json';
        this.isGraphQLModeEnabled = false;

        this.schemaCache = new Map();
        this.currentSchema = null;
        this.isFetchingSchema = false;
        this._autoFetchedUrls = new Set();
        this._debouncedApplySchema = debounce(() => this.autoApplySchemaForUrl(), 500);

        this.selectedOperationName = null;

        this.jsonPanel = document.getElementById('body-json-section');
        this.graphqlPanel = document.getElementById('body-graphql-section');
        this.graphqlEditorContainer = document.getElementById('graphql-query-editor');
        this.formatBtn = document.getElementById('graphql-format-btn');
        this.fetchSchemaBtn = document.getElementById('graphql-fetch-schema-btn');
        this.operationSelect = document.getElementById('graphql-operation-select');
        this.docsToggle = document.getElementById('graphql-docs-toggle');
        this.docsRail = document.getElementById('graphql-docs-rail');
        this.explorerResizerHandle = document.getElementById('graphql-explorer-resizer-handle');
        this.explorer = null;
        this._debouncedRefreshExplorer = debounce(
            (query) => this.explorer?.refreshState(query, this.getGraphQLVariables()),
            200
        );

        this.methodSelectContainer = document.querySelector('.method-select-container');
        this.runnerBtn = document.getElementById('runner-btn');

        this.workbenchActive = false;
        this.savedMethod = null;
    }

    /**
     * Initialize GraphQL body manager with event listeners
     */
    initialize() {
        const modeSelect = document.getElementById('body-mode-select');
        if (modeSelect) {
            modeSelect.addEventListener('change', (e) => {
                const mode = e.target.value;
                this.switchMode(mode);
                if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                    app.workspaceTabController.markCurrentTabModified();
                }
            });
        }

        if (this.formatBtn) {
            this.formatBtn.addEventListener('click', () => {
                if (this.graphqlEditor) {
                    const error = this.graphqlEditor.formatQuery();
                    if (error) {
                        toast.error(`Cannot format invalid GraphQL: ${error.message}`);
                    }
                }
            });
        }

        if (this.fetchSchemaBtn) {
            this.fetchSchemaBtn.addEventListener('click', () => {
                this.fetchSchema();
            });
        }

        if (this.operationSelect) {
            this.operationSelect.addEventListener('change', (e) => {
                this.selectedOperationName = e.target.value || null;
                if (this.isDocsRailOpen()) {
                    this.renderDocsRail();
                }
            });
        }

        if (this.docsToggle) {
            this.docsToggle.addEventListener('click', () => this.toggleDocs());
        }

        document.addEventListener('input', (e) => {
            const id = e.target?.id;
            if (id !== 'url-input' && id !== 'graphql-url-input') {
                return;
            }
            if (!this.isGraphQLMode()) {
                return;
            }
            this._debouncedApplySchema();
        });
    }

    /**
     * Toggle the schema explorer rail (the click-build query tree).
     */
    toggleDocs() {
        if (!this.docsRail) {
            return;
        }
        const show = this.docsRail.style.display === 'none';
        this.docsRail.style.display = show ? '' : 'none';
        if (this.explorerResizerHandle) {
            this.explorerResizerHandle.style.display = show ? '' : 'none';
        }
        this.docsToggle?.setAttribute('aria-pressed', String(show));
        if (show) {
            this.renderDocsRail();
        }
    }

    /**
     * Render the interactive schema explorer into the rail, bound to the query
     * editor: ticking a field rewrites the query, editing the query re-derives
     * the checkbox state (see {@link GraphQLExplorer}).
     */
    renderDocsRail() {
        if (!this.docsRail) {
            return;
        }
        if (!this.explorer) {
            this.explorer = new GraphQLExplorer(this.docsRail);
        }
        this.explorer.render(
            this.currentSchema,
            this.getGraphQLQuery(),
            this.getGraphQLVariables(),
            this.getSelectedOperationName(),
            {
                onQueryChange: (text) => this._onExplorerQueryChange(text),
                onVariablesChange: (json) => this._onExplorerVariablesChange(json)
            }
        );
    }

    /**
     * Whether the explorer rail is currently visible.
     * @returns {boolean}
     */
    isDocsRailOpen() {
        return !!this.docsRail && this.docsRail.style.display !== 'none';
    }

    /**
     * Push a query generated by the explorer into the editor and flag the tab
     * as modified.
     * @param {string} text
     */
    _onExplorerQueryChange(text) {
        this.setGraphQLQuery(text);
        this._markTabModified();
    }

    /**
     * Store variable values the explorer produced (from inline arg inputs).
     * @param {string} json
     */
    _onExplorerVariablesChange(json) {
        this.setGraphQLVariables(json);
    }

    /**
     * Enter or leave the GraphQL Workbench layout. Activated whenever GraphQL is
     * the selected body mode (see switchMode). Forces POST + hides the method
     * dropdown, biases the request/response split toward the query, and moves the
     * Headers list into the drawer. Everything is restored on deactivate.
     * @param {boolean} on
     */
    setWorkbenchActive(on) {
        if (on === this.workbenchActive) {
            return;
        }
        this.workbenchActive = on;
        document.querySelector('.main-content-area')?.classList.toggle('workbench-active', on);

        if (on) {
            const methodSelect = document.getElementById('method-select');
            if (methodSelect) {
                this.savedMethod = methodSelect.value;
                methodSelect.value = 'POST';
            }
            if (this.methodSelectContainer) {
                this.methodSelectContainer.style.display = 'none';
            }
            if (this.runnerBtn) {
                this.runnerBtn.style.display = 'none';
            }
            window.__verticalResizer?.setRequestBias(0.6);
            if (this.docsRail) {
                this.docsRail.style.display = '';
                this.docsToggle?.setAttribute('aria-pressed', 'true');
            }
            if (this.explorerResizerHandle) {
                this.explorerResizerHandle.style.display = '';
            }
            this.renderDocsRail();
        } else {
            const methodSelect = document.getElementById('method-select');
            if (methodSelect && this.savedMethod !== null) {
                methodSelect.value = this.savedMethod;
                this.savedMethod = null;
            }
            if (this.methodSelectContainer) {
                this.methodSelectContainer.style.display = '';
            }
            if (this.runnerBtn) {
                this.runnerBtn.style.display = '';
            }
            window.__verticalResizer?.setRequestBias(0.4);
            if (this.docsRail) {
                this.docsRail.style.display = 'none';
                this.docsToggle?.setAttribute('aria-pressed', 'false');
            }
            if (this.explorerResizerHandle) {
                this.explorerResizerHandle.style.display = 'none';
            }
        }

        requestAnimationFrame(() => requestAnimationFrame(() => {
            this.graphqlEditor?.view?.requestMeasure?.();
        }));
    }

    /**
     * Re-parse the query and refresh the operation picker. The picker is only
     * shown when the document defines more than one named operation. Keeps the
     * current selection if it still exists, otherwise defaults to the first.
     */
    updateOperationPicker() {
        if (!this.operationSelect) {
            return;
        }

        const operations = this.graphqlEditor ? this.graphqlEditor.getOperations() : [];
        if (operations === null) {
            return;
        }

        const named = operations.filter(op => op.name);

        if (named.length <= 1) {
            this.operationSelect.style.display = 'none';
            this.operationSelect.innerHTML = '';
            this.selectedOperationName = named.length === 1 ? named[0].name : null;
            return;
        }

        const names = named.map(op => op.name);
        if (!names.includes(this.selectedOperationName)) {
            this.selectedOperationName = names[0];
        }

        this.operationSelect.innerHTML = names
            .map(name => `<option value="${name}">${name}</option>`)
            .join('');
        this.operationSelect.value = this.selectedOperationName;
        this.operationSelect.style.display = '';
    }

    /**
     * Resolve the operationName to send with the request.
     * @returns {string|null} The selected/sole operation name, or null when the
     *   document has no named operation (anonymous or empty).
     */
    getSelectedOperationName() {
        const operations = this.graphqlEditor ? this.graphqlEditor.getOperations() : [];
        if (!operations || operations.length === 0) {
            return null;
        }
        const named = operations.filter(op => op.name);
        if (named.length === 0) {
            return null;
        }
        if (named.length === 1) {
            return named[0].name;
        }
        return named.some(op => op.name === this.selectedOperationName)
            ? this.selectedOperationName
            : named[0].name;
    }

    /**
     * Fetch the GraphQL schema for the current endpoint via introspection and
     * apply it to the query editor for autocomplete, validation and hover docs.
     */
    async fetchSchema() {
        if (this.isFetchingSchema) {
            return;
        }
        this.isFetchingSchema = true;
        if (this.fetchSchemaBtn) {
            this.fetchSchemaBtn.disabled = true;
        }

        try {
            const cacheKey = this._getCurrentUrl();
            const { schema, introspection, error } = await fetchGraphQLIntrospection();
            if (error) {
                toast.error(error);
                return;
            }
            this.currentSchema = schema;
            if (cacheKey) {
                this.schemaCache.set(cacheKey, schema);
                this._autoFetchedUrls.add(cacheKey);
                if (introspection) {
                    this._saveSchemaToStore(cacheKey, introspection);
                }
            }
            this.applySchemaToEditor();
            toast.success('Schema loaded');
        } catch (e) {
            toast.error(`Failed to fetch schema: ${e.message || e}`);
        } finally {
            this.isFetchingSchema = false;
            if (this.fetchSchemaBtn) {
                this.fetchSchemaBtn.disabled = false;
            }
        }
    }

    /**
     * Apply the currently held schema to the query editor, if both exist, and
     * refresh the explorer so it reflects the schema (or its absence).
     */
    applySchemaToEditor() {
        if (this.graphqlEditor && this.currentSchema) {
            this.graphqlEditor.setSchema(this.currentSchema);
        }
        this._refreshExplorerIfOpen();
    }

    /**
     * Re-render the explorer rail when it is visible.
     */
    _refreshExplorerIfOpen() {
        if (this.isDocsRailOpen()) {
            this.renderDocsRail();
        }
    }

    /**
     * Read the current endpoint URL. In GraphQL mode the shared `#url-input`
     * remains the source of truth (the visible `#graphql-url-input` mirrors it).
     * @returns {string} The trimmed URL, or '' when unavailable.
     */
    _getCurrentUrl() {
        return document.getElementById('url-input')?.value?.trim() || '';
    }

    /**
     * Load the persisted per-URL introspection cache from the backend store.
     * @returns {Promise<Object>} A `{ [url]: introspectionJson }` map (possibly empty).
     */
    async _loadSchemaStore() {
        try {
            const store = await window.backendAPI?.store?.get(SCHEMA_STORE_KEY);
            return store && typeof store === 'object' ? store : {};
        } catch (_e) {
            return {};
        }
    }

    /**
     * Persist a raw introspection result keyed by URL, capped to the most-recent
     * {@link SCHEMA_STORE_LIMIT} endpoints (LRU by re-insertion order).
     * @param {string} url
     * @param {object} introspection - The serializable `data` of an introspection query.
     */
    async _saveSchemaToStore(url, introspection) {
        if (!url || !introspection || !window.backendAPI?.store) {
            return;
        }
        try {
            const store = await this._loadSchemaStore();
            delete store[url];
            store[url] = introspection;
            const keys = Object.keys(store);
            let toSave = store;
            if (keys.length > SCHEMA_STORE_LIMIT) {
                toSave = {};
                keys.slice(keys.length - SCHEMA_STORE_LIMIT).forEach((k) => {
                    toSave[k] = store[k];
                });
            }
            await window.backendAPI.store.set(SCHEMA_STORE_KEY, toSave);
        } catch (_e) {
            void _e;
        }
    }

    /**
     * Apply the best available schema for the given (or current) URL to the editor:
     * in-memory cache → persisted store → silent background introspection.
     * Keeps autocomplete current without forcing the user to click Schema.
     * @param {string} [url] - Defaults to the current endpoint URL.
     */
    async autoApplySchemaForUrl(url) {
        const targetUrl = (url || this._getCurrentUrl()).trim();
        if (!targetUrl) {
            return;
        }

        if (this.schemaCache.has(targetUrl)) {
            this.currentSchema = this.schemaCache.get(targetUrl);
            this.applySchemaToEditor();
            return;
        }

        const store = await this._loadSchemaStore();
        const introspection = store[targetUrl];
        if (introspection) {
            const schema = buildSchemaFromIntrospection(introspection);
            if (schema) {
                this.schemaCache.set(targetUrl, schema);
                this.currentSchema = schema;
                this.applySchemaToEditor();
                return;
            }
        }

        this.currentSchema = null;
        this.graphqlEditor?.clearSchema?.();
        this._refreshExplorerIfOpen();
        this._backgroundIntrospect(targetUrl);
    }

    /**
     * Fetch and cache the schema for a URL without surfacing toasts. Runs at most
     * once per URL and only for absolute http(s) endpoints.
     * @param {string} targetUrl
     */
    async _backgroundIntrospect(targetUrl) {
        if (this.isFetchingSchema || this._autoFetchedUrls.has(targetUrl)) {
            return;
        }
        if (!/^https?:\/\//i.test(targetUrl)) {
            return;
        }
        this.isFetchingSchema = true;
        try {
            const { schema, introspection, error } = await fetchGraphQLIntrospection();
            if (error || !schema) {
                return;
            }
            if (this._getCurrentUrl() !== targetUrl) {
                return;
            }
            this.schemaCache.set(targetUrl, schema);
            this.currentSchema = schema;
            if (introspection) {
                this._saveSchemaToStore(targetUrl, introspection);
            }
            this.applySchemaToEditor();
        } catch (_e) {
            void _e;
        } finally {
            this.isFetchingSchema = false;
            this._autoFetchedUrls.add(targetUrl);
        }
    }

    /**
     * Switch between JSON and GraphQL modes
     * @param {string} mode - 'json' or 'graphql'
     */
    switchMode(mode) {
        this.currentMode = mode;

        const modeSelect = document.getElementById('body-mode-select');
        if (modeSelect && modeSelect.value !== mode) {
            modeSelect.value = mode;
        }

        document.querySelectorAll('.body-mode-panel').forEach(panel => {
            const panelMode = panel.getAttribute('data-mode');
            if (panelMode === mode) {
                panel.classList.add('active');
            } else {
                panel.classList.remove('active');
            }
        });

        if (mode === 'graphql' && !this.graphqlEditor) {
            this.initializeGraphQLEditor();
        }

        // The plain-text editor is lazy; mount it when its panel becomes active
        // so the Text body mode actually shows an input.
        if (mode === 'text') {
            app.requestBodyTextEditor?.ensure?.();
        }

        this.setWorkbenchActive(mode === 'graphql');

        if (mode === 'graphql') {
            this.autoApplySchemaForUrl();
        }
    }

    /**
     * Initialize the GraphQL editors (lazy loading). The editor bundles are
     * dynamically imported, so this is async; concurrent callers share one
     * in-flight initialization. Any content buffered via {@link setGraphQLQuery}
     * or {@link setGraphQLVariables} before the editors exist is applied *before*
     * change listeners attach, so restoring a tab never marks it modified.
     * @returns {Promise<void>}
     */
    initializeGraphQLEditor() {
        if (this.graphqlEditor) {
            return Promise.resolve();
        }
        if (this._initializingGql) {
            return this._initializingGql;
        }
        if (!this.graphqlEditorContainer) {
            return Promise.resolve();
        }

        this._initializingGql = (async () => {
            try {
                const GraphQLEditor = await loadEditor('graphql');

                this.graphqlEditor = new GraphQLEditor(this.graphqlEditorContainer);
                if (this._pendingQuery !== null) {
                    this.graphqlEditor.setContent(this._pendingQuery);
                    this._pendingQuery = null;
                }
                this.graphqlEditor.onChange((content) => {
                    this.saveCurrentState();
                    this.updateOperationPicker();
                    this._markTabModified();
                    if (this.isDocsRailOpen()) {
                        this._debouncedRefreshExplorer(content);
                    }
                });

                this.applySchemaToEditor();
            } catch (error) {
                void error;
            }
        })();

        return this._initializingGql;
    }

    /**
     * Set GraphQL query content
     * @param {string} query - GraphQL query string
     */
    setGraphQLQuery(query) {
        if (this.graphqlEditor) {
            this.graphqlEditor.setContent(query || '');
        } else {
            this._pendingQuery = query || '';
            this.initializeGraphQLEditor();
        }
    }

    /**
     * Set GraphQL variables content. Variables have no pane of their own — values
     * are entered inline in the Explorer — so they are held as a plain JSON string
     * that persistence and the request builder read via {@link getGraphQLVariables}.
     * @param {string|object} variables - Variables as JSON string or object
     */
    setGraphQLVariables(variables) {
        const content = typeof variables === 'object'
            ? JSON.stringify(variables, null, 2)
            : (variables || '');
        if (content === this._variablesString) {
            return;
        }
        this._variablesString = content;
        this._markTabModified();
    }

    /**
     * Get current GraphQL query
     * @returns {string}
     */
    getGraphQLQuery() {
        if (this.graphqlEditor) {
            return this.graphqlEditor.getContent();
        }
        return this._pendingQuery || '';
    }

    /**
     * Get current GraphQL variables
     * @returns {string}
     */
    getGraphQLVariables() {
        return this._variablesString || '';
    }

    /**
     * Get current mode
     * @returns {string} 'json' or 'graphql'
     */
    getCurrentMode() {
        return this.currentMode;
    }

    /**
     * Enable GraphQL mode for current endpoint
     * @param {boolean} enable
     */
    setGraphQLModeEnabled(enable) {
        this.isGraphQLModeEnabled = enable;
        if (enable) {
            this.switchMode('graphql');
        } else {
            this.switchMode('json');
        }
    }

    /**
     * Check if GraphQL mode is enabled
     * @returns {boolean}
     */
    isGraphQLMode() {
        return this.currentMode === 'graphql';
    }

    /**
     * Save current state (placeholder - will integrate with CollectionRepository)
     */
    async saveCurrentState() {
    }

    /**
     * Flag the active workspace tab as having unsaved changes, unless the change
     * originates from tab state restoration (where editor content is set programmatically).
     * @private
     */
    _markTabModified() {
        if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
            app.workspaceTabController.markCurrentTabModified();
        }
    }

    /**
     * Clear all content
     */
    clear() {
        this._pendingQuery = null;
        this._variablesString = '';
        if (this.graphqlEditor) {
            this.graphqlEditor.clear();
        }
    }

    /**
     * Destroy GraphQL editor instances
     */
    destroy() {
        this._pendingQuery = null;
        this._variablesString = '';
        this._initializingGql = null;
        if (this.graphqlEditor) {
            this.graphqlEditor.clear();
            this.graphqlEditor = null;
        }
    }
}
