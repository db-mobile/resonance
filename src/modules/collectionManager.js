/**
 * @fileoverview Collection management facade module
 * @module modules/collectionManager
 */

import { CollectionController } from './controllers/CollectionController.js';
import { updateStatusDisplay } from './statusDisplay.js';

/**
 * Singleton instance of CollectionController
 *
 * @private
 * @type {CollectionController|null}
 */
let collectionController = null;

/**
 * Initializes the collection controller singleton
 *
 * @private
 * @returns {CollectionController} The initialized controller
 * @throws {Error} If electronAPI is not available
 */
function initializeController() {
    if (!collectionController) {
        if (!window.electronAPI) {
            console.error('electronAPI is not available. Ensure preload script is loaded.');
            throw new Error('electronAPI is not available');
        }
        collectionController = new CollectionController(window.electronAPI, updateStatusDisplay);
        window.collectionService = collectionController.service;
    }
    return collectionController;
}

/**
 * Loads all collections from storage
 *
 * @async
 * @returns {Promise<Array<Object>>} Array of collection objects
 */
export async function loadCollections() {
    const controller = initializeController();
    return controller.loadCollections();
}

/**
 * Displays collections in the UI
 *
 * @param {Array<Object>} collections - Array of collection objects to display
 * @returns {void}
 */
export function displayCollections(collections) {
    const controller = initializeController();
    controller.renderCollections(collections);
}

/**
 * Loads an endpoint from a collection into the request form
 *
 * @async
 * @param {Object} collection - The collection object
 * @param {Object} endpoint - The endpoint object
 * @returns {Promise<void>}
 */
export async function loadEndpointIntoForm(collection, endpoint) {
    const controller = initializeController();
    await controller.handleEndpointClick(collection, endpoint);
}

/**
 * Opens file dialog and imports OpenAPI specification file
 *
 * @async
 * @returns {Promise<Object|null>} Imported collection or null if cancelled
 */
export async function importOpenApiFile() {
    const controller = initializeController();
    return controller.importOpenApiFile();
}

/**
 * Saves modified request body for an endpoint
 *
 * @async
 * @param {string} collectionId - Collection ID
 * @param {string} endpointId - Endpoint ID
 * @returns {Promise<void>}
 */
export async function saveRequestBodyModification(collectionId, endpointId) {
    const controller = initializeController();
    await controller.saveRequestBodyModification(collectionId, endpointId);
}

/**
 * Initializes body input change tracking
 *
 * @returns {void}
 */
export function initializeBodyTracking() {
    const controller = initializeController();
    controller.initializeBodyTracking();
}

/**
 * Gets variables for currently loaded collection
 *
 * @async
 * @returns {Promise<Object>} Variables object
 */
export async function getCurrentCollectionVariables() {
    const controller = initializeController();
    return controller.getCurrentCollectionVariables();
}

/**
 * Processes request with variable substitution
 *
 * @async
 * @param {Object} request - Request object to process
 * @returns {Promise<Object>} Processed request with variables substituted
 */
export async function processRequestForVariables(request) {
    const controller = initializeController();
    return controller.processRequestForVariables(request);
}

/**
 * Restores the last selected request from storage
 *
 * @async
 * @returns {Promise<void>}
 */
export async function restoreLastSelectedRequest() {
    const controller = initializeController();
    return controller.restoreLastSelectedRequest();
}

/**
 * Generates placeholder request body from schema
 *
 * @deprecated Use SchemaProcessor class instead
 * @param {Object} _requestBody - Request body schema
 * @returns {null}
 */
export function generatePlaceholderBody(_requestBody) {
    console.warn('generatePlaceholderBody is deprecated. Schema processing is now handled by SchemaProcessor class.');
    return null;
}

/**
 * Generates example data from schema
 *
 * @deprecated Use SchemaProcessor class instead
 * @param {Object} _schema - Schema object
 * @returns {null}
 */
export function generateExampleFromSchema(_schema) {
    console.warn('generateExampleFromSchema is deprecated. Schema processing is now handled by SchemaProcessor class.');
    return null;
}

if (typeof window !== 'undefined' && window.electronAPI) {
    initializeController();
}