function escapeShellArg(str) {
    if (!str) return "''";

    return "'" + str.replace(/'/g, "'\\''") + "'";
}

export function generateCurlCommand(config) {
    const { method, url, headers, body } = config;

    let curlParts = ['curl'];

    if (method && method !== 'GET') {
        curlParts.push(`-X ${method}`);
    }

    if (headers && Object.keys(headers).length > 0) {
        for (const [key, value] of Object.entries(headers)) {
            if (key && value) {
                curlParts.push(`-H ${escapeShellArg(`${key}: ${value}`)}`);
            }
        }
    }

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        const bodyString = typeof body === 'string'
            ? body
            : JSON.stringify(body);
        curlParts.push(`-d ${escapeShellArg(bodyString)}`);
    }

    curlParts.push(escapeShellArg(url));

    return curlParts.join(' \\\n  ');
}
