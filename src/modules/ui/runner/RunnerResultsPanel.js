/**
 * @fileoverview Results panel for the Collection Runner: the per-request results
 * list, the detail view (body/headers/cookies tabs), the summary, and the
 * draggable resizer. Extracted from RunnerPanel to keep each component focused.
 * @module ui/runner/RunnerResultsPanel
 */

import { app } from '../../appContext.js';
import { templateLoader } from '../../templateLoader.js';
import { escapeHtml, getStatusCodeClass, getStatusText } from './runnerDomUtils.js';

/**
 * Renders and manages the runner results panel docked at the bottom of the
 * runner. It is created lazily on the first run and torn down on reset.
 *
 * @class
 */
export class RunnerResultsPanel {
    /**
     * @param {HTMLElement} container - The runner tab container; the panel is
     *   appended into its `.runner-panel` element and resizes `.runner-main`.
     */
    constructor(container) {
        this.container = container;

        this.panel = null;
        this.resizer = null;
        this.dom = {};

        this.data = [];
        this.selectedIndex = -1;
        this.selectedRequests = [];

        this._isResizing = false;
        this._resizeStartY = 0;
        this._resizeStartHeight = 0;
        this._resizeStartMainHeight = 0;
    }

    /**
     * Opens the results panel, seeding a pending list from the requests about to
     * run. Reuses the existing panel (clearing it) on subsequent runs.
     *
     * @param {Array<Object>} selectedRequests - Requests queued for this run
     */
    open(selectedRequests) {
        this.selectedRequests = selectedRequests || [];

        if (this.panel) {
            this._clear();
            this._initializeResultsList();
            return;
        }

        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-results-panel'
        );

        const runnerPanel = this.container.querySelector('.runner-panel');
        if (!runnerPanel) {return;}

        this.resizer = fragment.querySelector('.runner-results-resizer');
        this.panel = fragment.querySelector('.runner-results-container');

        if (this.resizer) {runnerPanel.appendChild(this.resizer);}
        if (this.panel) {runnerPanel.appendChild(this.panel);}

        this._cacheElements();
        this._attachEventListeners();
        this._attachResizerListeners();
        this._initializeResultsList();

