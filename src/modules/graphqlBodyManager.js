/**
 * @fileoverview Manages GraphQL body mode including editor lifecycle and mode switching
 * @module graphqlBodyManager
 */

import { app } from './appContext.js';
import { GraphQLEditor } from './graphqlEditor.bundle.js';
import { JSONEditor } from './jsonEditor.bundle.js';
import { toast } from './ui/Toast.js';
import { fetchGraphQLIntrospection } from './apiHandler.js';

export class GraphQLBodyManager {
    constructor(domElements) {
        this.dom = domElements;
        this.graphqlEditor = null;
        this.variablesEditor = null;
        this.currentMode = 'json'; // 'json' or 'graphql'
        this.isGraphQLModeEnabled = false;

        // Introspected schema state (in-memory only, keyed by resolved endpoint URL)
        this.schemaCache = new Map();
        this.currentSchema = null;
        this.isFetchingSchema = false;

        // Operation picker state (for documents with multiple named operations)
        this.selectedOperationName = null;

        // References to new DOM elements
        this.jsonPanel = document.getElementById('body-json-section');
        this.graphqlPanel = document.getElementById('body-graphql-section');
        this.graphqlEditorContainer = document.getElementById('graphql-query-editor');
        this.graphqlVariablesEditorContainer = document.getElementById('graphql-variables-editor');
        this.formatBtn = document.getElementById('graphql-format-btn');
        this.fetchSchemaBtn = document.getElementById('graphql-fetch-schema-btn');
        this.operationSelect = document.getElementById('graphql-operation-select');
        this.runBtn = document.getElementById('graphql-run-btn');
        this.docsToggle = document.getElementById('graphql-docs-toggle');
        this.docsRail = document.getElementById('graphql-docs-rail');

        // Workbench drawer (Variables only — Headers is a normal request tab)
        this.drawer = document.getElementById('graphql-drawer');
        this.drawerTabs = document.getElementById('graphql-drawer-tabs');
        this.graphqlResizerHandle = document.getElementById('graphql-resizer-handle');
        this.activeDrawer = 'variables';

        // Method bar, hidden while the Workbench is active (GraphQL is always POST)
        this.methodSelectContainer = document.querySelector('.method-select-container');

        this.workbenchActive = false;
        this.savedMethod = null;
    }

    /**
     * Initialize GraphQL body manager with event listeners
     */
    initialize() {
        // Initialize mode selector dropdown
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

        // Format button
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

        // Fetch schema button
        if (this.fetchSchemaBtn) {
            this.fetchSchemaBtn.addEventListener('click', () => {
                this.fetchSchema();
            });
        }

        // Operation picker (multi-operation documents)
        if (this.operationSelect) {
            this.operationSelect.addEventListener('change', (e) => {
                this.selectedOperationName = e.target.value || null;
            });
        }

        // Drawer tab strip (Variables | Headers) — also opens/collapses the drawer
        if (this.drawerTabs) {
            this.drawerTabs.addEventListener('click', (e) => {
                const tab = e.target.closest('.graphql-drawer-tab');
                if (tab) {
                    this.onDrawerTab(tab.dataset.drawer);
                }
            });
        }

        // Run button — proxy to the main Send so all the request logic is reused
        if (this.runBtn) {
            this.runBtn.addEventListener('click', () => {
                document.getElementById('send-request-btn')?.click();
            });
        }

        // Docs toggle — show/hide the schema docs rail
        if (this.docsToggle) {
            this.docsToggle.addEventListener('click', () => this.toggleDocs());
        }
    }

    /**
     * Handle a click on a drawer tab. Opens the drawer on the requested pane,
     * switches panes when already open, or collapses when the active pane is
     * clicked again. (The drawer currently holds only the Variables pane.)
     * @param {string} which - 'variables'
     */
    onDrawerTab(which) {
        const collapsed = this.drawer.classList.contains('collapsed');
        if (collapsed) {
            this.setDrawerPane(which);
            this.setDrawerCollapsed(false);
        } else if (which === this.activeDrawer) {
            this.setDrawerCollapsed(true);
        } else {
            this.setDrawerPane(which);
        }
    }

