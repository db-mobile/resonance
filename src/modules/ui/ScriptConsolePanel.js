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
import { templateLoader } from '../templateLoader.js';

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

        container.classList.add('script-console-container');

        const fragment = templateLoader.cloneSync(
            './src/templates/scripts/scriptConsolePanel.html',
            'tpl-script-console-panel'
        );
        container.innerHTML = '';
        container.appendChild(fragment);

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
        const summaryFragment = templateLoader.cloneSync(
            './src/templates/scripts/scriptConsolePanel.html',
            'tpl-script-console-summary'
        );
        const summary = summaryFragment.firstElementChild;
        const summarySlot = summary.querySelector('[data-role="summary"]');
        if (summarySlot) {
            if (total === 0) {
                summarySlot.textContent = 'No tests run';
            } else if (failed === 0) {
                const allPassedFragment = templateLoader.cloneSync(
                    './src/templates/scripts/scriptConsolePanel.html',
                    'tpl-script-console-summary-all-passed'
                );
                const allPassedEl = allPassedFragment.firstElementChild;
                const allPassedTextEl = allPassedEl.querySelector('[data-role="text"]');
                if (allPassedTextEl) {
                    allPassedTextEl.textContent = `✓ All tests passed (${total})`;
                }
                summarySlot.appendChild(allPassedEl);
            } else {
                const mixedFragment = templateLoader.cloneSync(
                    './src/templates/scripts/scriptConsolePanel.html',
                    'tpl-script-console-summary-mixed'
                );
                const mixedEl = mixedFragment;
                const passedEl = mixedEl.querySelector('[data-role="passed"]');
                const failedEl = mixedEl.querySelector('[data-role="failed"]');
                if (passedEl) {passedEl.textContent = `${passed} passed`;}
                if (failedEl) {failedEl.textContent = `${failed} failed`;}
                summarySlot.appendChild(mixedEl);
            }
        }

        content.appendChild(summary);

        // Show test results
        if (result.testResults && result.testResults.length > 0) {
            const testListFragment = templateLoader.cloneSync(
                './src/templates/scripts/scriptConsolePanel.html',
                'tpl-script-console-test-list'
            );
            const testList = testListFragment.firstElementChild;

            result.testResults.forEach(test => {
                const testItemFragment = templateLoader.cloneSync(
                    './src/templates/scripts/scriptConsolePanel.html',
                    'tpl-script-console-test-item'
                );
                const testItem = testItemFragment.firstElementChild;
                testItem.style.setProperty('--script-console-accent', test.passed ? 'var(--color-success, #10b981)' : 'var(--color-error, #ef4444)');

                testItem.classList.toggle('is-passed', test.passed);
                testItem.classList.toggle('is-failed', !test.passed);

                const icon = test.passed ? '✓' : '✗';
                const iconEl = testItem.querySelector('[data-role="icon"]');
                const messageEl = testItem.querySelector('[data-role="message"]');
                if (iconEl) {iconEl.textContent = icon;}
                if (messageEl) {messageEl.textContent = test.message;}

                testList.appendChild(testItem);
            });

            content.appendChild(testList);
        }

        // Show console logs if any
        if (result.logs && result.logs.length > 0) {
            const sepFragment = templateLoader.cloneSync(
                './src/templates/scripts/scriptConsolePanel.html',
                'tpl-script-console-separator'
            );
            const separator = sepFragment.firstElementChild;
            const textEl = separator.querySelector('[data-role="text"]');
            if (textEl) {textEl.textContent = 'Console Output';}
            content.appendChild(separator);

            result.logs.forEach(log => {
                this.appendEntry(content, log.level, log.message, log.timestamp);
            });
        }

        // Show errors if any
        if (result.errors && result.errors.length > 0) {
            const sepFragment = templateLoader.cloneSync(
                './src/templates/scripts/scriptConsolePanel.html',
                'tpl-script-console-separator'
            );
            const separator = sepFragment.firstElementChild;
            separator.classList.add('script-console-separator--error');
            const textEl = separator.querySelector('[data-role="text"]');
            if (textEl) {textEl.textContent = 'Errors';}
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
        const fragment = templateLoader.cloneSync(
            './src/templates/scripts/scriptConsolePanel.html',
            'tpl-script-console-entry'
        );
        const entry = fragment.firstElementChild;

        let icon = 'ℹ';
        let levelClass = 'is-default';

        if (level === 'error') {
            icon = '✗';
            levelClass = 'is-error';
        } else if (level === 'warn') {
            icon = '⚠';
            levelClass = 'is-warn';
        } else if (level === 'info') {
            icon = 'ℹ';
            levelClass = 'is-info';
        }

        entry.classList.add(levelClass);

        const timeStr = new Date(timestamp).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const iconEl = entry.querySelector('[data-role="icon"]');
        const timeEl = entry.querySelector('[data-role="time"]');
        const messageEl = entry.querySelector('[data-role="message"]');
        if (iconEl) {iconEl.textContent = icon;}
        if (timeEl) {timeEl.textContent = timeStr;}
        if (messageEl) {messageEl.textContent = message;}

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

        const fragment = templateLoader.cloneSync(
            './src/templates/scripts/scriptConsolePanel.html',
            'tpl-script-console-empty'
        );
        const emptyEl = fragment.firstElementChild;
        const messageEl = emptyEl.querySelector('[data-role="message"]');
        if (messageEl) {
            messageEl.textContent = 'No script output yet. Console logs and test results will appear here.';
        }
        content.innerHTML = '';
        content.appendChild(emptyEl);
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
        this.container.classList.toggle('is-hidden', !this.isVisible);
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
