import { app } from './appContext.js';
import { debounce } from './utils/debounce.js';

const SPLIT_LAYOUTS = Object.freeze({
    stacked: { axis: 'y', minSize: 100, defaultRatio: 0.4 },
    'side-by-side': { axis: 'x', minSize: 360, defaultRatio: 0.5 }
});

/**
 * @param {string} layout
 * @param {number} width
 * @param {number} handleSize
 * @returns {string}
 */
export function effectiveLayout(layout, width, handleSize) {
    if (layout !== 'side-by-side') {
        return 'stacked';
    }
    return width >= SPLIT_LAYOUTS['side-by-side'].minSize * 2 + handleSize ? 'side-by-side' : 'stacked';
}

/**
 * @param {number} available
 * @param {number} ratio
 * @param {number} minSize
 * @returns {{request: number, response: number}|null}
 */
export function splitSizes(available, ratio, minSize) {
    if (available < minSize * 2) {
        return null;
    }
    const request = Math.min(available - minSize, Math.max(minSize, Math.floor(available * ratio)));
    return { request, response: available - request };
}

let activeResizer = null;
let requestBiasOverride = null;

/** @param {number} fraction */
export function setRequestBias(fraction) {
    requestBiasOverride = fraction;
    activeResizer?._applyRatio(fraction);
}

export function resetRequestBias() {
    requestBiasOverride = null;
    activeResizer?._applyRatio(activeResizer._savedRatio());
}

class Resizer {
    /** @param {import('./layoutManager.js').LayoutManager|null} layoutManager */
    constructor(layoutManager = null) {
        this.layoutManager = layoutManager;
        this.isDragging = false;
        this.startPos = 0;
        this.startRequestSize = 0;
        this.startResponseSize = 0;
        this.effective = null;
        this.ratios = {};
        this.resizeTimeout = null;
        this._debouncedSave = debounce((ratios) => {
            window.backendAPI.store.set('requestSplit', ratios).catch((error) => void error);
        }, 300);

        this.init();
    }

