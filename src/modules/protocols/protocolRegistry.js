/**
 * @fileoverview Single source of truth for what each request protocol is and how
 * @module protocols/protocolRegistry
 */

/** @enum {string} */
export const RequestMode = {
    HTTP: 'http',
    WEBSOCKET: 'websocket',
    GRPC: 'grpc',
    SSE: 'sse',
    MQTT: 'mqtt',
    GRAPHQL: 'graphql'
};

/**
 * @typedef {Object} PersistedDataCapabilities
 * @property {boolean} url
 * @property {boolean} authConfig
 * @property {boolean} pathParams
 * @property {boolean} queryParams
 * @property {boolean} headers
 * @property {boolean} modifiedBody
 * @property {boolean} formBodyData
 * @property {boolean} graphqlData
 * @property {boolean} grpcData
 * @property {boolean} mqttData
 */

/**
 * @typedef {Object} ProtocolDescriptor
 * @property {string} id
 * @property {string} label
 * @property {?string} methodLabel
 * @property {boolean} preservesHttpMethod
 * @property {string} defaultMethod
 * @property {'path'|'url'|'fullMethod'} pathSource
 * @property {?string} folderBucket
 * @property {?string} urlInputId
 * @property {boolean} rewritePathFromUrl
 * @property {string} builder
 * @property {boolean} urlBased
 * @property {boolean} needsMethod
 * @property {boolean} needsTarget
 * @property {string} pathPlaceholder
 * @property {string[]} requestTabs
 * @property {string} defaultTab
 * @property {?string[]} bodyModes
 * @property {'http'|'grpc'|'none'} responseTabSet
 * @property {PersistedDataCapabilities} persisted
 * @property {string[]} createSidecars
 */

/**
 * @param {Object} overrides
 * @returns {PersistedDataCapabilities}
 */
function capabilities(overrides) {
    return {
        url: false,
        authConfig: false,
        pathParams: false,
        queryParams: false,
        headers: false,
        modifiedBody: false,
        formBodyData: false,
        graphqlData: false,
        grpcData: false,
        mqttData: false,
        ...overrides
    };
}

/** @type {string[]} */
const ARRAY_PERSISTED_KINDS = ['pathParams', 'queryParams', 'headers'];

/** @type {Object<string, ProtocolDescriptor>} */
export const PROTOCOLS = Object.freeze({
    [RequestMode.HTTP]: Object.freeze({
        id: RequestMode.HTTP,
        label: 'HTTP',
        methodLabel: null,
        preservesHttpMethod: false,
        defaultMethod: 'GET',
        pathSource: 'path',
        folderBucket: null,
        urlInputId: 'url-input',
        rewritePathFromUrl: true,
        builder: 'http',
        urlBased: false,
        needsMethod: true,
        needsTarget: false,
        pathPlaceholder: '/api/endpoint',
        requestTabs: Object.freeze([
            'path-params', 'query-params', 'headers', 'body', 'scripts', 'authorization', 'schema'
        ]),
        defaultTab: 'path-params',
        bodyModes: null,
        responseTabSet: 'http',
        persisted: Object.freeze(capabilities({
            url: true,
            authConfig: true,
            pathParams: true,
            queryParams: true,
            headers: true,
            modifiedBody: true,
            formBodyData: true,
            graphqlData: true
        })),
        createSidecars: Object.freeze([])
    }),
    [RequestMode.SSE]: Object.freeze({
        id: RequestMode.SSE,
        label: 'SSE',
        methodLabel: 'SSE',
        preservesHttpMethod: true,
        defaultMethod: 'GET',
        pathSource: 'url',
        folderBucket: '/sse',
        urlInputId: 'sse-url-input',
        rewritePathFromUrl: false,
        builder: 'sse',
        urlBased: true,
        needsMethod: true,
        needsTarget: false,
        pathPlaceholder: 'https://api.example.com/events',
        requestTabs: Object.freeze(['query-params', 'headers', 'body', 'authorization']),
        defaultTab: 'headers',
        bodyModes: Object.freeze(['json', 'text']),
        responseTabSet: 'none',
        persisted: Object.freeze(capabilities({
            url: true,
            authConfig: true,
            queryParams: true,
            headers: true,
            modifiedBody: true
        })),
        createSidecars: Object.freeze(['url'])
    }),
    [RequestMode.WEBSOCKET]: Object.freeze({
        id: RequestMode.WEBSOCKET,
        label: 'WebSocket',
        methodLabel: 'WS',
        preservesHttpMethod: false,
        defaultMethod: 'WS',
        pathSource: 'url',
        folderBucket: '/websocket',
        urlInputId: 'websocket-url-input',
        rewritePathFromUrl: false,
        builder: 'websocket',
        urlBased: true,
        needsMethod: false,
        needsTarget: false,
        pathPlaceholder: 'wss://echo.websocket.events',
        requestTabs: Object.freeze(['query-params', 'headers', 'body']),
        defaultTab: 'body',
        bodyModes: null,
        responseTabSet: 'none',
        persisted: Object.freeze(capabilities({
            url: true,
            queryParams: true,
            headers: true,
            modifiedBody: true
        })),
        createSidecars: Object.freeze(['url'])
    }),
    [RequestMode.GRAPHQL]: Object.freeze({
        id: RequestMode.GRAPHQL,
        label: 'GraphQL',
        methodLabel: 'GQL',
        preservesHttpMethod: false,
        defaultMethod: 'POST',
        pathSource: 'url',
        folderBucket: '/graphql',
        urlInputId: 'graphql-url-input',
        rewritePathFromUrl: false,
        builder: 'graphql',
        urlBased: true,
        needsMethod: false,
        needsTarget: false,
        pathPlaceholder: 'https://api.example.com/graphql',
        requestTabs: Object.freeze(['body', 'headers', 'authorization', 'scripts']),
        defaultTab: 'body',
        bodyModes: null,
        responseTabSet: 'http',
        persisted: Object.freeze(capabilities({
            url: true,
            authConfig: true,
            headers: true,
            modifiedBody: true,
            formBodyData: true,
            graphqlData: true
        })),
        createSidecars: Object.freeze(['url', 'graphqlData'])
    }),
    [RequestMode.GRPC]: Object.freeze({
        id: RequestMode.GRPC,
        label: 'gRPC',
        methodLabel: 'GRPC',
        preservesHttpMethod: false,
        defaultMethod: 'GRPC',
        pathSource: 'fullMethod',
        folderBucket: '/grpc',
        urlInputId: null,
        rewritePathFromUrl: false,
        builder: 'grpc',
        urlBased: false,
        needsMethod: false,
        needsTarget: true,
        pathPlaceholder: 'package.Service/Method',
        requestTabs: Object.freeze(['grpc', 'grpc-message', 'grpc-metadata', 'authorization']),
        defaultTab: 'grpc',
        bodyModes: null,
        responseTabSet: 'grpc',
        persisted: Object.freeze(capabilities({
            grpcData: true
        })),
        createSidecars: Object.freeze(['grpcData'])
    }),
    [RequestMode.MQTT]: Object.freeze({
        id: RequestMode.MQTT,
        label: 'MQTT',
        methodLabel: 'MQTT',
        preservesHttpMethod: false,
        defaultMethod: 'MQTT',
        pathSource: 'url',
        folderBucket: '/mqtt',
        urlInputId: 'mqtt-broker-input',
        rewritePathFromUrl: false,
        builder: 'mqtt',
        urlBased: true,
        needsMethod: false,
        needsTarget: false,
        pathPlaceholder: 'mqtt://broker.example.com:1883',
        requestTabs: Object.freeze(['mqtt', 'body']),
        defaultTab: 'mqtt',
        bodyModes: null,
        responseTabSet: 'none',
        persisted: Object.freeze(capabilities({
            url: true,
            modifiedBody: true,
            mqttData: true
        })),
        createSidecars: Object.freeze(['url', 'mqttData'])
    })
});

