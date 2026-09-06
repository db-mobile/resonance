/**
 * @fileoverview Feature descriptor wiring the OpenAPI schema validation controller for the
 * @module schema.feature
 */

import { SchemaController } from './controllers/SchemaController.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const schemaFeature = {
    name: 'schema',
    create(ctx) {
        const controller = new SchemaController({
            repository: ctx.get('collectionRepository'),
            statusDisplay: ctx.statusDisplay,
        });
        return { controller };
    },
    globals: { schemaController: 'controller' },
};
