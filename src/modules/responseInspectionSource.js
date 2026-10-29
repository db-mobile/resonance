/** Build a typed, immutable query source independently of editor highlighting. */
export function responseInspectionSource(response) {
    if (!response || !Object.hasOwn(response, 'data')) { return { unavailable: 'unavailable' }; }
    if (response.truncated) { return { unavailable: 'truncated' }; }
    if (response.isBinary) { return { unavailable: 'binary' }; }
    if (response.websocket || response.sse || response.mqtt || response.grpc?.streaming) {
        return { unavailable: 'unavailable' };
    }
    const { data } = response;
    if (response.isJson === true) {
        return { format: 'json', body: JSON.stringify(data) };
    }
    if (typeof data !== 'string') {
        return data !== null && data !== undefined
            ? { format: 'json', body: JSON.stringify(data) } : { unavailable: 'unavailable' };
    }
    if (data === '') { return { unavailable: 'unavailable' }; }
    const contentType = Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
    if (/\b(?:application|text)\/(?:[\w.+-]*\+)?xml\b/i.test(contentType) ||
        (!/html|json/i.test(contentType) && /^\s*(?:<\?xml\b|<[A-Za-z_][\w.:-]*(?:\s|\/?>))/.test(data))) {
        return { format: 'xml', body: data };
    }
    // Older records cannot distinguish a decoded JSON string from serialized JSON.
    if (response.isJson === false && /json/i.test(contentType)) {
        return { format: 'json', body: data };
    }
    return { unavailable: response.isJson === undefined ? 'legacy' : 'unavailable' };
}
