/**
 * @fileoverview Feature descriptor wiring the workspace-tab stack for the FeatureRegistry:
 * @module workspaceTab.feature
 */

import { PreviewRepository } from './storage/PreviewRepository.js';
import { ResponseContainerManager } from './ResponseContainerManager.js';
import { WorkspaceTabRepository } from './storage/WorkspaceTabRepository.js';
import { WorkspaceTabService } from './services/WorkspaceTabService.js';
import { WorkspaceTabBar } from './ui/WorkspaceTabBar.js';
import { WorkspaceTabStateManager } from './WorkspaceTabStateManager.js';
import { WorkspaceTabController } from './controllers/WorkspaceTabController.js';
import * as domElements from './domElements.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const workspaceTabFeature = {
    name: 'workspaceTab',
    create(ctx) {
        const previewRepository = new PreviewRepository(ctx.backendAPI);
        previewRepository.load();
        const responseContainerManager = new ResponseContainerManager(previewRepository);

        const repository = new WorkspaceTabRepository(ctx.backendAPI);
        const service = new WorkspaceTabService(repository, ctx.statusDisplay);
        const tabBar = new WorkspaceTabBar('workspace-tab-bar-container');

        const stateManager = new WorkspaceTabStateManager({
            ...domElements,
            graphqlBodyManager: ctx.get('graphqlBodyManager'),
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
};
