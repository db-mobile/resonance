/**
 * @fileoverview Panel for displaying script console output and test results
 * @module ui/ScriptConsolePanel
 */

/**
 * Script console panel for showing logs and test results
 * Displays in the Scripts tab of the response section
 *
 * @class
 * @classdesc Manages console output and test result display
 */
export class ScriptConsolePanel {
    /**
     * Creates a ScriptConsolePanel instance
     * @param {HTMLElement} container - Container element for the panel
     */
    constructor(container) {
        this.container = container;
        this.isVisible = false;
        this.initialize();
    }

    /**
     * Get the active script console container
     * @private
     * @returns {HTMLElement|null} The active container
     */
    _getActiveContainer() {
        // If container was provided in constructor, use it
        if (this.container) {
            return this.container;
        }

        // Otherwise, get the active workspace tab's container
        const containerElements = window.responseContainerManager?.getActiveElements();

        if (containerElements && containerElements.scriptsDisplay) {
            return containerElements.scriptsDisplay;
        }

        // Fallback: find first script console container
        return document.querySelector('.script-console-container');
    }

    /**
     * Initialize the panel structure
     * @private
     */
    initialize() {
        const container = this._getActiveContainer();
        if (!container) {
            return;
        }

        // Check if already initialized (has the structure we need)
        if (container.querySelector('.script-console-header')) {
            return;
        }

        container.style.cssText = `
            padding: 16px;
            background: var(--bg-primary);
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.5;
        `;

        container.innerHTML = `
            <div class="script-console-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border-light);">
                <span style="font-weight: 500; color: var(--text-primary);">Script Console</span>
                <button class="clear-console-btn" style="padding: 4px 12px; background: var(--bg-secondary); border: 1px solid var(--border-light); border-radius: var(--radius-sm); color: var(--text-secondary); cursor: pointer; font-size: 12px;">Clear</button>
            </div>
            <div class="script-console-content" style="color: var(--text-secondary);"></div>
        `;

        // Setup event listener for clear button
        const clearBtn = container.querySelector('.clear-console-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clear());
        }

        // Initially show empty state
        this._showEmptyStateInContainer(container);
    }

    /**
     * Show console logs and errors
     * @param {Array} logs - Array of log entries {level, message, timestamp}
     * @param {Array} errors - Array of error messages
     */
    show(logs, errors) {
        // Always get fresh container reference
        const container = this._getActiveContainer();
        if (!container) {
            return;
        }

        // Ensure container is initialized
        this.initialize();

        const content = container.querySelector('.script-console-content');
        if (!content) {
            return;
        }

        content.innerHTML = '';

        // Show errors first
        if (errors && errors.length > 0) {
            errors.forEach(error => {
                this.appendEntry(content, 'error', error, Date.now());
            });
        }

        // Show logs
        if (logs && logs.length > 0) {
            logs.forEach(log => {
                this.appendEntry(content, log.level, log.message, log.timestamp);
            });
        }

        // If no logs or errors, show empty state
        if ((!logs || logs.length === 0) && (!errors || errors.length === 0)) {
            this.showEmptyState();
        }
    }

