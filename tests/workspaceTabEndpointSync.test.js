/* global document */

const APP_MARKUP = `
    <div class="request-config">
        <div class="tab-nav"><button class="tab-button active" data-tab="grpc"></button></div>
    </div>
    <span id="status-display"></span>
    <span id="response-time-display"></span>
    <span id="response-size-display"></span>
`;

/**
 * The manager's dependencies resolve their elements at import time, so the markup
 * has to exist before the module graph loads. apiHandler is stubbed because
 * importing it auto-initialises the collection controller.
 */
async function loadStateManager() {
    document.body.innerHTML = APP_MARKUP;
    jest.resetModules();
    jest.doMock('../src/modules/apiHandler.js', () => ({
        displayResponseWithLineNumbersForTab: jest.fn(),
        clearResponseDisplayForTab: jest.fn(),
        clearSchemaValidationBadge: jest.fn(),
        clearGraphQLErrorsBadge: jest.fn()
    }));

    const { WorkspaceTabStateManager } = await import('../src/modules/WorkspaceTabStateManager.js');
    const endpointState = await import('../src/modules/state/currentEndpoint.js');
    return { WorkspaceTabStateManager, ...endpointState };
}

const SAVED_ENDPOINT = { collectionId: 'col-1', endpointId: 'ep-1' };
const PROTOCOLS = ['grpc', 'sse', 'websocket', 'graphql', 'mqtt'];

describe('_applyTabEndpoint', () => {
    it('points at the endpoint of a tab that has one', async () => {
        const { WorkspaceTabStateManager, getCurrentEndpoint } = await loadStateManager();

        WorkspaceTabStateManager.prototype._applyTabEndpoint({ endpoint: SAVED_ENDPOINT }, SAVED_ENDPOINT);

        expect(getCurrentEndpoint()).toEqual(SAVED_ENDPOINT);
    });

    it('clears a previous tab endpoint when the new tab has none', async () => {
        const { WorkspaceTabStateManager, getCurrentEndpoint, setCurrentEndpoint } = await loadStateManager();
        setCurrentEndpoint(SAVED_ENDPOINT);

        WorkspaceTabStateManager.prototype._applyTabEndpoint({ endpoint: null }, null);

        expect(getCurrentEndpoint()).toBeNull();
    });

    it('leaves the endpoint alone for a tab record without the key', async () => {
        const { WorkspaceTabStateManager, getCurrentEndpoint, setCurrentEndpoint } = await loadStateManager();
        setCurrentEndpoint(SAVED_ENDPOINT);

        WorkspaceTabStateManager.prototype._applyTabEndpoint({}, null);

        expect(getCurrentEndpoint()).toEqual(SAVED_ENDPOINT);
    });
});

describe('restoreTabState endpoint handling per protocol', () => {
    /**
     * Restore a tab of the given protocol through the real restoreTabState.
     * @returns {Promise<Object|null>} The current endpoint afterwards
     */
    async function restoreAndReadEndpoint(protocol, tabEndpoint, priorEndpoint) {
        const { WorkspaceTabStateManager, getCurrentEndpoint, setCurrentEndpoint } = await loadStateManager();
        setCurrentEndpoint(priorEndpoint);

        const manager = new WorkspaceTabStateManager({});
        await manager.restoreTabState({
            id: 'tab-1',
            name: 'New Request',
            endpoint: tabEndpoint,
            request: { protocol, grpc: {}, url: '', method: 'GET' }
        });

        return getCurrentEndpoint();
    }

    it.each(PROTOCOLS)('clears a stale endpoint when restoring an unsaved %s tab', async (protocol) => {
        expect(await restoreAndReadEndpoint(protocol, null, SAVED_ENDPOINT)).toBeNull();
    });

    it.each(PROTOCOLS)('adopts the endpoint of a saved %s tab', async (protocol) => {
        expect(await restoreAndReadEndpoint(protocol, SAVED_ENDPOINT, null)).toEqual(SAVED_ENDPOINT);
    });
});
