/* global window */
jest.mock('../../src/modules/apiHandler.js', () => ({
    getSettingsCache: jest.fn()
}));

import { app } from '../../src/modules/appContext.js';
import { getSettingsCache } from '../../src/modules/apiHandler.js';
import { resolveTlsOptions } from '../../src/modules/tlsOptions.js';

const URL_UNDER_TEST = 'wss://api.example.com/graphql';

describe('resolveTlsOptions', () => {
    let getFromBackend;

    beforeEach(() => {
        jest.clearAllMocks();
        getFromBackend = jest.fn().mockResolvedValue({ verifySsl: true });
        window.backendAPI = { settings: { get: getFromBackend } };
        delete app.certificateController;
    });

    it('reads verifySsl from the warm settings cache without hitting the backend', async () => {
        getSettingsCache.mockReturnValue({ verifySsl: false });

        expect(await resolveTlsOptions(URL_UNDER_TEST)).toEqual({ verifySsl: false });
        expect(getFromBackend).not.toHaveBeenCalled();
    });

    it('falls back to the backend when the cache is cold', async () => {
        getSettingsCache.mockReturnValue(null);
        getFromBackend.mockResolvedValue({ verifySsl: false });

        expect(await resolveTlsOptions(URL_UNDER_TEST)).toEqual({ verifySsl: false });
        expect(getFromBackend).toHaveBeenCalled();
    });

    it('defaults to verifying when the setting is absent', async () => {
        getSettingsCache.mockReturnValue({});

        expect(await resolveTlsOptions(URL_UNDER_TEST)).toEqual({ verifySsl: true });
    });

    it('attaches the certificate registered for the host of a wss url', async () => {
        getSettingsCache.mockReturnValue({ verifySsl: true });
        const cert = { certPath: '/c.crt', keyPath: '/c.key', caPath: '/ca.pem' };
        const getForHost = jest.fn().mockReturnValue(cert);
        app.certificateController = { getForHost };

        expect(await resolveTlsOptions(URL_UNDER_TEST)).toEqual({
            verifySsl: true,
            clientCert: cert
        });
        expect(getForHost).toHaveBeenCalledWith('api.example.com');
    });

    it('omits clientCert when no certificate is registered for the host', async () => {
        getSettingsCache.mockReturnValue({ verifySsl: true });
        app.certificateController = { getForHost: jest.fn().mockReturnValue(null) };

        expect(await resolveTlsOptions(URL_UNDER_TEST)).toEqual({ verifySsl: true });
    });

    it('still verifies when the settings lookup throws', async () => {
        getSettingsCache.mockImplementation(() => {
            throw new Error('store unavailable');
        });

        expect(await resolveTlsOptions(URL_UNDER_TEST)).toEqual({ verifySsl: true });
    });

    it('still returns options when the certificate lookup throws', async () => {
        getSettingsCache.mockReturnValue({ verifySsl: false });
        app.certificateController = {
            getForHost: jest.fn(() => {
                throw new Error('cert store unavailable');
            })
        };

        expect(await resolveTlsOptions(URL_UNDER_TEST)).toEqual({ verifySsl: false });
    });

    it('does not throw on an unparseable url', async () => {
        getSettingsCache.mockReturnValue({ verifySsl: true });
        app.certificateController = { getForHost: jest.fn() };

        expect(await resolveTlsOptions('not a url')).toEqual({ verifySsl: true });
    });
});
