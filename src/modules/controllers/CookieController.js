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

    /**
     * Called by renderer when the active environment changes.
     */
    setActiveEnvironment(environmentId, environmentName) {
        this._activeEnvironmentId = environmentId || 'default';
        this._activeEnvironmentName = environmentName || null;
    }

    /** @deprecated Use setActiveEnvironment */
    setActiveEnvironmentId(environmentId) {
        this._activeEnvironmentId = environmentId || 'default';
    }

    /**
     * Returns the Cookie header string to inject into the request, or null.
     */
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
     * Persists cookies from a response into the jar.
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

    /**
     * The active environment's cookies, for seeding a script's cookie API.
     * @returns {Promise<Array<Object>>} Stored cookies
     */
    async getCookiesForScripts() {
        return this.service.getAll(this._activeEnvironmentId);
    }

    /**
     * Apply the cookie operations recorded by a script, in order.
     *
     * A `delete` without a domain removes every cookie of that name in the
     * active environment, matching the script API's optional-domain semantics.
     * @param {Array<Object>} changes - Recorded operations ({ op, cookie|name, domain?, path? })
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
