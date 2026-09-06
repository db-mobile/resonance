/**
 * @fileoverview Collection management facade module
 * @module modules/collectionManager
 */

import { app } from './appContext.js';
import { CollectionController } from './controllers/CollectionController.js';
import { updateStatusDisplay } from './statusDisplay.js';

/** @type {CollectionController|null} */
let collectionController = null;

/** @returns {CollectionController} */
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

/** @returns {Promise<Array<Object>>} */
export function loadCollections() {
    const controller = initializeController();
    return controller.loadCollections();
}

/** @returns {Promise<Array<Object>>} */
export async function getCollections() {
    const controller = initializeController();
    if (controller.allCollections && controller.allCollections.length > 0) {
        return controller.allCollections;
    }
    return controller.loadCollections();
}

/** @returns {Promise<Object|null>} */
export function importCollectionFile() {
    const controller = initializeController();
    return controller.importCollectionFile();
}

/** @returns {Promise<Object|null>} */
export function importPostmanEnvironment() {
    const controller = initializeController();
    return controller.importPostmanEnvironment();
}

/** @returns {Promise<void>} */
export function openExistingCollection() {
    const controller = initializeController();
    return controller.handleOpenExisting();
}

/** @returns {Promise<void>} */
export function importCurl() {
    const controller = initializeController();
    return controller.handleImportCurl(null);
}

/**
 * @param {string} collectionId
 * @param {string} endpointId
 * @returns {Promise<void>}
 */
export async function saveAllRequestModifications(collectionId, endpointId) {
    const controller = initializeController();
    await controller.saveAllRequestModifications(collectionId, endpointId);
}

/** @returns {void} */
export function initializeBodyTracking() {
    const controller = initializeController();
    controller.initializeBodyTracking();
}

/**
 * @param {Object} requestData
 * @returns {Promise<{collectionId: string, endpointId: string}|null>}
 */
export async function saveRequestToCollection(requestData) {
    const controller = initializeController();
    return controller.showSaveToCollectionDialog(requestData);
}

if (typeof window !== 'undefined' && window.backendAPI) {
    initializeController();
}