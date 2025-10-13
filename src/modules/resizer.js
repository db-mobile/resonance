/**
 * Resizer Module
 * Handles vertical resizing between request and response areas
 */

export class Resizer {
    constructor() {
        this.isDragging = false;
        this.startY = 0;
        this.startRequestHeight = 0;
        this.startResponseHeight = 0;
        this.minHeight = 150; // Reduced from 200 to allow more flexibility

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
        // Delay initial height setting to ensure DOM is fully rendered
        setTimeout(() => this.setInitialHeights(), 100);
    }

    setupEventListeners() {
        this.resizerHandle.addEventListener('mousedown', this.startDrag.bind(this));
        document.addEventListener('mousemove', this.drag.bind(this));
        document.addEventListener('mouseup', this.endDrag.bind(this));

        // Prevent text selection during drag
        this.resizerHandle.addEventListener('selectstart', (e) => e.preventDefault());
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

    startDrag(e) {
        const currentRequestHeight = this.requestConfig.offsetHeight;
        const currentResponseHeight = this.responseArea.offsetHeight;

        // If heights aren't set yet, initialize them now
        if (currentRequestHeight === 0 || currentResponseHeight === 0) {
            this.setInitialHeights();
            return; // Don't start drag yet, let user try again
        }

        this.isDragging = true;
        this.startY = e.clientY;
        this.startRequestHeight = currentRequestHeight;
        this.startResponseHeight = currentResponseHeight;

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

// Initialize when DOM is loaded
export function initResizer() {
    return new Resizer();
}