/**
 * @fileoverview Manages UI mode switching between HTTP and gRPC requests
 * @module modules/requestModeManager
 */

import { setResponseTabsForProtocol } from './tabManager.js';

/**
 * Request protocol modes
 * @enum {string}
 */
export const RequestMode = {
    HTTP: 'http',
    GRPC: 'grpc'
};

/**
 * Current request mode
 * @type {string}
 */
let currentMode = RequestMode.HTTP;

/**
 * HTTP-specific tab IDs that should be hidden in gRPC mode
 * @type {string[]}
 */
const HTTP_ONLY_TABS = ['path-params', 'query-params', 'headers', 'body'];

/**
 * gRPC-specific tab IDs that should be hidden in HTTP mode
 * @type {string[]}
 */
const GRPC_ONLY_TABS = ['grpc', 'grpc-message', 'grpc-metadata'];

/**
 * Tabs shared between HTTP and gRPC modes
 * @type {string[]}
 */
const SHARED_TABS = ['authorization'];

/**
 * HTTP-only shared tabs (like scripts, not needed for gRPC)
 * @type {string[]}
 */
const HTTP_SHARED_TABS = ['scripts'];

/**
 * Get the current request mode
 * @returns {string}
 */
export function getCurrentMode() {
    return currentMode;
}

/**
 * Check if current mode is gRPC
 * @returns {boolean}
 */
export function isGrpcMode() {
    return currentMode === RequestMode.GRPC;
}

/**
 * Check if current mode is HTTP
 * @returns {boolean}
 */
export function isHttpMode() {
    return currentMode === RequestMode.HTTP;
}

/**
 * Set the request mode and update UI accordingly
 * @param {string} mode - The mode to set (RequestMode.HTTP or RequestMode.GRPC)
 */
export function setRequestMode(mode) {
    if (mode !== RequestMode.HTTP && mode !== RequestMode.GRPC) {
        console.warn(`Invalid request mode: ${mode}, defaulting to HTTP`);
        mode = RequestMode.HTTP;
    }
    
    currentMode = mode;
    updateUIForMode(mode);
    
    // Update response tabs for the current protocol
    setResponseTabsForProtocol(mode);
}

/**
 * Update UI elements based on the current mode
 * @param {string} mode
 */
function updateUIForMode(mode) {
    const methodSelectContainer = document.querySelector('.method-select-container');
    const urlInput = document.getElementById('url-input');
    const curlBtn = document.getElementById('curl-btn');
    
    // Get all request config tab buttons
    const tabButtons = document.querySelectorAll('.request-config .tab-nav .tab-button');
    
    if (mode === RequestMode.GRPC) {
        // Hide HTTP-specific URL section elements
        if (methodSelectContainer) {
            methodSelectContainer.style.display = 'none';
        }
        if (urlInput) {
            urlInput.style.display = 'none';
        }
        if (curlBtn) {
            curlBtn.style.display = 'none';
        }
        
        // Show gRPC target input in URL section
        showGrpcUrlSection(true);
        
        // Update tab visibility - show gRPC tabs, hide HTTP-only tabs
        tabButtons.forEach(btn => {
            const tabId = btn.dataset.tab;
            if (HTTP_ONLY_TABS.includes(tabId) || HTTP_SHARED_TABS.includes(tabId)) {
                btn.style.display = 'none';
            } else if (GRPC_ONLY_TABS.includes(tabId) || SHARED_TABS.includes(tabId)) {
                btn.style.display = '';
            }
        });
        
        // Activate gRPC tab if current tab is HTTP-only
        const activeTab = document.querySelector('.request-config .tab-nav .tab-button.active');
        if (!activeTab || HTTP_ONLY_TABS.includes(activeTab.dataset.tab)) {
            activateTab('grpc');
        }
        
    } else {
        // Show HTTP-specific URL section elements
        if (methodSelectContainer) {
            methodSelectContainer.style.display = '';
        }
        if (urlInput) {
            urlInput.style.display = '';
        }
        if (curlBtn) {
            curlBtn.style.display = '';
        }
        
        // Hide gRPC target input from URL section
        showGrpcUrlSection(false);
        
        // Update tab visibility - show HTTP tabs, hide gRPC-only tabs
        tabButtons.forEach(btn => {
            const tabId = btn.dataset.tab;
            if (GRPC_ONLY_TABS.includes(tabId)) {
                btn.style.display = 'none';
            } else if (HTTP_ONLY_TABS.includes(tabId) || SHARED_TABS.includes(tabId) || HTTP_SHARED_TABS.includes(tabId)) {
                btn.style.display = '';
            }
        });
        
        // Activate path-params tab if current tab is gRPC-only
        const activeTab = document.querySelector('.request-config .tab-nav .tab-button.active');
        if (!activeTab || GRPC_ONLY_TABS.includes(activeTab.dataset.tab)) {
            activateHttpTab();
        }
    }
}