    /**
     * Show test results with pass/fail indicators
     * @param {Object} result - Test execution result
     */
    showTestResults(result) {
        // Always get fresh container reference (in case of tab switching)
        const container = this._getActiveContainer();
        if (!container) {
            return;
        }

        // Ensure container is initialized
        this.initialize();

        const content = container.querySelector('.script-console-content');
        if (!content) {
            return;
        }

        content.innerHTML = '';

        // Calculate summary
        const passed = result.testResults.filter(t => t.passed).length;
        const failed = result.testResults.filter(t => !t.passed).length;
        const total = passed + failed;

        // Show summary
        const summary = document.createElement('div');
        summary.style.cssText = `
            margin-bottom: 12px;
            padding: 8px 12px;
            background: var(--bg-secondary);
            border-radius: var(--radius-sm);
            font-weight: 500;
            color: var(--text-primary);
        `;

        if (total === 0) {
            summary.textContent = 'No tests run';
        } else if (failed === 0) {
            summary.innerHTML = `<span style="color: var(--color-success, #10b981);">✓ All tests passed (${total})</span>`;
        } else {
            summary.innerHTML = `<span style="color: var(--color-success, #10b981);">${passed} passed</span>, <span style="color: var(--color-error, #ef4444);">${failed} failed</span>`;
        }

        content.appendChild(summary);

        // Show test results
        if (result.testResults && result.testResults.length > 0) {
            const testList = document.createElement('div');
            testList.style.marginBottom = '12px';

            result.testResults.forEach(test => {
                const testItem = document.createElement('div');
                testItem.style.cssText = `
                    padding: 6px 12px;
                    margin: 4px 0;
                    border-left: 3px solid ${test.passed ? 'var(--color-success, #10b981)' : 'var(--color-error, #ef4444)'};
                    background: var(--bg-secondary);
                `;

                const icon = test.passed ? '<span style="color: var(--color-success, #10b981);">✓</span>' : '<span style="color: var(--color-error, #ef4444);">✗</span>';
                testItem.innerHTML = `${icon} ${this.escapeHtml(test.message)}`;

                testList.appendChild(testItem);
            });

            content.appendChild(testList);
        }

        // Show console logs if any
        if (result.logs && result.logs.length > 0) {
            const separator = document.createElement('div');
            separator.style.cssText = `
                margin: 16px 0 12px;
                padding-bottom: 8px;
                border-bottom: 1px solid var(--border-light);
                font-weight: 500;
                color: var(--text-primary);
            `;
            separator.textContent = 'Console Output';
            content.appendChild(separator);

            result.logs.forEach(log => {
                this.appendEntry(content, log.level, log.message, log.timestamp);
            });
        }

        // Show errors if any
        if (result.errors && result.errors.length > 0) {
            const separator = document.createElement('div');
            separator.style.cssText = `
                margin: 16px 0 12px;
                padding-bottom: 8px;
                border-bottom: 1px solid var(--border-light);
                font-weight: 500;
                color: var(--color-error, #ef4444);
            `;
            separator.textContent = 'Errors';
            content.appendChild(separator);

            result.errors.forEach(error => {
                this.appendEntry(content, 'error', error, Date.now());
            });
        }
    }

    /**
     * Append a log entry to the content
     * @private
     * @param {HTMLElement} content - Content container
     * @param {string} level - Log level (info, warn, error)
     * @param {string} message - Log message
     * @param {number} timestamp - Timestamp
     */
    appendEntry(content, level, message, timestamp) {
        const entry = document.createElement('div');
        entry.style.cssText = `
            padding: 4px 8px;
            margin: 2px 0;
            border-left: 3px solid transparent;
            white-space: pre-wrap;
            word-break: break-word;
            display: flex;
            align-items: baseline;
            gap: 8px;
            font-size: 12px;
        `;

        let color = 'var(--text-secondary)';
        let icon = 'ℹ';
        let borderColor = 'var(--border-light)';

        if (level === 'error') {
            color = 'var(--color-error, #ef4444)';
            borderColor = 'var(--color-error, #ef4444)';
            icon = '✗';
        } else if (level === 'warn') {
            color = 'var(--color-warning, #f59e0b)';
            borderColor = 'var(--color-warning, #f59e0b)';
            icon = '⚠';
        } else if (level === 'info') {
            color = 'var(--color-info, #3b82f6)';
            borderColor = 'var(--color-info, #3b82f6)';
            icon = 'ℹ';
        }

        entry.style.borderLeftColor = borderColor;

        const timeStr = new Date(timestamp).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        entry.innerHTML = `
            <span style="color: ${color}; flex-shrink: 0; width: 16px;">${icon}</span>
            <span style="color: var(--text-tertiary); font-size: 10px; flex-shrink: 0; font-family: monospace;">${timeStr}</span>
            <span style="color: var(--text-secondary); flex: 1;">${this.escapeHtml(message)}</span>
        `;

        content.appendChild(entry);
    }

    /**
     * Show empty state message
     * @private
     */
    showEmptyState() {
        const container = this._getActiveContainer();
        if (!container) {
            return;
        }
        this._showEmptyStateInContainer(container);
    }

    /**
     * Show empty state in a specific container
     * @private
     * @param {HTMLElement} container - The container element
     */
    _showEmptyStateInContainer(container) {
        const content = container.querySelector('.script-console-content');
        if (!content) {
            return;
        }

        content.innerHTML = `
            <div style="text-align: center; padding: 32px; color: var(--text-tertiary);">
                No script output yet. Console logs and test results will appear here.
            </div>
        `;
    }

    /**
     * Clear console output
     */
    clear() {
        this.showEmptyState();
    }

    /**
     * Toggle panel visibility
     */
    toggle() {
        this.isVisible = !this.isVisible;
        this.container.style.display = this.isVisible ? 'block' : 'none';
    }

    /**
     * Escape HTML special characters
     * @private
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
