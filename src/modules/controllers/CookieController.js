/**
 * @fileoverview Controller coordinating the cookie jar service and UI
 * @module controllers/CookieController
 */

import { app } from '../appContext.js';

export class CookieController {
    constructor(cookieJarService, cookieManagerDialog) {
        this.service = cookieJarService;
        this.dialog = cookieManagerDialog;
        this._activeEnvironmentId = 'default';
        this._activeEnvironmentName = null;
    }

    setActiveEnvironment(environmentId, environmentName) {
        this._activeEnvironmentId = environmentId || 'default';
        this._activeEnvironmentName = environmentName || null;
    }

    /** @returns {Promise<boolean>} */
    async _isJarEnabled() {
        const settings = app.getApiHandlerSettingsCache?.() ?? await window.backendAPI?.settings?.get();
        return settings?.cookieJarEnabled !== false;
    }

    async getCookieHeader(requestUrl) {
        try {
            if (!(await this._isJarEnabled())) { return null; }
            return await this.service.getCookieHeaderForRequest(requestUrl, this._activeEnvironmentId);
        } catch (_e) {
            return null;
        }
    }

    /**
     * @param {Array<Object>} changes
     * @returns {Promise<void>}
     */
    async applyScriptCookieChanges(changes, environmentId = this._activeEnvironmentId) {
        for (const change of changes) {
            if (change?.op === 'set' && change.cookie) {
                if (typeof change.cookie.expires === 'number' && change.cookie.expires <= Date.now()) {
                    await this.applyScriptCookieChanges([{ op: 'delete', name: change.cookie.name,
                        domain: change.cookie.domain, path: change.cookie.path || '/' }], environmentId);
                } else { await this.service.putCookie(change.cookie, environmentId); }
            } else if (change?.op === 'delete' && change.name) {
                const stored = await this.service.getAll(environmentId);
                const matches = stored.filter((cookie) => {
                    if (cookie.name !== change.name) { return false; }
                    if (change.domain && cookie.domain?.toLowerCase() !== change.domain.toLowerCase()) { return false; }
                    if (change.path && (cookie.path || '/') !== change.path) { return false; }
                    return true;
                });
                for (const cookie of matches) {
                    await this.service.delete(cookie.id);
                }
            } else if (change?.op === 'clear') {
                await this.service.deleteAll(environmentId);
            }
        }
    }

    openCookieManager() {
        this.dialog.show(this._activeEnvironmentId, this._activeEnvironmentName);
    }
}
