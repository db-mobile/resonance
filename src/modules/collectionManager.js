/**
 * Refactored Collection Manager - now follows SOLID principles
 * This file serves as the main entry point and maintains backward compatibility
 * while delegating work to specialized components
 */
import { CollectionController } from './controllers/CollectionController.js';
import { updateStatusDisplay } from './statusDisplay.js';

// Global controller instance
let collectionController = null;

// Initialize the controller
function initializeController() {
    if (!collectionController) {
        if (!window.electronAPI) {
            console.error('electronAPI is not available. Ensure preload script is loaded.');
            throw new Error('electronAPI is not available');
        }
        collectionController = new CollectionController(window.electronAPI, updateStatusDisplay);
        // Make collectionService globally available for auto-save functionality
        window.collectionService = collectionController.service;
    }
    return collectionController;
}

// Public API - maintains backward compatibility
export async function loadCollections() {
    const controller = initializeController();
    return await controller.loadCollections();
}

export function displayCollections(collections) {
    const controller = initializeController();
    controller.renderCollections(collections);
}

export async function loadEndpointIntoForm(collection, endpoint) {
    const controller = initializeController();
    await controller.handleEndpointClick(collection, endpoint);
}

export async function importOpenApiFile() {
    const controller = initializeController();
    return await controller.importOpenApiFile();
}

export async function saveRequestBodyModification(collectionId, endpointId) {
    const controller = initializeController();
    await controller.saveRequestBodyModification(collectionId, endpointId);
}

export function initializeBodyTracking() {
    const controller = initializeController();
    controller.initializeBodyTracking();
}

// Variable management functions
export async function getCurrentCollectionVariables() {
    const controller = initializeController();
    return await controller.getCurrentCollectionVariables();
}

export async function processRequestForVariables(request) {
    const controller = initializeController();
    return await controller.processRequestForVariables(request);
}

export async function restoreLastSelectedRequest() {
    const controller = initializeController();
    return await controller.restoreLastSelectedRequest();
}

// Legacy functions that are no longer needed but kept for compatibility
export function generatePlaceholderBody(requestBody) {
    console.warn('generatePlaceholderBody is deprecated. Schema processing is now handled by SchemaProcessor class.');
    return null;
}

export function generateExampleFromSchema(schema) {
    console.warn('generateExampleFromSchema is deprecated. Schema processing is now handled by SchemaProcessor class.');
    return null;
}

// Initialize on module load
if (typeof window !== 'undefined' && window.electronAPI) {
    initializeController();
}