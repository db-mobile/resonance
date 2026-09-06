/**
 * @fileoverview Feature descriptor wiring the GraphQL body manager (the Workbench
 * @module graphqlBody.feature
 */

import { GraphQLBodyManager } from './graphqlBodyManager.js';
import { setGraphQLBodyManager } from './apiHandler.js';
import { bodyInput } from './domElements.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const graphqlBodyFeature = {
    name: 'graphqlBody',
    create() {
        const manager = new GraphQLBodyManager({
            bodyInput,
            graphqlQueryEditor: document.getElementById('graphql-query-editor'),
            graphqlVariablesEditor: document.getElementById('graphql-variables-editor'),
            graphqlFormatBtn: document.getElementById('graphql-format-btn')
        });

        manager.initialize();
        setGraphQLBodyManager(manager);

        return { manager };
    },
    globals: { graphqlBodyManager: 'manager' },
    provides: { graphqlBodyManager: 'manager' },
};
