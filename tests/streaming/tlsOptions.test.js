/* global window */
jest.mock('../../src/modules/state/settingsCache.js', () => ({
    getSettings: jest.fn()
}));

import { app } from '../../src/modules/appContext.js';
import { getSettings } from '../../src/modules/state/settingsCache.js';
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

    it('reads verifySsl through the shared settings cache, not the backend directly', async () => {
        getSettings.mockResolvedValue({ verifySsl: false });

        expect(await resolveTlsOptions(URL_UNDER_TEST)).toEqual({ verifySsl: false });
        expect(getSettings).toHaveBeenCalled();
        expect(getFromBackend).not.toHaveBeenCalled();
    });

    it('defaults to verifying when the setting is absent', async () => {
        getSettings.mockResolvedValue({});

        expect(await resolveTlsOptions(URL_UNDER_TEST)).toEqual({ verifySsl: true });
    });

    it('attaches the certificate registered for the host of a wss url', async () => {
        getSettings.mockResolvedValue({ verifySsl: true });
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
        getSettings.mockResolvedValue({ verifySsl: true });
        app.certificateController = { getForHost: jest.fn().mockReturnValue(null) };

        expect(await resolveTlsOptions(URL_UNDER_TEST)).toEqual({ verifySsl: true });
    });

    it('still verifies when the settings lookup throws', async () => {
        getSettings.mockRejectedValue(new Error('store unavailable'));

        expect(await resolveTlsOptions(URL_UNDER_TEST)).toEqual({ verifySsl: true });
    });

    it('still returns options when the certificate lookup throws', async () => {
        getSettings.mockResolvedValue({ verifySsl: false });
        app.certificateController = {
            getForHost: jest.fn(() => {
                throw new Error('cert store unavailable');
            })
        };

        expect(await resolveTlsOptions(URL_UNDER_TEST)).toEqual({ verifySsl: false });
    });

    it('does not throw on an unparseable url', async () => {
        getSettings.mockResolvedValue({ verifySsl: true });
        app.certificateController = { getForHost: jest.fn() };

        expect(await resolveTlsOptions('not a url')).toEqual({ verifySsl: true });
    });
});
