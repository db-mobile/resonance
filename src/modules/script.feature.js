/**
 * @fileoverview Feature descriptor wiring the pre-request/test script stack (Repository →
 * Service → Controller, plus inline editor + console panel) for the FeatureRegistry.
 * @module script.feature
 */

import { ScriptRepository } from './storage/ScriptRepository.js';
import { ScriptService } from './services/ScriptService.js';
import { InlineScriptManager } from './ui/InlineScriptManager.js';
import { ScriptConsolePanel } from './ui/ScriptConsolePanel.js';
import { ScriptController } from './controllers/ScriptController.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const scriptFeature = {
    name: 'script',
    create(ctx) {
        const environmentService = ctx.get('environmentService');

        const repository = new ScriptRepository(ctx.backendAPI);
        const service = new ScriptService(repository, environmentService, ctx.statusDisplay);

        const inlineScriptManager = new InlineScriptManager();
        inlineScriptManager.initialize();

        const consolePanel = new ScriptConsolePanel(null);
        const controller = new ScriptController(service, inlineScriptManager, consolePanel);

        return { repository, service, inlineScriptManager, consolePanel, controller };
    },
    globals: { inlineScriptManager: 'inlineScriptManager', scriptController: 'controller' },
};
