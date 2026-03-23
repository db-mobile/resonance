/**
 * @fileoverview Controller coordinating the cookie jar service and UI
 * @module controllers/CookieController
 */

export class CookieController {
    constructor(cookieJarService, cookieManagerDialog) {
        this.service = cookieJarService;
        this.dialog = cookieManagerDialog;
        this._activeEnvironmentId = 'default';
        this._activeEnvironmentName = null;
    }

    initialize() {
        // Nothing async to do at startup — jar is lazily loaded on first request
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
            const settings = await window.backendAPI?.settings?.get();
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
            const settings = await window.backendAPI?.settings?.get();
            if (settings?.cookieJarEnabled === false) { return; }
            await this.service.processCookiesFromResponse(setCookieHeaders, requestUrl, this._activeEnvironmentId);
        } catch (_e) {
            // Non-blocking
        }
    }

    openCookieManager() {
        this.dialog.show(this._activeEnvironmentId, this._activeEnvironmentName);
    }
}
