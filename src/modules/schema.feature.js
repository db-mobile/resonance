/**
 * @fileoverview Feature descriptor wiring the OpenAPI schema validation controller for the
 * FeatureRegistry. This feature has no service/repository of its own — it reads the shared
 * collection repository directly.
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