/**
 * Activate a specific tab by ID
 * @param {string} tabId
 */
function activateTab(tabId) {
    const tabBtn = document.querySelector(`.request-config .tab-nav .tab-button[data-tab="${tabId}"]`);
    if (tabBtn) {
        tabBtn.click();
    }
}

/**
 * Show or hide the gRPC URL section elements
 * @param {boolean} show
 */
function showGrpcUrlSection(show) {
    let grpcUrlSection = document.getElementById('grpc-url-section');
    
    if (show) {
        if (!grpcUrlSection) {
            // Create gRPC URL section if it doesn't exist
            grpcUrlSection = createGrpcUrlSection();
        }
        grpcUrlSection.style.display = 'flex';
    } else if (grpcUrlSection) {
        grpcUrlSection.style.display = 'none';
    }
}

/**
 * Create the gRPC URL section elements
 * @returns {HTMLElement}
 */
function createGrpcUrlSection() {
    const requestUrlSection = document.querySelector('.request-url-section');
    if (!requestUrlSection) {
        return null;
    }
    
    // Create container for gRPC URL elements
    const grpcSection = document.createElement('div');
    grpcSection.id = 'grpc-url-section';
    grpcSection.className = 'grpc-url-section';
    grpcSection.style.display = 'none';
    grpcSection.style.flex = '1';
    grpcSection.style.gap = '8px';
    grpcSection.style.alignItems = 'center';
    
    // gRPC badge
    const badge = document.createElement('span');
    badge.className = 'grpc-badge';
    badge.textContent = 'gRPC';
    badge.style.cssText = 'background: var(--accent-color); color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;';
    
    // Target input wrapper
    const targetWrapper = document.createElement('div');
    targetWrapper.style.cssText = 'flex: 1; display: flex; align-items: center; gap: 8px;';
    
    // Target input (reuse existing or create reference)
    const existingTarget = document.getElementById('grpc-target-input');
    const targetInput = document.createElement('input');
    targetInput.type = 'text';
    targetInput.id = 'grpc-url-target-input';
    targetInput.className = 'url-input';
    targetInput.placeholder = 'localhost:50051';
    targetInput.setAttribute('aria-label', 'gRPC Target');
    
    // Sync with existing target input
    if (existingTarget) {
        targetInput.value = existingTarget.value;
        targetInput.addEventListener('input', () => {
            existingTarget.value = targetInput.value;
        });
        existingTarget.addEventListener('input', () => {
            targetInput.value = existingTarget.value;
        });
    }
    
    targetWrapper.appendChild(targetInput);
    
    grpcSection.appendChild(badge);
    grpcSection.appendChild(targetWrapper);
    
    // Insert after method select container
    const methodSelectContainer = document.querySelector('.method-select-container');
    if (methodSelectContainer) {
        methodSelectContainer.after(grpcSection);
    } else {
        requestUrlSection.prepend(grpcSection);
    }
    
    return grpcSection;
}

/**
 * Activate the default HTTP tab (path-params)
 */
function activateHttpTab() {
    const pathParamsBtn = document.querySelector('.request-config .tab-nav .tab-button[data-tab="path-params"]');
    if (pathParamsBtn) {
        pathParamsBtn.click();
    }
}

/**
 * Initialize the request mode manager
 * Sets up initial state based on current UI
 */
export function initRequestModeManager() {
    // Default to HTTP mode
    setRequestMode(RequestMode.HTTP);
}
