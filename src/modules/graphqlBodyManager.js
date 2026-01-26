/**
 * @fileoverview Manages GraphQL body mode including editor lifecycle and mode switching
 * @module graphqlBodyManager
 */

import { GraphQLEditor } from './graphqlEditor.bundle.js';
import { JSONEditor } from './jsonEditor.bundle.js';

export class GraphQLBodyManager {
    constructor(domElements) {
        this.dom = domElements;
        this.graphqlEditor = null;
        this.variablesEditor = null;
        this.currentMode = 'json'; // 'json' or 'graphql'
        this.isGraphQLModeEnabled = false;

        // References to new DOM elements
        this.jsonPanel = document.getElementById('body-json-section');
        this.graphqlPanel = document.getElementById('body-graphql-section');
        this.graphqlEditorContainer = document.getElementById('graphql-query-editor');
        this.graphqlVariablesEditorContainer = document.getElementById('graphql-variables-editor');
        this.formatBtn = document.getElementById('graphql-format-btn');
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
            });
        }

        // Format button
        if (this.formatBtn) {
            this.formatBtn.addEventListener('click', () => {
                if (this.graphqlEditor) {
                    this.graphqlEditor.formatQuery();
                }
            });
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
            });

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
