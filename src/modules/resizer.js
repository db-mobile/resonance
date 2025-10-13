/**
 * Resizer Module
 * Handles vertical resizing between request and response areas
 * and horizontal resizing between sidebar and main content
 */

export class Resizer {
    constructor() {
        this.isDragging = false;
        this.startY = 0;
        this.startRequestHeight = 0;
        this.startResponseHeight = 0;
        this.minHeight = 100; // Allow more flexible resizing
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
        // Use requestAnimationFrame to ensure DOM is fully rendered and painted
        requestAnimationFrame(() => {
            // Double RAF ensures layout is complete
            requestAnimationFrame(() => {
                this.setInitialHeights();
            });
        });
    }

    setupEventListeners() {
        this.resizerHandle.addEventListener('mousedown', this.startDrag.bind(this));
        document.addEventListener('mousemove', this.drag.bind(this));
        document.addEventListener('mouseup', this.endDrag.bind(this));

        // Prevent text selection during drag
        this.resizerHandle.addEventListener('selectstart', (e) => e.preventDefault());

        // Handle window resize to maintain proportions
        window.addEventListener('resize', this.handleWindowResize.bind(this));
    }

    setInitialHeights() {
        // Set initial heights to allow for proper resizing
        const mainContentHeight = this.mainContentArea.clientHeight;
        const requestBuilder = document.querySelector('.request-builder');
        const requestBuilderHeight = requestBuilder ? requestBuilder.offsetHeight : 0;
        const resizerHeight = this.resizerHandle.offsetHeight;

        const availableHeight = mainContentHeight - requestBuilderHeight - resizerHeight;

        // Ensure we have enough space to work with
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
        // Throttle resize events to avoid excessive recalculations
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }

        this.resizeTimeout = setTimeout(() => {
            const currentRequestHeight = this.requestConfig.offsetHeight;
            const currentResponseHeight = this.responseArea.offsetHeight;

            // Only adjust if heights were previously set
            if (currentRequestHeight === 0 || currentResponseHeight === 0) {
                return;
            }

            // Calculate new available height
            const mainContentHeight = this.mainContentArea.clientHeight;
            const requestBuilder = document.querySelector('.request-builder');
            const requestBuilderHeight = requestBuilder ? requestBuilder.offsetHeight : 0;
            const resizerHeight = this.resizerHandle.offsetHeight;
            const availableHeight = mainContentHeight - requestBuilderHeight - resizerHeight;

            // Calculate current proportion
            const totalCurrentHeight = currentRequestHeight + currentResponseHeight;
            const requestProportion = currentRequestHeight / totalCurrentHeight;

            // Apply same proportion to new available height
            const newRequestHeight = Math.max(this.minHeight, Math.floor(availableHeight * requestProportion));
            const newResponseHeight = Math.max(this.minHeight, availableHeight - newRequestHeight);

            // Update heights
            this.requestConfig.style.height = `${newRequestHeight}px`;
            this.requestConfig.style.flex = `0 0 ${newRequestHeight}px`;
            this.responseArea.style.height = `${newResponseHeight}px`;
            this.responseArea.style.flex = `0 0 ${newResponseHeight}px`;
        }, 100); // Debounce by 100ms
    }

    startDrag(e) {
        const currentRequestHeight = this.requestConfig.offsetHeight;
        const currentResponseHeight = this.responseArea.offsetHeight;

        // If heights aren't set yet, initialize them now and continue with drag
        if (currentRequestHeight === 0 || currentResponseHeight === 0) {
            this.setInitialHeights();
            // Use the newly set heights immediately
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
        if (!this.isDragging) return;

        const deltaY = e.clientY - this.startY;
        const newRequestHeight = this.startRequestHeight + deltaY;
        const newResponseHeight = this.startResponseHeight - deltaY;

        // Enforce minimum heights
        if (newRequestHeight < this.minHeight || newResponseHeight < this.minHeight) {
            return;
        }

        // No need to check max available height since we're redistributing fixed space
        // The sum of newRequestHeight + newResponseHeight should always equal
        // startRequestHeight + startResponseHeight (the total available space)

        this.requestConfig.style.height = `${newRequestHeight}px`;
        this.requestConfig.style.flex = `0 0 ${newRequestHeight}px`;
        this.responseArea.style.height = `${newResponseHeight}px`;
        this.responseArea.style.flex = `0 0 ${newResponseHeight}px`;

        e.preventDefault();
    }

    endDrag() {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        this.resizerHandle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    }

    // Public method to reset to default heights
    reset() {
        this.requestConfig.style.height = '';
        this.requestConfig.style.flexShrink = '';
        this.responseArea.style.height = '';
        this.responseArea.style.flex = '1';
    }
}

/**
 * HorizontalResizer Class
 * Handles horizontal resizing between sidebar and main content area
 */
export class HorizontalResizer {
    constructor() {
        this.isDragging = false;
        this.startX = 0;
        this.startSidebarWidth = 0;
        this.minWidth = 200; // Minimum sidebar width
        this.maxWidth = 600; // Maximum sidebar width

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

        // Prevent text selection during drag
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
        if (!this.isDragging) return;

        const deltaX = e.clientX - this.startX;
        const newSidebarWidth = this.startSidebarWidth + deltaX;

        // Enforce min/max width constraints
        if (newSidebarWidth < this.minWidth || newSidebarWidth > this.maxWidth) {
            return;
        }

        this.sidebar.style.width = `${newSidebarWidth}px`;
        this.sidebar.style.flex = `0 0 ${newSidebarWidth}px`;

        e.preventDefault();
    }

    endDrag() {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.horizontalResizerHandle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    }

    // Public method to reset to default width
    reset() {
        this.sidebar.style.width = '';
        this.sidebar.style.flex = '';
    }
}

// Initialize when DOM is loaded
export function initResizer() {
    const verticalResizer = new Resizer();
    const horizontalResizer = new HorizontalResizer();
    return { verticalResizer, horizontalResizer };
}