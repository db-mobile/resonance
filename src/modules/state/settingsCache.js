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

/**
 * @param {Object|null} settings
 * @returns {{httpVersion: string, timeout: number|null, verifySsl: boolean, followRedirects: boolean}}
 */
export function deriveRequestSettings(settings) {
    const savedTimeout = settings?.requestTimeout ?? settings?.timeout;
    return {
        httpVersion: settings?.httpVersion || 'auto',
        timeout: savedTimeout === 0 ? null : (savedTimeout ?? 30000),
        verifySsl: settings?.verifySsl !== false,
        followRedirects: settings?.followRedirects !== false
    };
}

/** @returns {Promise<{httpVersion: string, timeout: number|null, verifySsl: boolean, followRedirects: boolean}>} */
export async function resolveRequestSettings() {
    try {
        return deriveRequestSettings(await getSettings());
    } catch (error) {
        void error;
        return deriveRequestSettings(null);
    }
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
