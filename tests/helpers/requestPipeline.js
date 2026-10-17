/**
 * @param {Object} app
 * @param {Object} backendAPI
 * @returns {Promise<Object>}
 */
export async function installTestRequestPipeline(app, backendAPI) {
    const { CollectionRepository } = await import('../../src/modules/storage/CollectionRepository.js');
    const { EnvironmentRepository } = await import('../../src/modules/storage/EnvironmentRepository.js');
    const { MockServerRepository } = await import('../../src/modules/storage/MockServerRepository.js');
    const { MockServerService } = await import('../../src/modules/services/MockServerService.js');
    const { createRequestPipeline } = await import('../../src/modules/requestPipeline.feature.js');
    const { setRequestPipeline } = await import('../../src/modules/requestServices.js');

    const pipeline = createRequestPipeline({
        backendAPI,
        secretStore: null,
        statusDisplay: { update() {} },
        collectionRepository: new CollectionRepository(backendAPI, null),
        environmentRepository: new EnvironmentRepository(backendAPI, null),
        mockServerService: new MockServerService(new MockServerRepository(backendAPI), null),
        certificates: {
            getForHost: (host) => app.certificateController?.getForHost(host) ?? null,
            getItems: () => app.certificateController?.getItems?.()
        },
        cookies: {
            getCookieHeader: (url) => (app.cookieController ? app.cookieController.getCookieHeader(url) : Promise.resolve(null))
        }
    });
    setRequestPipeline(pipeline);
    return pipeline;
}
