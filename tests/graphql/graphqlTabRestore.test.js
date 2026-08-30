/**
 * Restoring a GraphQL tab must re-resolve the schema for that tab's endpoint,
 * so the explorer tree survives switching away and back.
 */
const mockCalls = [];

jest.mock('../../src/modules/state/currentEndpoint.js', () => ({
    getCurrentEndpoint: jest.fn(() => null),
    setCurrentEndpoint: jest.fn()
}));
jest.mock('../../src/modules/appContext.js', () => ({ app: {} }));
jest.mock('../../src/modules/keyValueManager.js', () => ({
    parseKeyValuePairs: jest.fn(() => ({})),
    parseKeyValueRows: jest.fn(() => []),
    populateKeyValueList: jest.fn(),
    clearKeyValueList: jest.fn(),
    addKeyValueRow: jest.fn(),
    updateUrlFromQueryParams: jest.fn()
}));
jest.mock('../../src/modules/authManager.js', () => ({
    authManager: { loadAuthConfig: jest.fn() }
}));
jest.mock('../../src/modules/apiHandler.js', () => ({
    displayResponseWithLineNumbersForTab: jest.fn(),
    clearResponseDisplayForTab: jest.fn(),
    clearSchemaValidationBadge: jest.fn(),
    clearGraphQLErrorsBadge: jest.fn()
}));
jest.mock('../../src/modules/statusDisplay.js', () => ({
    updateStatusDisplay: jest.fn(),
    updateResponseTime: jest.fn(),
    updateResponseSize: jest.fn()
}));
jest.mock('../../src/modules/logger.js', () => ({
    __esModule: true,
    default: { scope: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }
}));
jest.mock('../../src/modules/performanceMetrics.js', () => ({
    displayPerformanceMetrics: jest.fn(),
    clearPerformanceMetrics: jest.fn()
}));
jest.mock('../../src/modules/cookieParser.js', () => ({ formatCookiesAsHtml: jest.fn(() => '') }));
jest.mock('../../src/modules/tabManager.js', () => ({ activateTab: jest.fn() }));
jest.mock('../../src/modules/requestBodyHelper.js', () => ({
    setRequestBodyContent: jest.fn(),
    getRequestBodyContent: jest.fn(() => '')
}));
jest.mock('../../src/modules/requestModeManager.js', () => ({
    RequestMode: { GRAPHQL: 'graphql' },
    setRequestMode: jest.fn(() => {
        mockCalls.push(['setRequestMode', globalThis.document.getElementById('url-input').value]);
    })
}));

const { WorkspaceTabStateManager } = require('../../src/modules/WorkspaceTabStateManager.js');

describe('GraphQL tab restore', () => {
    let manager;
    let graphqlBodyManager;

    beforeEach(() => {
        mockCalls.length = 0;
        globalThis.document.body.innerHTML = `
            <input id="url-input" value="https://old.example/graphql">
            <input id="graphql-url-input" value="https://old.example/graphql">
        `;
        graphqlBodyManager = {
            setGraphQLQuery: jest.fn(),
            setGraphQLVariables: jest.fn(),
            updateOperationPicker: jest.fn(),
            autoApplySchemaForUrl: jest.fn(() => {
                mockCalls.push(['autoApplySchemaForUrl', globalThis.document.getElementById('url-input').value]);
                return Promise.resolve();
            })
        };
        manager = new WorkspaceTabStateManager({
            urlInput: globalThis.document.getElementById('url-input'),
            graphqlBodyManager
        });
    });

    const tab = {
        id: 'tab-1',
        activeResponseTab: 'response-body',
        request: {
            protocol: 'graphql',
            url: 'https://api.example/graphql',
            query: '{ me { id } }',
            variables: '{}',
            operationName: null
        }
    };

    test('writes the tab URL before entering GraphQL mode', async () => {
        await manager.restoreTabState(tab);
        expect(mockCalls[0]).toEqual(['setRequestMode', 'https://api.example/graphql']);
        expect(globalThis.document.getElementById('graphql-url-input').value).toBe('https://api.example/graphql');
    });

    test('re-applies the schema for the restored endpoint', async () => {
        await manager.restoreTabState(tab);
        expect(graphqlBodyManager.autoApplySchemaForUrl).toHaveBeenCalledWith('https://api.example/graphql', { allowNetwork: true });
        const applyIndex = mockCalls.findIndex(c => c[0] === 'autoApplySchemaForUrl');
        expect(applyIndex).toBeGreaterThan(-1);
        expect(graphqlBodyManager.setGraphQLQuery).toHaveBeenCalledWith('{ me { id } }');
    });
});
