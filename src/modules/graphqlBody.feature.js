/**
 * @fileoverview Feature descriptor wiring the GraphQL body manager (the Workbench
 * @module graphqlBody.feature
 */

import { GraphQLBodyManager } from './graphqlBodyManager.js';
import { setGraphQLBodyManager } from './apiHandler.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const graphqlBodyFeature = {
    name: 'graphqlBody',
    create() {
        const manager = new GraphQLBodyManager();

        manager.initialize();
        setGraphQLBodyManager(manager);

        return { manager };
    },
    globals: { graphqlBodyManager: 'manager' },
    provides: { graphqlBodyManager: 'manager' },
};
