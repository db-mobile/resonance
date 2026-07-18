/**
 * @fileoverview Collection management facade module
 * @module modules/collectionManager
 */

import { app } from './appContext.js';
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
 * @throws {Error} If backendAPI is not available
 */
function initializeController() {
    if (!collectionController) {
        if (!window.backendAPI) {
            throw new Error('backendAPI is not available');
        }
        collectionController = new CollectionController(window.backendAPI, updateStatusDisplay);
        app.collectionService = collectionController.service;
        app.collectionController = collectionController;
    }
    return collectionController;
}

/**
 * Loads all collections from storage
 *
 * @async
 * @returns {Promise<Array<Object>>} Array of collection objects
 */
export function loadCollections() {
    const controller = initializeController();
    return controller.loadCollections();
}

/**
 * Returns the already-loaded collections from memory, falling back to a full
 * load only if collections haven't been fetched yet.
 *
 * @async
 * @returns {Promise<Array<Object>>} Array of collection objects
 */
export async function getCollections() {
    const controller = initializeController();
    if (controller.allCollections && controller.allCollections.length > 0) {
        return controller.allCollections;
    }
    return controller.loadCollections();
}

/**
 * Opens file dialog and imports OpenAPI specification file
 *
 * @async
 * @returns {Promise<Object|null>} Imported collection or null if cancelled
 */
export function importOpenApiFile() {
    const controller = initializeController();
    return controller.importOpenApiFile();
}

/**
 * Opens file dialog and imports Postman collection file
 *
 * @async
 * @returns {Promise<Object|null>} Imported collection or null if cancelled
 */
export function importPostmanCollection() {
    const controller = initializeController();
    return controller.importPostmanCollection();
}

/**
 * Opens file dialog and imports Postman environment file
 *
 * @async
 * @returns {Promise<Object|null>} Environment object with name and variables, or null if cancelled
 */
export function importPostmanEnvironment() {
    const controller = initializeController();
    return controller.importPostmanEnvironment();
}

/**
 * Opens cURL import dialog
 *
 * @async
 * @returns {Promise<void>}
 */
export function importCurl() {
    const controller = initializeController();
    return controller.handleImportCurl(null);
}

/**
 * Saves all request modifications for an endpoint (params, headers, body, auth)
 *
 * @async
 * @param {string} collectionId - Collection ID
 * @param {string} endpointId - Endpoint ID
 * @returns {Promise<void>}
 */
export async function saveAllRequestModifications(collectionId, endpointId) {
    const controller = initializeController();
    await controller.saveAllRequestModifications(collectionId, endpointId);
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
 * Shows dialog to save current request to a collection
 *
 * @async
 * @param {Object} requestData - Current request data from the active tab
 * @returns {Promise<{collectionId: string, endpointId: string}|null>} Collection and endpoint IDs if saved, null if cancelled
 */
export async function saveRequestToCollection(requestData) {
    const controller = initializeController();
    return controller.showSaveToCollectionDialog(requestData);
}

if (typeof window !== 'undefined' && window.backendAPI) {
    initializeController();
}