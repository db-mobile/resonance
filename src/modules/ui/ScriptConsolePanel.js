/**
 * @fileoverview Panel for displaying script console output and test results
 * @module ui/ScriptConsolePanel
 */

import { app } from '../appContext.js';
import { templateLoader } from '../templateLoader.js';

const TEMPLATE_PATH = './src/templates/scripts/scriptConsolePanel.html';

/** @type {Readonly<Object<string, {icon: string, className: string}>>} */
const ENTRY_LEVELS = Object.freeze({
    error: { icon: '✗', className: 'is-error' },
    warn: { icon: '⚠', className: 'is-warn' },
    info: { icon: 'ℹ', className: 'is-info' }
});

const DEFAULT_ENTRY_LEVEL = Object.freeze({ icon: 'ℹ', className: 'is-default' });

/**
 * @param {string} templateId
 * @returns {DocumentFragment}
 */
function cloneTemplate(templateId) {
    return templateLoader.cloneSync(TEMPLATE_PATH, templateId);
}

export class ScriptConsolePanel {
    /** @param {HTMLElement} container */
    constructor(container) {
        this.container = container;
        this.initialize();
    }

    /** @returns {HTMLElement|null} */
    _getActiveContainer() {
        if (this.container) {
            return this.container;
        }

        const containerElements = app.responseContainerManager?.getActiveElements();

        if (containerElements && containerElements.scriptsDisplay) {
            return containerElements.scriptsDisplay;
        }

        return document.querySelector('.script-console-container');
    }

    initialize() {
        const container = this._getActiveContainer();
        if (!container) {
            return;
        }

        if (container.querySelector('.script-console-header')) {
            return;
        }

        container.classList.add('script-console-container');

        container.innerHTML = '';
        container.appendChild(cloneTemplate('tpl-script-console-panel'));

        const clearBtn = container.querySelector('.clear-console-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clear());
        }

        this._showEmptyStateInContainer(container);
    }

    /** @returns {HTMLElement|null} */
    _resetContent() {
        const container = this._getActiveContainer();
        if (!container) {
            return null;
        }

        this.initialize();

        const content = container.querySelector('.script-console-content');
        if (!content) {
            return null;
        }

        content.innerHTML = '';
        return content;
    }

    /**
     * @param {Array} logs
     * @param {Array} errors
     */
    show(logs, errors) {
        const content = this._resetContent();
        if (!content) {
            return;
        }

        if (errors && errors.length > 0) {
            errors.forEach(error => {
                this.appendEntry(content, 'error', error, Date.now());
            });
        }

        if (logs && logs.length > 0) {
            logs.forEach(log => {
                this.appendEntry(content, log.level, log.message, log.timestamp);
            });
        }

        if ((!logs || logs.length === 0) && (!errors || errors.length === 0)) {
            this.showEmptyState();
        }
    }

    /** @param {Object} result */
    showTestResults(result) {
        const content = this._resetContent();
        if (!content) {
            return;
        }

        content.appendChild(this._createSummary(result.testResults));

        if (result.testResults && result.testResults.length > 0) {
            content.appendChild(this._createTestList(result.testResults));
        }

        if (result.logs && result.logs.length > 0) {
            this._appendSection(content, 'Console Output', null, result.logs.map(log => [log.level, log.message, log.timestamp]));
        }

        if (result.errors && result.errors.length > 0) {
            this._appendSection(content, 'Errors', 'script-console-separator--error', result.errors.map(error => ['error', error, Date.now()]));
        }
    }

    /**
     * @param {Array<{passed: boolean}>} testResults
     * @returns {HTMLElement}
     */
    _createSummary(testResults) {
        const passed = testResults.filter(t => t.passed).length;
        const failed = testResults.filter(t => !t.passed).length;
        const total = passed + failed;

        const summary = cloneTemplate('tpl-script-console-summary').firstElementChild;
        const summarySlot = summary.querySelector('[data-role="summary"]');
        if (!summarySlot) {
            return summary;
        }

        if (total === 0) {
            summarySlot.textContent = 'No tests run';
        } else if (failed === 0) {
            const allPassedEl = cloneTemplate('tpl-script-console-summary-all-passed').firstElementChild;
            const allPassedTextEl = allPassedEl.querySelector('[data-role="text"]');
            if (allPassedTextEl) {
                allPassedTextEl.textContent = `✓ All tests passed (${total})`;
            }
            summarySlot.appendChild(allPassedEl);
        } else {
            const mixedFragment = cloneTemplate('tpl-script-console-summary-mixed');
            const passedEl = mixedFragment.querySelector('[data-role="passed"]');
            const failedEl = mixedFragment.querySelector('[data-role="failed"]');
            if (passedEl) {passedEl.textContent = `${passed} passed`;}
            if (failedEl) {failedEl.textContent = `${failed} failed`;}
            summarySlot.appendChild(mixedFragment);
        }
        return summary;
    }

    /**
     * @param {Array<{passed: boolean, message: string}>} testResults
     * @returns {HTMLElement}
     */
    _createTestList(testResults) {
        const testList = cloneTemplate('tpl-script-console-test-list').firstElementChild;

        testResults.forEach(test => {
            const testItem = cloneTemplate('tpl-script-console-test-item').firstElementChild;
            testItem.style.setProperty('--script-console-accent', test.passed ? 'var(--color-success, #10b981)' : 'var(--color-error, #ef4444)');

            testItem.classList.toggle('is-passed', test.passed);
            testItem.classList.toggle('is-failed', !test.passed);

            const iconEl = testItem.querySelector('[data-role="icon"]');
            const messageEl = testItem.querySelector('[data-role="message"]');
            if (iconEl) {iconEl.textContent = test.passed ? '✓' : '✗';}
            if (messageEl) {messageEl.textContent = test.message;}

            testList.appendChild(testItem);
        });

        return testList;
    }

    /**
     * @param {HTMLElement} content
     * @param {string} title
     * @param {string|null} separatorClass
     * @param {Array<[string, string, number]>} entries
     * @returns {void}
     */
    _appendSection(content, title, separatorClass, entries) {
        const separator = cloneTemplate('tpl-script-console-separator').firstElementChild;
        if (separatorClass) {
            separator.classList.add(separatorClass);
        }
        const textEl = separator.querySelector('[data-role="text"]');
        if (textEl) {textEl.textContent = title;}
        content.appendChild(separator);

        entries.forEach(([level, message, timestamp]) => {
            this.appendEntry(content, level, message, timestamp);
        });
    }

    /**
     * @param {HTMLElement} content
     * @param {string} level
     * @param {string} message
     * @param {number} timestamp
     */
    appendEntry(content, level, message, timestamp) {
        const entry = cloneTemplate('tpl-script-console-entry').firstElementChild;
        const { icon, className } = ENTRY_LEVELS[level] ?? DEFAULT_ENTRY_LEVEL;

        entry.classList.add(className);

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

    showEmptyState() {
        const container = this._getActiveContainer();
        if (!container) {
            return;
        }
        this._showEmptyStateInContainer(container);
    }

    /** @param {HTMLElement} container */
    _showEmptyStateInContainer(container) {
        const content = container.querySelector('.script-console-content');
        if (!content) {
            return;
        }

        const emptyEl = cloneTemplate('tpl-script-console-empty').firstElementChild;
        const messageEl = emptyEl.querySelector('[data-role="message"]');
        if (messageEl) {
            messageEl.textContent = 'No script output yet. Console logs and test results will appear here.';
        }
        content.innerHTML = '';
        content.appendChild(emptyEl);
    }

    clear() {
        this.showEmptyState();
    }
}
