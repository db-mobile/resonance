/**
 * @fileoverview Feature descriptor wiring the built-in mock server stack (Repository →
 * Service → Controller → Dialog) for the FeatureRegistry.
 * @module mockServer.feature
 */

import { MockServerRepository } from './storage/MockServerRepository.js';
import { MockServerService } from './services/MockServerService.js';
import { MockServerController } from './controllers/MockServerController.js';
import { MockServerDialog } from './ui/MockServerDialog.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const mockServerFeature = {
    name: 'mockServer',
    create(ctx) {
        const repository = new MockServerRepository(ctx.backendAPI);
        const service = new MockServerService(repository, ctx.statusDisplay);
        // collectionRepository is published onto the bus by renderer.js before boot.
        const controller = new MockServerController(service, ctx.get('collectionRepository'));
        const dialog = new MockServerDialog(controller);
        return { repository, service, controller, dialog };
    },
    // No globals. controller.initialize() is deferred to an idle tier in renderer.js, so no
    // init hook here.
};
