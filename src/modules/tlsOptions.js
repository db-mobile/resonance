import { app } from './appContext.js';
import { getSettings } from './state/settingsCache.js';

/**
 * @param {string} url
 * @returns {Promise<{verifySsl: boolean, clientCert?: object}>}
 */
export async function resolveTlsOptions(url) {
    let verifySsl = true;
    try {
        const settings = await getSettings();
        verifySsl = settings?.verifySsl !== false;
    } catch (_e) {
        void _e;
    }

    const tls = { verifySsl };
    try {
        const clientCert = app.certificateController?.getForHost(new URL(url).host);
        if (clientCert) {
            tls.clientCert = clientCert;
        }
    } catch (_e) {
    }
    return tls;
}
