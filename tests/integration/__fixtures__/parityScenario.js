export const ENDPOINT = Object.freeze({
    id: 'e1',
    name: 'Create user',
    method: 'POST',
    path: '/users/{id}',
    protocol: 'http',
    headers: {}
});

export const GRAPHQL_ENDPOINT = Object.freeze({
    id: 'e2',
    name: 'Query user',
    method: 'POST',
    path: '/graphql',
    protocol: 'graphql',
    headers: {}
});

export const GRAPHQL = Object.freeze({
    query: 'query Get($id: ID!) { user(id: $id) { name } }',
    variables: '{"id": "{{name}}"}',
    operationName: 'Get'
});

export const COLLECTION = Object.freeze({
    id: 'c1',
    name: 'Parity',
    baseUrl: 'https://api.test',
    defaultHeaders: {},
    endpoints: [ENDPOINT, GRAPHQL_ENDPOINT],
    folders: []
});

export const VARIABLES = Object.freeze({ trace: 't1', q: 'x y', name: 'ada', key: 's3cret' });

export const SETTINGS = Object.freeze({ verifySsl: false, requestTimeout: 0, httpVersion: 'h2', followRedirects: true });

export const CERT = Object.freeze({ certPath: '/certs/client.pem', keyPath: '/certs/client.key' });

export const COOKIE_HEADER = 'sid=1';

export const MOCK_BASE_URL = 'http://127.0.0.1:9999';

/**
 * @param {*} value
 * @returns {*}
 */
export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

/** @returns {Object} */
export function basePersisted() {
    return {
        url: null,
        headers: [{ key: 'X-Trace', value: '{{trace}}', enabled: true }],
        queryParams: [{ key: 'q', value: '{{q}}', enabled: true }],
        pathParams: [{ key: 'id', value: '42' }],
        modifiedBody: '{"name": "{{name}}"}',
        formBodyData: null,
        graphqlData: null,
        authConfig: null
    };
}

/**
 * @param {Object} scenario
 * @returns {Object}
 */
export function scenarioEndpoint(scenario) {
    return scenario.graphql ? GRAPHQL_ENDPOINT : ENDPOINT;
}

/**
 * @param {Object} scenario
 * @returns {Object}
 */
export function scenarioPersisted(scenario) {
    const persisted = basePersisted();
    persisted.authConfig = scenario.authConfig ? clone(scenario.authConfig) : null;
    if (scenario.graphql) {
        persisted.graphqlData = { ...GRAPHQL };
        persisted.modifiedBody = null;
    }
    return persisted;
}

export const SCENARIOS = [
    ['api-key in the query string', {
        authConfig: { type: 'api-key', config: { keyName: 'api_key', keyValue: '{{key}}', location: 'query' } }
    }],
    ['bearer token from a variable', {
        authConfig: { type: 'bearer', config: { token: '{{key}}' } }
    }],
    ['mock server rewrite', {
        authConfig: null,
        mock: MOCK_BASE_URL
    }],
    ['graphql query', {
        authConfig: { type: 'bearer', config: { token: '{{key}}' } },
        graphql: true
    }],
    ['pre-request script adds a query param', {
        authConfig: { type: 'api-key', config: { keyName: 'api_key', keyValue: '{{key}}', location: 'query' } },
        script: true
    }]
];