        if (app.i18n && app.i18n.updateUI) {
            app.i18n.updateUI();
        }
    }

    /**
     * Shows final execution results: updates each result item and the summary.
     *
     * @param {Object} results - Execution results
     */
    show(results) {
        if (results.requests) {
            this.data = results.requests;
            results.requests.forEach((result, index) => {
                this._updateResultItem(index, result);
            });
        }

        this._updateSummary(results);
    }

    /**
     * Removes the results panel and resets its state.
     */
    hide() {
        if (this.resizer) {
            this.resizer.remove();
            this.resizer = null;
        }
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
            this.dom = {};
            this.data = [];
            this.selectedIndex = -1;
        }
    }

    /**
     * Marks a request as running in the results panel.
     *
     * @param {number} index - Request index
     */
    markRequestRunning(index) {
        this._updateResultItem(index, { status: 'running' });
    }

    /**
     * Updates a request result, refreshing the detail view if it is selected.
     *
     * @param {number} index - Request index
     * @param {Object} result - Result data including body, headers, cookies
     */
    updateResultWithResponse(index, result) {
        if (this.data[index]) {
            Object.assign(this.data[index], result);
        }
        this._updateResultItem(index, result);

        if (this.selectedIndex === index) {
            this._populateResultDetail(this.data[index]);
        }
    }

    /**
     * Clears the results panel for a new run.
     *
     * @private
     */
    _clear() {
        this.data = [];
        this.selectedIndex = -1;

        if (this.dom.passed) {this.dom.passed.textContent = '0';}
        if (this.dom.failed) {this.dom.failed.textContent = '0';}
        if (this.dom.totalTime) {this.dom.totalTime.textContent = '—';}

        if (this.dom.resultsList) {
            this.dom.resultsList.innerHTML = '';
        }

        if (this.dom.detailMethod) {this.dom.detailMethod.textContent = '';}
        if (this.dom.detailName) {this.dom.detailName.textContent = '';}
        if (this.dom.detailStatus) {
            this.dom.detailStatus.textContent = '';
            this.dom.detailStatus.className = 'runner-results-detail-status';
        }
        if (this.dom.detailTime) {this.dom.detailTime.textContent = '';}
        if (this.dom.bodyContent) {this.dom.bodyContent.textContent = '';}
        if (this.dom.headersBody) {this.dom.headersBody.innerHTML = '';}
        if (this.dom.cookiesBody) {this.dom.cookiesBody.innerHTML = '';}

        if (this.dom.detailPanel) {
            this.dom.detailPanel.classList.add('is-hidden');
        }
    }

    /**
     * Caches DOM references for the results panel.
     *
     * @private
     */
    _cacheElements() {
        if (!this.panel) {return;}

        this.dom = {
            container: this.panel,
            summary: this.panel.querySelector('[data-role="summary"]'),
            passed: this.panel.querySelector('[data-role="passed"]'),
            failed: this.panel.querySelector('[data-role="failed"]'),
            totalTime: this.panel.querySelector('[data-role="total-time"]'),
            resultsList: this.panel.querySelector('[data-role="results-list"]'),
            detailPanel: this.panel.querySelector('[data-role="detail-panel"]'),
            detailMethod: this.panel.querySelector('[data-role="detail-method"]'),
            detailName: this.panel.querySelector('[data-role="detail-name"]'),
            detailStatus: this.panel.querySelector('[data-role="detail-status"]'),
            detailTime: this.panel.querySelector('[data-role="detail-time"]'),
            bodyContent: this.panel.querySelector('[data-role="body-content"]'),
            headersBody: this.panel.querySelector('[data-role="headers-body"]'),
            cookiesBody: this.panel.querySelector('[data-role="cookies-body"]'),
            noCookies: this.panel.querySelector('[data-role="no-cookies"]')
        };
    }

    /**
     * Attaches event listeners for the results panel (tab switching).
     *
     * @private
     */
    _attachEventListeners() {
        if (!this.panel) {return;}

        this.panel.querySelectorAll('.runner-results-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this._switchTab(tab.dataset.tab);
            });
        });
    }

    /**
     * Attaches event listeners for the results panel resizer.
     *
     * @private
     */
    _attachResizerListeners() {
        if (!this.resizer || !this.panel) {return;}

        const runnerMain = this.container.querySelector('.runner-main');
        if (!runnerMain) {return;}

        this.resizer.addEventListener('mousedown', (e) => {
            this._isResizing = true;
            this._resizeStartY = e.clientY;
            this._resizeStartHeight = this.panel.offsetHeight;
            this._resizeStartMainHeight = runnerMain.offsetHeight;

            this.resizer.classList.add('is-dragging');
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'row-resize';

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this._isResizing) {return;}

            const deltaY = this._resizeStartY - e.clientY;
            const newResultsHeight = this._resizeStartHeight + deltaY;
            const newMainHeight = this._resizeStartMainHeight - deltaY;

            const minResultsHeight = 150;
            const maxResultsHeight = window.innerHeight * 0.7;
            const minMainHeight = 200;

            if (newResultsHeight < minResultsHeight || newResultsHeight > maxResultsHeight) {return;}
            if (newMainHeight < minMainHeight) {return;}

            this.panel.style.height = `${newResultsHeight}px`;
            runnerMain.style.flex = `0 0 ${newMainHeight}px`;

            e.preventDefault();
        });

        document.addEventListener('mouseup', () => {
            if (!this._isResizing) {return;}

            this._isResizing = false;
            this.resizer?.classList.remove('is-dragging');
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        });
    }

    /**
     * Initializes the results list with pending items.
     *
     * @private
     */
    _initializeResultsList() {
        if (!this.dom.resultsList) {return;}

        this.dom.resultsList.innerHTML = '';
        this.data = [];

        this.selectedRequests.forEach((request, index) => {
            const resultData = {
                index,
                method: request.method,
                name: request.name,
                status: 'pending',
                statusCode: null,
                time: null,
                body: null,
                headers: null,
                cookies: null
            };
            this.data.push(resultData);

            const el = this._createResultItemElement(resultData, index);
            this.dom.resultsList.appendChild(el);
        });
    }

    /**
     * Creates a result item element.
     *
     * @private
     * @param {Object} result - Result data
     * @param {number} index - Result index
     * @returns {HTMLElement} Result item element
     */
    _createResultItemElement(result, index) {
        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-result-item'
        );

        const el = fragment.firstElementChild;
        el.dataset.index = index;

        const methodEl = el.querySelector('[data-role="method"]');
        if (methodEl) {
            methodEl.textContent = result.method;
            methodEl.dataset.method = result.method;
        }

        const nameEl = el.querySelector('[data-role="name"]');
        if (nameEl) {
            nameEl.textContent = result.name;
        }

        const statusIcon = el.querySelector('[data-role="status-icon"]');
        if (statusIcon) {
            statusIcon.classList.add('is-pending');
        }

        const statusCodeEl = el.querySelector('[data-role="status-code"]');
        if (statusCodeEl) {
            statusCodeEl.style.display = 'none';
        }

        const timeEl = el.querySelector('[data-role="time"]');
        if (timeEl) {
            timeEl.style.display = 'none';
        }

        el.addEventListener('click', () => {
            this._selectResultItem(index);
        });

        return el;
    }

    /**
     * Updates a result item in the results panel.
     *
     * @private
     * @param {number} index - Result index
     * @param {Object} result - Result data
     */
    _updateResultItem(index, result) {
        if (!this.dom.resultsList) {return;}

        const el = this.dom.resultsList.querySelector(`[data-index="${index}"]`);
        if (!el) {return;}

        if (this.data[index]) {
            Object.assign(this.data[index], result);
        }

        const statusIcon = el.querySelector('[data-role="status-icon"]');
        const statusClass =
            result.status === 'success' ? 'is-success' :
            result.status === 'error' ? 'is-error' :
            result.status === 'running' ? 'is-running' : 'is-pending';

        if (statusIcon) {
            statusIcon.classList.remove('is-pending', 'is-running', 'is-success', 'is-error');
            statusIcon.classList.add(statusClass);
        }

        el.classList.remove('is-pending', 'is-running', 'is-success', 'is-error');
        el.classList.add(statusClass);

        const statusCodeEl = el.querySelector('[data-role="status-code"]');
        if (statusCodeEl && result.statusCode != null) {
            statusCodeEl.textContent = result.statusCode;
            statusCodeEl.style.display = '';
            statusCodeEl.dataset.statusClass = getStatusCodeClass(result.statusCode);
        }

        const timeEl = el.querySelector('[data-role="time"]');
        if (timeEl && result.time != null) {
            timeEl.textContent = `${result.time}ms`;
            timeEl.style.display = '';
        }
    }

    /**
     * Selects a result item and shows its details.
     *
     * @private
     * @param {number} index - Result index
     */
    _selectResultItem(index) {
        if (index < 0 || index >= this.data.length) {return;}

        this.selectedIndex = index;

        this.dom.resultsList?.querySelectorAll('.runner-result-item').forEach((el, i) => {
            el.classList.toggle('is-selected', i === index);
        });

        this.dom.detailPanel?.classList.remove('is-hidden');

        this._populateResultDetail(this.data[index]);
    }

    /**
     * Populates the result detail panel.
     *
     * @private
     * @param {Object} result - Result data
     */
    _populateResultDetail(result) {
        if (!result) {return;}

        if (this.dom.detailMethod) {
            this.dom.detailMethod.textContent = result.method;
            this.dom.detailMethod.dataset.method = result.method;
        }

        if (this.dom.detailName) {
            this.dom.detailName.textContent = result.name;
        }

        if (this.dom.detailStatus) {
            const statusText = result.statusCode ? `${result.statusCode} ${getStatusText(result.statusCode)}` : 'Pending';
            this.dom.detailStatus.textContent = statusText;
            this.dom.detailStatus.classList.remove('is-success', 'is-error');
            if (result.status === 'success') {
                this.dom.detailStatus.classList.add('is-success');
            } else if (result.status === 'error') {
                this.dom.detailStatus.classList.add('is-error');
            }
        }

        if (this.dom.detailTime) {
            this.dom.detailTime.textContent = result.time != null ? `${result.time}ms` : '';
        }

        if (this.dom.bodyContent) {
            let bodyText = '';
            if (result.body != null) {
                if (typeof result.body === 'object') {
                    try {
                        bodyText = JSON.stringify(result.body, null, 2);
                    } catch {
                        bodyText = String(result.body);
                    }
                } else {
                    bodyText = String(result.body);
                }
            }
            this.dom.bodyContent.textContent = bodyText || '(No response body)';
        }

        if (this.dom.headersBody) {
            this.dom.headersBody.innerHTML = '';
            const headers = result.headers || {};
            const headerEntries = Object.entries(headers);

            if (headerEntries.length > 0) {
                headerEntries.forEach(([name, value]) => {
                    const row = document.createElement('tr');
                    row.innerHTML = `<td>${escapeHtml(name)}</td><td>${escapeHtml(String(value))}</td>`;
                    this.dom.headersBody.appendChild(row);
                });
            } else {
                const row = document.createElement('tr');
                row.innerHTML = '<td colspan="2" class="runner-table-empty-cell">No headers</td>';
                this.dom.headersBody.appendChild(row);
            }
        }

        if (this.dom.cookiesBody && this.dom.noCookies) {
            this.dom.cookiesBody.innerHTML = '';
            const cookies = result.cookies || [];

            if (cookies.length > 0) {
                this.dom.noCookies.classList.add('is-hidden');
                cookies.forEach(cookie => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${escapeHtml(cookie.name || '')}</td>
                        <td>${escapeHtml(cookie.value || '')}</td>
                        <td>${escapeHtml(cookie.domain || '')}</td>
                        <td>${escapeHtml(cookie.path || '/')}</td>
                    `;
                    this.dom.cookiesBody.appendChild(row);
                });
            } else {
                this.dom.noCookies.classList.remove('is-hidden');
            }
        }
    }

    /**
     * Switches the active tab in the results detail panel.
     *
     * @private
     * @param {string} tabName - Tab name (body, headers, cookies)
     */
    _switchTab(tabName) {
        if (!this.panel) {return;}

        this.panel.querySelectorAll('.runner-results-tab').forEach(tab => {
            tab.classList.toggle('is-active', tab.dataset.tab === tabName);
        });

        this.panel.querySelectorAll('.runner-results-tab-content').forEach(content => {
            content.classList.toggle('is-active', content.dataset.content === tabName);
        });
    }

    /**
     * Updates the results summary.
     *
     * @private
     * @param {Object} results - Results object
     */
    _updateSummary(results) {
        if (this.dom.passed) {
            this.dom.passed.textContent = `${results.passed || 0}`;
        }
        if (this.dom.failed) {
            this.dom.failed.textContent = `${results.failed || 0}`;
        }
        if (this.dom.totalTime) {
            this.dom.totalTime.textContent = `${results.totalTime || 0}ms`;
        }
    }
}