    init() {
        this.resizerHandle = document.getElementById('resizer-handle');
        this.split = document.getElementById('request-split');
        this.requestConfig = document.querySelector('.request-config');
        this.responseArea = document.querySelector('.response-area');

        if (!this.resizerHandle || !this.split || !this.requestConfig || !this.responseArea) {
            return;
        }

        activeResizer = this;
        this.setupEventListeners();
        this.layoutManager?.addChangeListener(() => this.applyLayout());
        Promise.all([this._restoreRatios(), this.layoutManager?.ready]).finally(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => this.applyLayout());
            });
        });
    }

    async _restoreRatios() {
        try {
            const saved = await window.backendAPI.store.get('requestSplit');
            if (saved && typeof saved === 'object') {
                for (const layout of Object.keys(SPLIT_LAYOUTS)) {
                    if (typeof saved[layout] === 'number' && saved[layout] > 0 && saved[layout] < 1) {
                        this.ratios[layout] = saved[layout];
                    }
                }
            }
        } catch (error) {
            void error;
        }
    }

    setupEventListeners() {
        this.resizerHandle.addEventListener('mousedown', this.startDrag.bind(this));
        document.addEventListener('mousemove', this.drag.bind(this));
        document.addEventListener('mouseup', this.endDrag.bind(this));

        this.resizerHandle.addEventListener('selectstart', (e) => e.preventDefault());

        window.addEventListener('resize', this.handleWindowResize.bind(this));
    }

    /** @returns {{axis: string, minSize: number, defaultRatio: number}} */
    _config() {
        return SPLIT_LAYOUTS[this.effective ?? 'stacked'];
    }

    /** @returns {number} */
    _savedRatio() {
        return this.ratios[this.effective] ?? this._config().defaultRatio;
    }

    /** @returns {number} */
    _targetRatio() {
        return requestBiasOverride ?? this._savedRatio();
    }

    applyLayout() {
        const preferred = this.layoutManager?.getLayout() ?? 'stacked';
        const handleThickness = Math.min(this.resizerHandle.offsetWidth, this.resizerHandle.offsetHeight);
        const next = effectiveLayout(preferred, this.split.clientWidth, handleThickness);
        if (next !== this.effective) {
            this.effective = next;
            this.split.dataset.layoutEffective = next;
            const horizontal = next === 'side-by-side';
            this.resizerHandle.classList.toggle('pane-resizer-col', horizontal);
            this.resizerHandle.classList.toggle('pane-resizer-row', !horizontal);
            for (const pane of [this.requestConfig, this.responseArea]) {
                pane.style.height = '';
                pane.style.width = '';
                pane.style.flex = '';
            }
        }
        this._applyRatio(this._targetRatio());
    }

    /** @param {number} fraction */
    _applyRatio(fraction) {
        const sizes = splitSizes(this._availableSize(), fraction, this._config().minSize);
        if (sizes) {
            this._applySizes(sizes.request, sizes.response);
        }
    }

    /** @returns {number} */
    _availableSize() {
        return this._config().axis === 'x'
            ? this.split.clientWidth - this.resizerHandle.offsetWidth
            : this.split.clientHeight - this.resizerHandle.offsetHeight;
    }

    /** @returns {[number, number]} */
    _currentSizes() {
        return this._config().axis === 'x'
            ? [this.requestConfig.offsetWidth, this.responseArea.offsetWidth]
            : [this.requestConfig.offsetHeight, this.responseArea.offsetHeight];
    }

    /**
     * @param {number} requestSize
     * @param {number} responseSize
     * @returns {void}
     */
    _applySizes(requestSize, responseSize) {
        const prop = this._config().axis === 'x' ? 'width' : 'height';
        this.requestConfig.style[prop] = `${requestSize}px`;
        this.requestConfig.style.flex = `0 0 ${requestSize}px`;
        this.responseArea.style[prop] = `${responseSize}px`;
        this.responseArea.style.flex = `0 0 ${responseSize}px`;
    }

    handleWindowResize() {
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }

        this.resizeTimeout = setTimeout(() => {
            const before = this.effective;
            const [request, response] = this._currentSizes();
            this.applyLayout();
            if (before === this.effective && request > 0 && response > 0) {
                this._applyRatio(request / (request + response));
            }
        }, 100);
    }

    startDrag(e) {
        const [request, response] = this._currentSizes();
        if (request === 0 || response === 0) {
            this._applyRatio(this._targetRatio());
        }
        [this.startRequestSize, this.startResponseSize] = this._currentSizes();

        this.isDragging = true;
        this.startPos = this._config().axis === 'x' ? e.clientX : e.clientY;

        this.resizerHandle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = this._config().axis === 'x' ? 'col-resize' : 'row-resize';

        e.preventDefault();
    }

    drag(e) {
        if (!this.isDragging) {return;}

        const delta = (this._config().axis === 'x' ? e.clientX : e.clientY) - this.startPos;
        const newRequestSize = this.startRequestSize + delta;
        const newResponseSize = this.startResponseSize - delta;
        const { minSize } = this._config();

        if (newRequestSize < minSize || newResponseSize < minSize) {
            return;
        }

        this._applySizes(newRequestSize, newResponseSize);

        e.preventDefault();
    }

    endDrag() {
        if (!this.isDragging) {return;}

        this.isDragging = false;
        this.resizerHandle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        const [request, response] = this._currentSizes();
        if (request > 0 && response > 0) {
            const ratio = request / (request + response);
            if (requestBiasOverride !== null) {
                requestBiasOverride = ratio;
            } else {
                this.ratios[this.effective] = ratio;
                this._debouncedSave({ ...this.ratios });
            }
        }
    }
}

class HorizontalResizer {
    constructor() {
        this.isDragging = false;
        this.startX = 0;
        this.startSidebarWidth = 0;
        this.minWidth = 200;
        this.maxWidth = 600;
        this._debouncedSave = debounce((width) => {
            window.backendAPI.store.set('sidebarWidth', width).catch((error) => void error);
        }, 300);

        this.init();
    }

    init() {
        this.horizontalResizerHandle = document.getElementById('horizontal-resizer-handle');
        this.sidebar = document.querySelector('.collections-sidebar');

        if (!this.horizontalResizerHandle || !this.sidebar) {
            return;
        }

        this.setupEventListeners();
        this._restoreWidth();
    }

    async _restoreWidth() {
        try {
            const saved = await window.backendAPI.store.get('sidebarWidth');
            if (saved && saved >= this.minWidth && saved <= this.maxWidth) {
                this.sidebar.style.width = `${saved}px`;
                this.sidebar.style.flex = `0 0 ${saved}px`;
            }
        } catch (error) {
            void error;
        }
    }

    _saveWidth(width) {
        this._debouncedSave(width);
    }

    setupEventListeners() {
        this.horizontalResizerHandle.addEventListener('mousedown', this.startDrag.bind(this));
        document.addEventListener('mousemove', this.drag.bind(this));
        document.addEventListener('mouseup', this.endDrag.bind(this));

        this.horizontalResizerHandle.addEventListener('selectstart', (e) => e.preventDefault());
    }

    startDrag(e) {
        this.isDragging = true;
        this.startX = e.clientX;
        this.startSidebarWidth = this.sidebar.offsetWidth;

        this.horizontalResizerHandle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';

        e.preventDefault();
    }

    drag(e) {
        if (!this.isDragging) {return;}

        const deltaX = e.clientX - this.startX;
        const newSidebarWidth = this.startSidebarWidth + deltaX;

        if (newSidebarWidth < this.minWidth || newSidebarWidth > this.maxWidth) {
            return;
        }

        this.sidebar.style.width = `${newSidebarWidth}px`;
        this.sidebar.style.flex = `0 0 ${newSidebarWidth}px`;

        e.preventDefault();
    }