    /**
     * Activate a drawer pane (tab highlight + pane visibility).
     * @param {string} which - 'variables'
     */
    setDrawerPane(which) {
        this.activeDrawer = which;
        this.drawerTabs?.querySelectorAll('.graphql-drawer-tab').forEach(tab => {
            const on = tab.dataset.drawer === which;
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', String(on));
        });
        this.drawer?.querySelectorAll('.graphql-drawer-pane').forEach(pane => {
            pane.classList.toggle('active', pane.dataset.drawerPane === which);
        });
        if (which === 'variables') {
            this.variablesEditor?.view?.requestMeasure?.();
        }
    }

    /**
     * Collapse/expand the drawer. Collapsed = just the tab strip, hiding the
     * resize handle so the Query editor keeps all the height.
     * @param {boolean} collapsed
     */
    setDrawerCollapsed(collapsed) {
        if (!this.drawer) {
            return;
        }
        // Drop any inline height set by the resizer so the CSS flex takes over.
        this.drawer.style.flex = '';
        this.drawer.classList.toggle('collapsed', collapsed);
        if (this.graphqlResizerHandle) {
            this.graphqlResizerHandle.style.display = collapsed ? 'none' : '';
        }
        if (!collapsed) {
            this.variablesEditor?.view?.requestMeasure?.();
        }
    }

    /**
     * Toggle the schema docs rail. Renders a lightweight summary of the loaded
     * schema's root fields (the full explorer is a follow-up).
     */
    toggleDocs() {
        if (!this.docsRail) {
            return;
        }
        const show = this.docsRail.style.display === 'none';
        this.docsRail.style.display = show ? '' : 'none';
        this.docsToggle?.setAttribute('aria-pressed', String(show));
        if (show) {
            this.renderDocsRail();
        }
    }

    /**
     * Render a minimal schema overview into the docs rail.
     */
    renderDocsRail() {
        if (!this.docsRail) {
            return;
        }
        if (!this.currentSchema) {
            this.docsRail.innerHTML = '<div class="graphql-docs-empty">Load the schema (Schema button) to browse types.</div>';
            return;
        }
        const sections = [
            ['Query', this.currentSchema.getQueryType?.()],
            ['Mutation', this.currentSchema.getMutationType?.()],
            ['Subscription', this.currentSchema.getSubscriptionType?.()]
        ];
        const html = sections
            .filter(([, type]) => type)
            .map(([label, type]) => {
                const fields = Object.keys(type.getFields())
                    .map(name => `<li>${name}</li>`)
                    .join('');
                return `<section class="graphql-docs-section"><h4>${label}</h4><ul>${fields}</ul></section>`;
            })
            .join('');
        this.docsRail.innerHTML = html || '<div class="graphql-docs-empty">Schema has no root types.</div>';
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
            // Force POST and hide the method dropdown (GraphQL is always POST)
            const methodSelect = document.getElementById('method-select');
            if (methodSelect) {
                this.savedMethod = methodSelect.value;
                methodSelect.value = 'POST';
            }
            if (this.methodSelectContainer) {
                this.methodSelectContainer.style.display = 'none';
            }
            // Reset ephemeral drawer state: closed, Variables tab
            this.setDrawerPane('variables');
            this.setDrawerCollapsed(true);
            window.__verticalResizer?.setRequestBias(0.6);
        } else {
            const methodSelect = document.getElementById('method-select');
            if (methodSelect && this.savedMethod !== null) {
                methodSelect.value = this.savedMethod;
                this.savedMethod = null;
            }
            if (this.methodSelectContainer) {
                this.methodSelectContainer.style.display = '';
            }
            window.__verticalResizer?.setRequestBias(0.4);
            if (this.docsRail) {
                this.docsRail.style.display = 'none';
                this.docsToggle?.setAttribute('aria-pressed', 'false');
            }
        }

        // Let layout settle, then remeasure the editors
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this.graphqlEditor?.view?.requestMeasure?.();
            this.variablesEditor?.view?.requestMeasure?.();
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
        // operations === null means the document is currently unparseable — leave
        // the picker as-is rather than flickering it away on every keystroke.
        if (operations === null) {
            return;
        }

        const named = operations.filter(op => op.name);

