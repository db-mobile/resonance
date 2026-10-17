/**
 * @fileoverview Feature descriptor building the request form's AuthManager and wiring its inherited-auth lookups to the collection feature
 * @module auth.feature
 */

import { AuthManager } from './authManager.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const authFeature = {
    name: 'auth',
    create(ctx) {
        const manager = new AuthManager({
            typeSelect: document.getElementById('auth-type-select'),
            fieldsContainer: document.getElementById('auth-fields-container'),
            getInheritedAuthInfo: () => ctx.get('collectionController')?.describeInheritedAuth() ?? null,
            onOpenCollectionAuth: (collectionId, folderId) => ctx.get('collectionController')?.openAuthEditor(collectionId, folderId)
        });
        return { manager };
    },
    globals: { authManager: 'manager' },
    provides: { authManager: 'manager' },
};
