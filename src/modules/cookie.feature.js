/**
 * @fileoverview Feature descriptor wiring the cookie-jar stack (Repository → Service →
 * Dialog → Controller) for the FeatureRegistry, including the cross-feature sync that
 * keeps the active cookie-jar environment in step with the environment service.
 * @module cookie.feature
 */

import { CookieRepository } from './storage/CookieRepository.js';
import { CookieJarService } from './services/CookieJarService.js';
import { CookieManagerDialog } from './ui/CookieManagerDialog.js';
import { CookieController } from './controllers/CookieController.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const cookieFeature = {
    name: 'cookie',
    create(ctx) {
        // environmentService is published onto the shared bus by renderer.js before boot,
        // since the Environment feature is not yet registry-managed.
        const environmentService = ctx.get('environmentService');

        const repository = new CookieRepository(ctx.backendAPI);
        const service = new CookieJarService(repository);
        const dialog = new CookieManagerDialog(service, environmentService);
        const controller = new CookieController(service, dialog);

        // Sync the cookie jar's active environment when the user switches environments.
        environmentService.addChangeListener((event) => {
            if (event.type === 'environment-switched') {
                controller.setActiveEnvironment(event.environmentId, event.environmentName);
            }
        });

        return { repository, service, dialog, controller };
    },
    globals: { cookieController: 'controller' },
    init({ controller }) {
        controller.initialize();
    },
};
