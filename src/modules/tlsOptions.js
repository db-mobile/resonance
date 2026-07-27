import { app } from './appContext.js';
import { getSettingsCache } from './apiHandler.js';

/**
 * Resolve the per-request TLS options the backend needs, mirroring what the
 * HTTP path sends: the global verify-SSL toggle plus any client certificate or
 * custom CA registered for this host.
 *
 * Shared by the streaming transports whose backend commands take the flat
 * `verifySsl`/`clientCert` wire shape — SSE, WebSocket, and GraphQL
 * subscriptions. MQTT and gRPC resolve their own: they send a nested `tls`
 * object with a `skipVerify` flag and look the certificate up by a
 * protocol-specific host.
 *
 * Both lookups are best-effort — a stream should still be attempted if the
 * settings store or the certificate store is unreadable.
 *
 * @param {string} url - the resolved request URL. `ws:`/`wss:` are accepted.
 * @returns {Promise<{verifySsl: boolean, clientCert?: object}>}
 */
export async function resolveTlsOptions(url) {
    let verifySsl = true;
    try {
        // The cache is only warm once an HTTP request has been sent this
        // session, so a stream-only session has to read the settings itself.
        const settings = getSettingsCache() || (await window.backendAPI.settings.get());
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
        /* certificate lookup is best-effort */
    }
    return tls;
}
