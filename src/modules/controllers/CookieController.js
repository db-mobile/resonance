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

    initialize() {
    }

    setActiveEnvironment(environmentId, environmentName) {
        this._activeEnvironmentId = environmentId || 'default';
        this._activeEnvironmentName = environmentName || null;
    }

    setActiveEnvironmentId(environmentId) {
        this._activeEnvironmentId = environmentId || 'default';
    }

    async getCookieHeader(requestUrl) {
        try {
            const settings = app.getApiHandlerSettingsCache?.() ?? await window.backendAPI?.settings?.get();
            if (settings?.cookieJarEnabled === false) { return null; }
            return await this.service.getCookieHeaderForRequest(requestUrl, this._activeEnvironmentId);
        } catch (_e) {
            return null;
        }
    }

    /**
     * @param {string[]} setCookieHeaders
     * @param {string} requestUrl
     */
    async handleCookiesFromResponse(setCookieHeaders, requestUrl) {
        try {
            const settings = app.getApiHandlerSettingsCache?.() ?? await window.backendAPI?.settings?.get();
            if (settings?.cookieJarEnabled === false) { return; }
            await this.service.processCookiesFromResponse(setCookieHeaders, requestUrl, this._activeEnvironmentId);
        } catch (_e) {
        }
    }

    /** @returns {Promise<Array<Object>>} */
    async getCookiesForScripts() {
        return this.service.getAll(this._activeEnvironmentId);
    }

    /**
     * @param {Array<Object>} changes
     * @returns {Promise<void>}
     */
    async applyScriptCookieChanges(changes) {
        for (const change of changes) {
            if (change?.op === 'set' && change.cookie) {
                await this.service.putCookie(change.cookie, this._activeEnvironmentId);
            } else if (change?.op === 'delete' && change.name) {
                const stored = await this.service.getAll(this._activeEnvironmentId);
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
                await this.service.deleteAll(this._activeEnvironmentId);
            }
        }
    }

    openCookieManager() {
        this.dialog.show(this._activeEnvironmentId, this._activeEnvironmentName);
    }
}
