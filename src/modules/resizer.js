export class Resizer {
    constructor() {
        this.isDragging = false;
        this.startY = 0;
        this.startRequestHeight = 0;
        this.startResponseHeight = 0;
        this.minHeight = 100;
        this.resizeTimeout = null;

        this.init();
    }

    init() {
        this.resizerHandle = document.getElementById('resizer-handle');
        this.requestConfig = document.querySelector('.request-config');
        this.responseArea = document.querySelector('.response-area');
        this.mainContentArea = document.querySelector('.main-content-area');

        if (!this.resizerHandle || !this.requestConfig || !this.responseArea || !this.mainContentArea) {
            return;
        }

        this.setupEventListeners();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.setInitialHeights();
            });
        });
    }

    setupEventListeners() {
        this.resizerHandle.addEventListener('mousedown', this.startDrag.bind(this));
        document.addEventListener('mousemove', this.drag.bind(this));
        document.addEventListener('mouseup', this.endDrag.bind(this));

        this.resizerHandle.addEventListener('selectstart', (e) => e.preventDefault());

        window.addEventListener('resize', this.handleWindowResize.bind(this));
    }

    setInitialHeights() {
        this.setRequestBias(0.4);
    }

    /**
     * Split the request/response area so the request-config gets `fraction` of the
     * available height. Used for the default 40/60 split and to bias toward the
     * request side (e.g. the GraphQL Workbench wants more room for the query).
     * @param {number} fraction - Portion of available height for `.request-config` (0–1)
     */
    setRequestBias(fraction) {
        const mainContentHeight = this.mainContentArea.clientHeight;
        const requestBuilder = document.querySelector('.request-builder');
        const requestBuilderHeight = requestBuilder ? requestBuilder.offsetHeight : 0;
        const resizerHeight = this.resizerHandle.offsetHeight;

        const availableHeight = mainContentHeight - requestBuilderHeight - resizerHeight;

        if (availableHeight < this.minHeight * 2) {
            return;
        }

        const initialRequestHeight = Math.max(this.minHeight, Math.floor(availableHeight * fraction));
        const initialResponseHeight = Math.max(this.minHeight, availableHeight - initialRequestHeight);

        this.requestConfig.style.height = `${initialRequestHeight}px`;
        this.requestConfig.style.flex = `0 0 ${initialRequestHeight}px`;
        this.responseArea.style.height = `${initialResponseHeight}px`;
        this.responseArea.style.flex = `0 0 ${initialResponseHeight}px`;
    }

    handleWindowResize() {
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }

        this.resizeTimeout = setTimeout(() => {
            const currentRequestHeight = this.requestConfig.offsetHeight;
            const currentResponseHeight = this.responseArea.offsetHeight;

            if (currentRequestHeight === 0 || currentResponseHeight === 0) {
                return;
            }

            const mainContentHeight = this.mainContentArea.clientHeight;
            const requestBuilder = document.querySelector('.request-builder');
            const requestBuilderHeight = requestBuilder ? requestBuilder.offsetHeight : 0;
            const resizerHeight = this.resizerHandle.offsetHeight;
            const availableHeight = mainContentHeight - requestBuilderHeight - resizerHeight;

            const totalCurrentHeight = currentRequestHeight + currentResponseHeight;
            const requestProportion = currentRequestHeight / totalCurrentHeight;

            const newRequestHeight = Math.max(this.minHeight, Math.floor(availableHeight * requestProportion));
            const newResponseHeight = Math.max(this.minHeight, availableHeight - newRequestHeight);

            this.requestConfig.style.height = `${newRequestHeight}px`;
            this.requestConfig.style.flex = `0 0 ${newRequestHeight}px`;
            this.responseArea.style.height = `${newResponseHeight}px`;
            this.responseArea.style.flex = `0 0 ${newResponseHeight}px`;
        }, 100);
    }

    startDrag(e) {
        const currentRequestHeight = this.requestConfig.offsetHeight;
        const currentResponseHeight = this.responseArea.offsetHeight;

        if (currentRequestHeight === 0 || currentResponseHeight === 0) {
            this.setInitialHeights();
            this.startRequestHeight = this.requestConfig.offsetHeight;
            this.startResponseHeight = this.responseArea.offsetHeight;
        } else {
            this.startRequestHeight = currentRequestHeight;
            this.startResponseHeight = currentResponseHeight;
        }

        this.isDragging = true;
        this.startY = e.clientY;

        this.resizerHandle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'row-resize';

        e.preventDefault();
    }

    drag(e) {
        if (!this.isDragging) {return;}

        const deltaY = e.clientY - this.startY;
        const newRequestHeight = this.startRequestHeight + deltaY;
        const newResponseHeight = this.startResponseHeight - deltaY;

        if (newRequestHeight < this.minHeight || newResponseHeight < this.minHeight) {
            return;
        }

        this.requestConfig.style.height = `${newRequestHeight}px`;
        this.requestConfig.style.flex = `0 0 ${newRequestHeight}px`;
        this.responseArea.style.height = `${newResponseHeight}px`;
        this.responseArea.style.flex = `0 0 ${newResponseHeight}px`;

        e.preventDefault();
    }

    endDrag() {
        if (!this.isDragging) {return;}
        
        this.isDragging = false;
        this.resizerHandle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    }

    reset() {
        this.requestConfig.style.height = '';
        this.requestConfig.style.flexShrink = '';
        this.responseArea.style.height = '';
        this.responseArea.style.flex = '1';
    }
}

