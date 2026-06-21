/**
 * @fileoverview Feature descriptor wiring the proxy stack (Repository → Service →
 * Controller) for the FeatureRegistry.
 * @module proxy.feature
 */

import { ProxyRepository } from './storage/ProxyRepository.js';
import { ProxyService } from './services/ProxyService.js';
import { ProxyController } from './controllers/ProxyController.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const proxyFeature = {
    name: 'proxy',
    create(ctx) {
        const repository = new ProxyRepository(ctx.backendAPI);
        const service = new ProxyService(repository, ctx.statusDisplay);
        const controller = new ProxyController(service);
        return { repository, service, controller };
    },
    // No `globals` and no `init`: faithfully preserves prior behavior — renderer.js never
    // exposed proxyController globally nor called proxyController.initialize(), even though
    // the method exists. Do not add an init hook here without verifying that intent.
};