    endDrag() {
        if (!this.isDragging) {return;}

        this.isDragging = false;
        this.horizontalResizerHandle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        this._saveWidth(this.sidebar.offsetWidth);
    }

    reset() {
        this.sidebar.style.width = '';
        this.sidebar.style.flex = '';
    }
}

class GraphQLEditorResizer {
    constructor() {
        this.isDragging = false;
        this.startY = 0;
        this.startVariablesHeight = 0;
        this.minSize = 60;

        this.init();
    }

    init() {
        this.handle = document.getElementById('graphql-resizer-handle');
        this.querySection = document.querySelector('.graphql-query-section');
        this.variablesSection = document.querySelector('.graphql-variables-section');

        if (!this.handle || !this.querySection || !this.variablesSection) {
            return;
        }

        this.handle.addEventListener('mousedown', this.startDrag.bind(this));
        document.addEventListener('mousemove', this.drag.bind(this));
        document.addEventListener('mouseup', this.endDrag.bind(this));
        this.handle.addEventListener('selectstart', (e) => e.preventDefault());
    }

    startDrag(e) {
        this.isDragging = true;
        this.startY = e.clientY;
        this.startVariablesHeight = this.variablesSection.offsetHeight;

        this.handle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'row-resize';

        e.preventDefault();
    }

    drag(e) {
        if (!this.isDragging) {return;}

        const deltaY = e.clientY - this.startY;
        const newVariablesHeight = this.startVariablesHeight - deltaY;

        const container = this.variablesSection.parentElement;
        const maxHeight = container.clientHeight - this.handle.offsetHeight - this.minSize;

        if (newVariablesHeight < this.minSize || newVariablesHeight > maxHeight) {
            return;
        }

        this.variablesSection.style.flex = `0 0 ${newVariablesHeight}px`;

        e.preventDefault();
    }

    endDrag() {
        if (!this.isDragging) {return;}

        this.isDragging = false;
        this.handle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        app.graphqlBodyManager?.graphqlEditor?.view?.requestMeasure?.();
        app.graphqlBodyManager?.variablesEditor?.view?.requestMeasure?.();
    }
}

class GraphQLExplorerResizer {
    constructor() {
        this.isDragging = false;
        this.startX = 0;
        this.startWidth = 0;
        this.minWidth = 240;
        this.maxWidth = 600;
        this._debouncedSave = debounce((width) => {
            window.backendAPI.store.set('graphqlExplorerWidth', width).catch((error) => void error);
        }, 300);

        this.init();
    }

    init() {
        this.handle = document.getElementById('graphql-explorer-resizer-handle');
        this.rail = document.getElementById('graphql-docs-rail');

        if (!this.handle || !this.rail) {
            return;
        }

        this.handle.addEventListener('mousedown', this.startDrag.bind(this));
        document.addEventListener('mousemove', this.drag.bind(this));
        document.addEventListener('mouseup', this.endDrag.bind(this));
        this.handle.addEventListener('selectstart', (e) => e.preventDefault());
        this._restoreWidth();
    }

    async _restoreWidth() {
        try {
            const saved = await window.backendAPI.store.get('graphqlExplorerWidth');
            if (saved && saved >= this.minWidth && saved <= this.maxWidth) {
                this.rail.style.flex = `0 0 ${saved}px`;
            }
        } catch (error) {
            void error;
        }
    }

    startDrag(e) {
        this.isDragging = true;
        this.startX = e.clientX;
        this.startWidth = this.rail.offsetWidth;

        this.handle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';

        e.preventDefault();
    }

    drag(e) {
        if (!this.isDragging) {return;}

        const deltaX = e.clientX - this.startX;
        const newWidth = this.startWidth - deltaX;

        if (newWidth < this.minWidth || newWidth > this.maxWidth) {
            return;
        }

        this.rail.style.flex = `0 0 ${newWidth}px`;

        e.preventDefault();
    }

    endDrag() {
        if (!this.isDragging) {return;}

        this.isDragging = false;
        this.handle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        this._debouncedSave(this.rail.offsetWidth);
        app.graphqlBodyManager?.graphqlEditor?.view?.requestMeasure?.();
    }
}

/** @param {import('./layoutManager.js').LayoutManager|null} [layoutManager] */
export function initResizer(layoutManager = null) {
    const verticalResizer = new Resizer(layoutManager);
    const horizontalResizer = new HorizontalResizer();
    const graphqlEditorResizer = new GraphQLEditorResizer();
    const graphqlExplorerResizer = new GraphQLExplorerResizer();
    return { verticalResizer, horizontalResizer, graphqlEditorResizer, graphqlExplorerResizer };
}