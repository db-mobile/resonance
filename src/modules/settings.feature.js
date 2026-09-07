/**
 * @fileoverview Feature descriptor wiring the settings stack for the
 * @module settings.feature
 */

import { ThemeManager } from './themeManager.js';
import { HttpVersionManager } from './httpVersionManager.js';
import { TimeoutManager } from './timeoutManager.js';
import { SettingsModal } from './ui/SettingsModal.js';
import { i18n } from '../i18n/I18nManager.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const settingsFeature = {
    name: 'settings',
    create(ctx) {
        const themeManager = new ThemeManager();
        const httpVersionManager = new HttpVersionManager();
        const timeoutManager = new TimeoutManager();

        const modal = new SettingsModal(
            themeManager,
            i18n,
            httpVersionManager,
            timeoutManager,
            ctx.get('proxyController'),
            ctx.get('certificateController')
        );

        return { themeManager, httpVersionManager, timeoutManager, modal };
    },
    globals: { settingsModal: 'modal' },
};
