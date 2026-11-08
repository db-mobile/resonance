/**
 * @fileoverview Feature descriptor wiring the saved-example stack (Service → Controller) to the open request
 * @module examples.feature
 */

import { ExamplesService } from './services/ExamplesService.js';
import { ExamplesController } from './controllers/ExamplesController.js';
import { ExamplePreviewModal } from './examples/ExamplePreviewModal.js';
import { ConfirmDialog } from './ui/ConfirmDialog.js';
import { RenameDialog } from './ui/RenameDialog.js';
import { getCurrentEndpoint, onCurrentEndpointChange } from './state/currentEndpoint.js';

/**
 * @param {ExamplesController} controller
 * @param {{collectionId?: string, endpointId?: string}|null} endpoint
 * @returns {void}
 */
function syncController(controller, endpoint) {
    if (endpoint?.collectionId && endpoint?.endpointId) {
        controller.loadExamples(endpoint.collectionId, endpoint.endpointId);
    } else {
        controller.clearContext();
    }
}

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const examplesFeature = {
    name: 'examples',
    create(ctx) {
        const service = new ExamplesService(ctx.get('collectionRepository'));
        const controller = new ExamplesController({
            service,
            confirmDialog: new ConfirmDialog(),
            renameDialog: new RenameDialog(),
            previewModal: new ExamplePreviewModal()
        });
        return { service, controller };
    },
    globals: { examplesService: 'service', examplesController: 'controller' },
    provides: { examplesService: 'service' },
    init({ controller }) {
        controller.initialize();
        onCurrentEndpointChange((endpoint) => syncController(controller, endpoint));
        syncController(controller, getCurrentEndpoint());
    },
};
