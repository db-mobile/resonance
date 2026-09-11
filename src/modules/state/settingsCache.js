/**
 * @fileoverview Process-wide cache of the persisted app settings, plus the derived
 * @module state/settingsCache
 */

/** @type {Object|null} */
let cache = null;

/** @returns {void} */
export function invalidateSettingsCache() {
    cache = null;
}

/** @returns {Object|null} */
export function getSettingsCache() {
    return cache;
}

/** @returns {Promise<Object>} */
export async function getSettings() {
    if (!cache) {
        cache = await window.backendAPI.settings.get();
    }
    return cache;
}

/** @returns {Promise<{httpVersion: string, timeout: number|null, verifySsl: boolean, followRedirects: boolean}>} */
export async function resolveRequestSettings() {
    const resolved = {
        httpVersion: 'auto',
        timeout: 30000,
        verifySsl: true,
        followRedirects: true
    };

    try {
        const settings = await getSettings();
        const savedTimeout = settings.requestTimeout ?? settings.timeout;
        resolved.httpVersion = settings.httpVersion || 'auto';
        resolved.timeout = savedTimeout === 0 ? null : (savedTimeout ?? 30000);
        resolved.verifySsl = settings.verifySsl !== false;
        resolved.followRedirects = settings.followRedirects !== false;
    } catch (error) {
        void error;
    }

    return resolved;
}

/**
 * @param {string} key
 * @param {*} value
 * @returns {Promise<boolean>}
 */
export async function updateSetting(key, value) {
    try {
        const settings = await window.backendAPI.settings.get();
        settings[key] = value;
        await window.backendAPI.settings.set(settings);
        invalidateSettingsCache();
        return true;
    } catch (error) {
        void error;
        return false;
    }
}
