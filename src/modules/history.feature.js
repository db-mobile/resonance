/**
 * @fileoverview Feature descriptor wiring the request-history controller for the
 * FeatureRegistry.
 * @module history.feature
 */

import { HistoryController } from './controllers/HistoryController.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const historyFeature = {
    name: 'history',
    create(ctx) {
        const controller = new HistoryController(ctx.backendAPI);
        return { controller };
    },
    globals: { historyController: 'controller' },
};
