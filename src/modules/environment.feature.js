/**
 * @fileoverview Feature descriptor wiring the environment stack (Repository → Service →
 * Manager/Selector → Controller) for the FeatureRegistry. Publishes `environmentService`
 * onto the shared bus, since other features (cookie, script) and the status bar depend on it.
 * @module environment.feature
 */

import { EnvironmentRepository } from './storage/EnvironmentRepository.js';
import { EnvironmentService } from './services/EnvironmentService.js';
import { EnvironmentManager } from './ui/EnvironmentManager.js';
import { EnvironmentSelector } from './ui/EnvironmentSelector.js';
import { EnvironmentController } from './controllers/EnvironmentController.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const environmentFeature = {
    name: 'environment',
    create(ctx) {
        const repository = new EnvironmentRepository(ctx.backendAPI, ctx.secretStore);
        const service = new EnvironmentService(repository, ctx.statusDisplay);
        const manager = new EnvironmentManager(service);

        // eslint-disable-next-line prefer-const
        let controller;
        const selector = new EnvironmentSelector(
            service,
            (envId) => controller.switchEnvironment(envId),
            () => controller.openEnvironmentManager()
        );
        controller = new EnvironmentController(service, manager, selector);

        return { repository, service, manager, selector, controller };
    },
    globals: { environmentController: 'controller' },
    provides: { environmentService: 'service' },
};
