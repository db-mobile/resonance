/**
 * @fileoverview Feature descriptor wiring the form-body manager (multipart and
 * @module formBody.feature
 */

import { FormBodyManager } from './formBodyManager.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const formBodyFeature = {
    name: 'formBody',
    create() {
        const manager = new FormBodyManager();
        manager.initialize();
        return { manager };
    },
    globals: { formBodyManager: 'manager' },
};
