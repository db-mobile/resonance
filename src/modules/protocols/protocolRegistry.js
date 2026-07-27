/**
 * @fileoverview Single source of truth for what each request protocol is and how
 * it is persisted.
 *
 * Every protocol-dependent decision in the collection save/load path used to be
 * re-derived from a hardcoded `if (isGrpc) ... else if (isWebSocket) ...` chain
 * that fell through to HTTP. Protocols added after those chains were written -
 * SSE and MQTT - matched no branch and were silently stored as HTTP. The
 * descriptors below replace those chains, so adding a protocol is one entry here
 * rather than a new branch at every call site.
 *
 * Two descriptor values are easy to misread:
 *
 * - `preservesHttpMethod` is true only for SSE. An SSE request is an HTTP
 *   request whose response is a stream, so the user still picks GET or POST
 *   (see `setRequestMode` in requestModeManager). The verb therefore cannot be
 *   collapsed into the `SSE` tree badge; it is stored alongside it in
 *   `endpoint.httpMethod`.
 * - `rewritePathFromUrl` is true only for HTTP. Every other protocol's endpoint
 *   is identified by an absolute URL, and rewriting `path` to that URL's bare
 *   pathname would destroy it.
 *
 * The `persisted` map's keys are deliberately the keys returned by
 * `CollectionRepository.getAllPersistedEndpointData()`, which is what lets the
 * loader project stored data through a loop instead of one boolean expression
 * per field. It gates what is *read back*, and is intentionally separate from
 * `createSidecars`, which lists what is written when an endpoint is first
 * created. HTTP reads a persisted URL but must not be given one on creation:
 * its stored path is collection-relative, and a persisted URL would take
 * precedence over `{{baseUrl}}` resolution.
 *
 * This module imports nothing, so it is safe to use from services, UI, and
 * jsdom tests alike.
 *
 * @module protocols/protocolRegistry
 */

/**
 * Request protocol modes.
 *
 * Re-exported by requestModeManager, which is where most callers import it
 * from.
 *
 * @enum {string}
 */
export const RequestMode = {
    HTTP: 'http',
    WEBSOCKET: 'websocket',
    GRPC: 'grpc',
    SSE: 'sse',
    MQTT: 'mqtt',
    GRAPHQL: 'graphql'
};

/**
 * Which kinds of persisted endpoint data a protocol reads and writes.
 *
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
 * Everything the collection layer needs to know about one protocol.
 *
 * @typedef {Object} ProtocolDescriptor
 * @property {string} id - Protocol id, matching a RequestMode value.
 * @property {string} label - Human-readable name, used in menus and dialogs.
 * @property {?string} methodLabel - Collection-tree badge text, or null to pass
 *     the request's own method through unchanged.
 * @property {boolean} preservesHttpMethod - Whether an HTTP verb must be stored
 *     separately from `methodLabel`.
 * @property {string} defaultMethod - Verb assumed when none was captured.
 * @property {'path'|'url'|'fullMethod'} pathSource - Which request field becomes
 *     `endpoint.path`.
 * @property {?string} folderBucket - Fixed folder name, or null to derive one
 *     from the request path.
 * @property {?string} urlInputId - Id of the DOM input owning this protocol's
 *     URL, or null when it has none.
 * @property {boolean} rewritePathFromUrl - Whether `endpoint.path` may be
 *     rewritten from the URL's pathname on re-save.
 * @property {string} builder - Key selecting the tab-update builder.
 * @property {boolean} urlBased - Whether the endpoint is addressed by absolute
 *     URL rather than a collection-relative path.
 * @property {boolean} needsMethod - Whether the user picks an HTTP verb.
 * @property {boolean} needsTarget - Whether the endpoint needs a host target
 *     instead of a URL.
 * @property {string} pathPlaceholder - Placeholder for the dialog's URL/path
 *     field.
 * @property {PersistedDataCapabilities} persisted - Which stored data kinds are
 *     read back when the endpoint is loaded.
 * @property {string[]} createSidecars - Which sidecar records are written when
 *     the endpoint is first created.
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

/**
 * Persisted data kinds whose empty value is an array rather than null.
 *
 * @type {string[]}
 */
const ARRAY_PERSISTED_KINDS = ['pathParams', 'queryParams', 'headers'];

/**
 * All known protocols, keyed by id.
 *
 * @type {Object<string, ProtocolDescriptor>}
 */
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
        persisted: Object.freeze(capabilities({
            url: true,
            modifiedBody: true,
            mqttData: true
        })),
        createSidecars: Object.freeze(['url', 'mqttData'])
    })
});

/**
 * Normalizes any stored or captured value to a known protocol id.
 *
 * Falls back to HTTP so a corrupt or future id still opens something rather
 * than throwing.
 *
 * @param {*} protocol
 * @returns {string}
 */
export function resolveProtocolId(protocol) {
    return typeof protocol === 'string' && PROTOCOLS[protocol]
        ? protocol
        : RequestMode.HTTP;
}

/**
 * Looks up a protocol descriptor, never returning undefined.
 *
 * @param {*} protocol
 * @returns {ProtocolDescriptor}
 */
export function getProtocol(protocol) {
    return PROTOCOLS[resolveProtocolId(protocol)];
}

/**
 * Reverse-maps a stored tree badge to a protocol id.
 *
 * Lets an endpoint whose `method` was written correctly recover its protocol
 * even if `protocol` was stored as `http`.
 *
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

/**
 * @returns {string[]} All known protocol ids.
 */
export function listProtocolIds() {
    return Object.keys(PROTOCOLS);
}

/**
 * Derives the value stored as `endpoint.path` for a protocol.
 *
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
 * Derives the method stored on a collection endpoint.
 *
 * @param {ProtocolDescriptor} descriptor
 * @param {Object} requestData
 * @returns {string|undefined}
 */
export function deriveMethod(descriptor, requestData) {
    return descriptor.methodLabel || requestData.method;
}

/**
 * Derives the HTTP verb to store alongside a protocol badge, if any.
 *
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
 * Reads back the verb a request should be sent with.
 *
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
 * Masks stored endpoint data down to the kinds a protocol actually uses.
 *
 * Suppressed kinds come back as the type-correct empty value, so callers can
 * spread the result without per-protocol conditionals.
 *
 * @param {ProtocolDescriptor} descriptor
 * @param {Object} persistedData - Result of getAllPersistedEndpointData().
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