        if (named.length <= 1) {
            this.operationSelect.style.display = 'none';
            this.operationSelect.innerHTML = '';
            // A lone named operation is still sent by name via getSelectedOperationName()
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
            const { schema, url, error } = await fetchGraphQLIntrospection();
            if (error) {
                toast.error(error);
                return;
            }
            this.currentSchema = schema;
            if (url) {
                this.schemaCache.set(url, schema);
            }
            this.applySchemaToEditor();
            if (this.docsRail && this.docsRail.style.display !== 'none') {
                this.renderDocsRail();
            }
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
     * Apply the currently held schema to the query editor, if both exist.
     */
    applySchemaToEditor() {
        if (this.graphqlEditor && this.currentSchema) {
            this.graphqlEditor.setSchema(this.currentSchema);
        }
    }

    /**
     * Switch between JSON and GraphQL modes
     * @param {string} mode - 'json' or 'graphql'
     */
    switchMode(mode) {
        this.currentMode = mode;

        // Update dropdown selector
        const modeSelect = document.getElementById('body-mode-select');
        if (modeSelect && modeSelect.value !== mode) {
            modeSelect.value = mode;
        }

        // Update panels
        document.querySelectorAll('.body-mode-panel').forEach(panel => {
            const panelMode = panel.getAttribute('data-mode');
            if (panelMode === mode) {
                panel.classList.add('active');
            } else {
                panel.classList.remove('active');
            }
        });

        // Initialize GraphQL editor if switching to GraphQL mode
        if (mode === 'graphql' && !this.graphqlEditor) {
            this.initializeGraphQLEditor();
        }

        // GraphQL gets the first-class Workbench layout; any other mode tears it down
        this.setWorkbenchActive(mode === 'graphql');
    }

    /**
     * Initialize the GraphQL editors (lazy loading)
     */
    initializeGraphQLEditor() {
        if (!this.graphqlEditorContainer) {
            return;
        }

        if (!this.graphqlVariablesEditorContainer) {
            return;
        }

        try {
            // Initialize query editor with GraphQL syntax highlighting
            this.graphqlEditor = new GraphQLEditor(this.graphqlEditorContainer);

            // Set up auto-save on query change
            this.graphqlEditor.onChange((_content) => {
                this.saveCurrentState();
                this.updateOperationPicker();
            });

            // Re-apply a previously fetched schema so it survives editor re-creation
            this.applySchemaToEditor();

            // Initialize variables editor with JSON syntax highlighting
            this.variablesEditor = new JSONEditor(this.graphqlVariablesEditorContainer);

            // Set up auto-save on variables change
            this.variablesEditor.onChange((_content) => {
                this.saveCurrentState();
            });
        } catch (error) {
            void error;
        }
    }

    /**
     * Set GraphQL query content
     * @param {string} query - GraphQL query string
     */
    setGraphQLQuery(query) {
        if (!this.graphqlEditor) {
            this.initializeGraphQLEditor();
        }
        if (this.graphqlEditor) {
            this.graphqlEditor.setContent(query || '');
        }
    }

    /**
     * Set GraphQL variables content
     * @param {string|object} variables - Variables as JSON string or object
     */
    setGraphQLVariables(variables) {
        if (!this.variablesEditor) {
            this.initializeGraphQLEditor();
        }

        if (this.variablesEditor) {
            const content = typeof variables === 'object'
                ? JSON.stringify(variables, null, 2)
                : (variables || '');

            this.variablesEditor.setContent(content);
        }
    }

    /**
     * Get current GraphQL query
     * @returns {string}
     */
    getGraphQLQuery() {
        return this.graphqlEditor ? this.graphqlEditor.getContent() : '';
    }

    /**
     * Get current GraphQL variables
     * @returns {string}
     */
    getGraphQLVariables() {
        return this.variablesEditor ? this.variablesEditor.getContent() : '';
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
        // This will be called by CollectionService to save modified state
        // Implementation will integrate with existing save mechanisms
    }

    /**
     * Clear all content
     */
    clear() {
        if (this.graphqlEditor) {
            this.graphqlEditor.clear();
        }
        if (this.variablesEditor) {
            this.variablesEditor.clear();
        }
    }

    /**
     * Destroy GraphQL editor instances
     */
    destroy() {
        if (this.graphqlEditor) {
            this.graphqlEditor.clear();
            this.graphqlEditor = null;
        }
        if (this.variablesEditor) {
            this.variablesEditor = null;
        }
    }
}