export class HorizontalResizer {
    constructor() {
        this.isDragging = false;
        this.startX = 0;
        this.startSidebarWidth = 0;
        this.minWidth = 200;
        this.maxWidth = 600;
        this._saveTimer = null;

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
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            window.backendAPI.store.set('sidebarWidth', width).catch((error) => void error);
        }, 300);
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

export class HistoryResizer {
    constructor() {
        this.isDragging = false;
        this.startX = 0;
        this.startSidebarWidth = 0;
        this.minWidth = 200;
        this.maxWidth = 600;
        this._saveTimer = null;

        this.init();
    }

    init() {
        this.resizerHandle = document.getElementById('history-resizer-handle');
        this.sidebar = document.querySelector('.history-sidebar');

        if (!this.resizerHandle || !this.sidebar) {
            return;
        }

        this.setupEventListeners();
        this._restoreWidth();
    }

    async _restoreWidth() {
        try {
            const saved = await window.backendAPI.store.get('historySidebarWidth');
            if (saved && saved >= this.minWidth && saved <= this.maxWidth) {
                this.sidebar.style.width = `${saved}px`;
                this.sidebar.style.flex = `0 0 ${saved}px`;
            }
        } catch (error) {
            void error;
        }
    }

    _saveWidth(width) {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            window.backendAPI.store.set('historySidebarWidth', width).catch((error) => void error);
        }, 300);
    }

    setupEventListeners() {
        this.resizerHandle.addEventListener('mousedown', this.startDrag.bind(this));
        document.addEventListener('mousemove', this.drag.bind(this));
        document.addEventListener('mouseup', this.endDrag.bind(this));

        this.resizerHandle.addEventListener('selectstart', (e) => e.preventDefault());
    }

    startDrag(e) {
        this.isDragging = true;
        this.startX = e.clientX;
        this.startSidebarWidth = this.sidebar.offsetWidth;

        this.resizerHandle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';

        e.preventDefault();
    }

    drag(e) {
        if (!this.isDragging) {return;}

        // History sidebar is on the right, so dragging left increases width
        const deltaX = e.clientX - this.startX;
        const newSidebarWidth = this.startSidebarWidth - deltaX;

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
        this.resizerHandle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        this._saveWidth(this.sidebar.offsetWidth);
    }

    reset() {
        this.sidebar.style.width = '';
        this.sidebar.style.flex = '';
    }
}

/**
 * Resizes the GraphQL Query / Variables split. The query section grows to fill
 * remaining space (flex: 1 1 0); dragging adjusts the variables pane's height.
 */
export class GraphQLEditorResizer {
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

        // Dragging up (negative delta) grows the variables pane
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

        // CodeMirror needs to re-measure after its container changes height
        window.graphqlBodyManager?.graphqlEditor?.view?.requestMeasure?.();
        window.graphqlBodyManager?.variablesEditor?.view?.requestMeasure?.();
    }
}

export function initResizer() {
    const verticalResizer = new Resizer();
    const horizontalResizer = new HorizontalResizer();
    const historyResizer = new HistoryResizer();
    const graphqlEditorResizer = new GraphQLEditorResizer();
    // Expose the vertical resizer so the GraphQL Workbench can bias the request/
    // response split (and restore it) when entering/leaving GraphQL mode.
    window.__verticalResizer = verticalResizer;
    return { verticalResizer, horizontalResizer, historyResizer, graphqlEditorResizer };
}