/**
 * @param {*} protocol
 * @returns {string}
 */
export function resolveProtocolId(protocol) {
    return typeof protocol === 'string' && PROTOCOLS[protocol]
        ? protocol
        : RequestMode.HTTP;
}

/**
 * @param {*} protocol
 * @returns {ProtocolDescriptor}
 */
export function getProtocol(protocol) {
    return PROTOCOLS[resolveProtocolId(protocol)];
}

/**
 * @param {*} methodLabel
 * @returns {?string}
 */
export function protocolIdFromMethodLabel(methodLabel) {
    if (typeof methodLabel !== 'string') {
        return null;
    }

    const match = Object.values(PROTOCOLS).find(
        descriptor => descriptor.methodLabel === methodLabel
    );

    return match ? match.id : null;
}

/** @returns {string[]} */
export function listProtocolIds() {
    return Object.keys(PROTOCOLS);
}

/**
 * @param {ProtocolDescriptor} descriptor
 * @param {Object} requestData
 * @returns {string}
 */
export function derivePath(descriptor, requestData) {
    if (descriptor.pathSource === 'fullMethod') {
        return requestData.fullMethod || requestData.path || '';
    }

    if (descriptor.pathSource === 'url') {
        return requestData.url || requestData.broker || requestData.path || '';
    }

    return requestData.path || '';
}

/**
 * @param {ProtocolDescriptor} descriptor
 * @param {Object} requestData
 * @returns {string|undefined}
 */
export function deriveMethod(descriptor, requestData) {
    return descriptor.methodLabel || requestData.method;
}

/**
 * @param {ProtocolDescriptor} descriptor
 * @param {Object} requestData
 * @returns {?string}
 */
export function deriveHttpMethod(descriptor, requestData) {
    if (!descriptor.preservesHttpMethod) {
        return null;
    }

    return requestData.httpMethod || requestData.method || descriptor.defaultMethod;
}

/**
 * @param {Object} endpoint
 * @returns {string}
 */
export function endpointHttpMethod(endpoint) {
    const descriptor = getProtocol(endpoint?.protocol);

    if (descriptor.preservesHttpMethod) {
        return endpoint?.httpMethod || descriptor.defaultMethod;
    }

    return endpoint?.method || descriptor.defaultMethod;
}

/**
 * @param {ProtocolDescriptor} descriptor
 * @param {Object} persistedData
 * @returns {Object}
 */
export function projectPersistedData(descriptor, persistedData) {
    const source = persistedData || {};

    return Object.keys(descriptor.persisted).reduce((projected, kind) => {
        const emptyValue = ARRAY_PERSISTED_KINDS.includes(kind) ? [] : null;

        projected[kind] = descriptor.persisted[kind]
            ? (source[kind] ?? emptyValue)
            : emptyValue;

        return projected;
    }, {});
}
