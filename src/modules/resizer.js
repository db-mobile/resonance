import { app } from './appContext.js';
import { debounce } from './utils/debounce.js';
import { startDragSession } from './ui/dragSession.js';

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
        this.startPos = 0;
        this.startRequestSize = 0;
        this.startResponseSize = 0;
        this.effective = null;
        this.ratios = {};
        this._debouncedSave = debounce((ratios) => {
            window.backendAPI.store.set('requestSplit', ratios).catch(() => {});
        }, 300);
        this.handleWindowResize = debounce(() => this._refitToWindow(), 100);

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
        } catch {}
    }

    setupEventListeners() {
        this.resizerHandle.addEventListener('mousedown', this.startDrag.bind(this));
        this.resizerHandle.addEventListener('selectstart', (e) => e.preventDefault());

        window.addEventListener('resize', this.handleWindowResize);
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

    _refitToWindow() {
        const before = this.effective;
        const [request, response] = this._currentSizes();
        this.applyLayout();
        if (before === this.effective && request > 0 && response > 0) {
            this._applyRatio(request / (request + response));
        }
    }

    startDrag(e) {
        const [request, response] = this._currentSizes();
        if (request === 0 || response === 0) {
            this._applyRatio(this._targetRatio());
        }
        [this.startRequestSize, this.startResponseSize] = this._currentSizes();
        this.startPos = this._config().axis === 'x' ? e.clientX : e.clientY;

        startDragSession({
            handle: this.resizerHandle,
            cursor: this._config().axis === 'x' ? 'col-resize' : 'row-resize',
            onMove: (event) => this.drag(event),
            onEnd: () => this.endDrag()
        });

        e.preventDefault();
    }

    drag(e) {
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

/** Initialize one of the fixed-width panes; direction follows its anchored edge. */
async function initWidthResizer({ handleId, paneSelector, storageKey, minWidth, direction, applyWidth, onEnd }) {
    const handle = document.getElementById(handleId);
    const pane = document.querySelector(paneSelector);
    if (!handle || !pane) {return;}

    const save = debounce((width) => {
        window.backendAPI.store.set(storageKey, width).catch(() => {});
    }, 300);

    handle.addEventListener('mousedown', (event) => {
        const startX = event.clientX;
        const startWidth = pane.offsetWidth;
        startDragSession({
            handle,
            cursor: 'col-resize',
            onMove: (move) => {
                const width = startWidth + direction * (move.clientX - startX);
                if (width < minWidth || width > 600) {return;}
                applyWidth(pane, width);
                move.preventDefault();
            },
            onEnd: () => {
                save(pane.offsetWidth);
                onEnd?.();
            }
        });
        event.preventDefault();
    });
    handle.addEventListener('selectstart', (event) => event.preventDefault());

    try {
        const saved = await window.backendAPI.store.get(storageKey);
        if (saved && saved >= minWidth && saved <= 600) {
            applyWidth(pane, saved);
        }
    } catch {}
}

/** @param {import('./layoutManager.js').LayoutManager|null} [layoutManager] */
export function initResizer(layoutManager = null) {
    new Resizer(layoutManager);
    initWidthResizer({
        handleId: 'horizontal-resizer-handle',
        paneSelector: '.collections-sidebar',
        storageKey: 'sidebarWidth',
        minWidth: 200,
        direction: 1,
        applyWidth: (pane, width) => {
            pane.style.width = `${width}px`;
            pane.style.flex = `0 0 ${width}px`;
        }
    });
    initWidthResizer({
        handleId: 'graphql-explorer-resizer-handle',
        paneSelector: '#graphql-docs-rail',
        storageKey: 'graphqlExplorerWidth',
        minWidth: 240,
        direction: -1,
        applyWidth: (pane, width) => { pane.style.flex = `0 0 ${width}px`; },
        onEnd: () => app.graphqlBodyManager?.graphqlEditor?.view?.requestMeasure?.()
    });
}
