/**
 * @fileoverview Feature descriptor wiring the workspace-tab stack for the FeatureRegistry:
 * the tab repository/service, the tab bar, the state manager (which captures/restores all
 * request+response DOM state), the response container manager, and the controller that
 * orchestrates them.
 *
 * This feature owns the preview repository and response container manager (used only here),
 * reads request/response DOM elements straight from domElements.js, and consumes the shared
 * `graphqlBodyManager` from the registry bus.
 * @module workspaceTab.feature
 */

import { PreviewRepository } from './storage/PreviewRepository.js';
import { ResponseContainerManager } from './ResponseContainerManager.js';
import { WorkspaceTabRepository } from './storage/WorkspaceTabRepository.js';
import { WorkspaceTabService } from './services/WorkspaceTabService.js';
import { WorkspaceTabBar } from './ui/WorkspaceTabBar.js';
import { WorkspaceTabStateManager } from './WorkspaceTabStateManager.js';
import { WorkspaceTabController } from './controllers/WorkspaceTabController.js';
import {
    urlInput,
    methodSelect,
    bodyInput,
    pathParamsList,
    queryParamsList,
    headersList,
    authTypeSelect,
    responseBodyContainer,
    statusDisplay,
    responseHeadersDisplay,
    responseCookiesDisplay,
    grpcTargetInput,
    grpcServiceSelect,
    grpcMethodSelect,
    grpcBodyInput,
} from './domElements.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const workspaceTabFeature = {
    name: 'workspaceTab',
    create(ctx) {
        const previewRepository = new PreviewRepository(ctx.backendAPI);
        const responseContainerManager = new ResponseContainerManager(previewRepository);

        const repository = new WorkspaceTabRepository(ctx.backendAPI);
        const service = new WorkspaceTabService(repository, ctx.statusDisplay);
        const tabBar = new WorkspaceTabBar('workspace-tab-bar-container');

        // `statusDisplay` here is the response status DOM element (from domElements), distinct
        // from ctx.statusDisplay (the status-display adapter used by the service above).
        const stateManager = new WorkspaceTabStateManager({
            urlInput,
            methodSelect,
            bodyInput,
            pathParamsList,
            queryParamsList,
            headersList,
            authTypeSelect,
            responseBodyContainer,
            statusDisplay,
            responseHeadersDisplay,
            responseCookiesDisplay,
            graphqlBodyManager: ctx.get('graphqlBodyManager'),
            grpcTargetInput,
            grpcServiceSelect,
            grpcMethodSelect,
            grpcBodyInput,
        });

        const controller = new WorkspaceTabController(
            service,
            tabBar,
            stateManager,
            responseContainerManager
        );

        return { previewRepository, responseContainerManager, repository, service, tabBar, stateManager, controller };
    },
    globals: {
        workspaceTabController: 'controller',
        responseContainerManager: 'responseContainerManager',
    },
    // No init hook: controller.initialize() restores tab state and must run AFTER the lazy
    // body editors are created, so it stays at that exact call site in renderer.js.
};
