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
        const mainContentHeight = this.mainContentArea.clientHeight;
        const requestBuilder = document.querySelector('.request-builder');
        const requestBuilderHeight = requestBuilder ? requestBuilder.offsetHeight : 0;
        const resizerHeight = this.resizerHandle.offsetHeight;

        const availableHeight = mainContentHeight - requestBuilderHeight - resizerHeight;

        if (availableHeight < this.minHeight * 2) {
            return;
        }

        const initialRequestHeight = Math.max(this.minHeight, Math.floor(availableHeight * 0.4));
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

        this.init();
    }

    init() {
        this.horizontalResizerHandle = document.getElementById('horizontal-resizer-handle');
        this.sidebar = document.querySelector('.collections-sidebar');

        if (!this.horizontalResizerHandle || !this.sidebar) {
            return;
        }

        this.setupEventListeners();
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
    }

    reset() {
        this.sidebar.style.width = '';
        this.sidebar.style.flex = '';
    }
}

export function initResizer() {
    const verticalResizer = new Resizer();
    const horizontalResizer = new HorizontalResizer();
    return { verticalResizer, horizontalResizer };
}