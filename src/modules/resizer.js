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
        this.minHeight = 200;
        
        this.init();
    }

    init() {
        this.resizerHandle = document.getElementById('resizer-handle');
        this.requestConfig = document.querySelector('.request-config');
        this.responseArea = document.querySelector('.response-area');
        this.mainContentArea = document.querySelector('.main-content-area');
        
        if (!this.resizerHandle || !this.requestConfig || !this.responseArea || !this.mainContentArea) {
            console.warn('Resizer: Required elements not found', {
                resizerHandle: !!this.resizerHandle,
                requestConfig: !!this.requestConfig,
                responseArea: !!this.responseArea,
                mainContentArea: !!this.mainContentArea
            });
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
            console.warn('Resizer: Not enough space for resizing', { availableHeight, minHeight: this.minHeight });
            return;
        }
        
        const initialRequestHeight = Math.max(this.minHeight, Math.floor(availableHeight * 0.4));
        const initialResponseHeight = Math.max(this.minHeight, availableHeight - initialRequestHeight);
        
        this.requestConfig.style.height = `${initialRequestHeight}px`;
        this.requestConfig.style.flexShrink = '0';
        this.responseArea.style.height = `${initialResponseHeight}px`;
        this.responseArea.style.flex = 'none';
    }

    startDrag(e) {
        this.isDragging = true;
        this.startY = e.clientY;
        this.startRequestHeight = this.requestConfig.offsetHeight;
        this.startResponseHeight = this.responseArea.offsetHeight;
        
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
        
        // Calculate maximum available height
        const maxAvailableHeight = this.mainContentArea.clientHeight - 
                                  document.querySelector('.request-builder').offsetHeight - 
                                  this.resizerHandle.offsetHeight;
        
        if (newRequestHeight + newResponseHeight > maxAvailableHeight) {
            return;
        }
        
        this.requestConfig.style.height = `${newRequestHeight}px`;
        this.responseArea.style.height = `${newResponseHeight}px`;
        
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