/**
 * @fileoverview Generates request code snippets for various languages and clients (cURL,
 * Python, JavaScript, Node.js, Go, PHP, Ruby, Java) from a request configuration.
 * @module codeGenerator
 */

/**
 * A request to generate code for.
 *
 * @typedef {Object} RequestConfig
 * @property {string} [method] - HTTP method; defaults to `GET`.
 * @property {string} url - Target request URL.
 * @property {Object<string, string>} [headers] - Header name/value pairs.
 * @property {string|Object|Array} [body] - Request body. For `bodyType`
 *   `formdata`/`urlencoded` this is an array of row objects
 *   (`{ key, value, type, filePath, contentType }`); for `binary` it is
 *   `{ filePath, contentType }`; otherwise a string or JSON object.
 * @property {string} [bodyType] - `formdata` | `urlencoded` | `text` | `binary`;
 *   absent for JSON bodies.
 */

/**
 * Escapes a string for safe use as a single-quoted POSIX shell argument.
 *
 * @param {string} str - The raw value.
 * @returns {string} The quoted, shell-safe argument.
 */
function escapeShellArg(str) {
    if (!str) {
        return "''";
    }
    return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Escapes a string for use inside a double-quoted Python/PHP/Ruby string literal.
 *
 * @param {string} str - The raw value.
 * @returns {string} The escaped value.
 */
function escapePythonString(str) {
    if (!str) {
        return '';
    }
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Escapes a string for use inside a JavaScript template literal.
 *
 * @param {string} str - The raw value.
 * @returns {string} The escaped value.
 */
function escapeJavaScriptString(str) {
    if (!str) {
        return '';
    }
    return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

/**
 * Escapes a string for use inside a double-quoted Go/Java string literal.
 *
 * @param {string} str - The raw value.
 * @returns {string} The escaped value.
 */
function escapeGoString(str) {
    if (!str) {
        return '';
    }
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Whether the request carries a body, normalizing the method so a lowercase
 * method (e.g. `"post"`) is treated the same as its uppercase form. Form and
 * binary bodies count regardless of method, matching how requests are sent.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {boolean} True when a body should be emitted.
 */
function hasBody(config) {
    if (isFormDataBody(config) || isUrlencodedBody(config) || isBinaryBody(config)) {
        return true;
    }
    return Boolean(config.body) && ['POST', 'PUT', 'PATCH'].includes((config.method || 'GET').toUpperCase());
}

/**
 * Whether the config carries a multipart form-data body.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {boolean}
 */
function isFormDataBody(config) {
    return config.bodyType === 'formdata' && Boolean(config.body) && typeof config.body === 'object';
}

/**
 * Whether the config carries a URL-encoded form body.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {boolean}
 */
function isUrlencodedBody(config) {
    return config.bodyType === 'urlencoded' && Boolean(config.body) && typeof config.body === 'object';
}

/**
 * Whether the config carries a binary file body.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {boolean}
 */
function isBinaryBody(config) {
    return config.bodyType === 'binary' && Boolean(config.body?.filePath);
}

/**
 * Returns form body rows in the canonical array shape, converting the legacy
 * flat `{key: value}` object shape to text rows.
 *
 * @param {string|Object|Array} body - The form body.
 * @returns {Array<{key: string, value?: string, type?: string, filePath?: string, contentType?: string}>}
 */
function bodyRows(body) {
    if (Array.isArray(body)) {
        return body.filter((row) => row && row.key);
    }
    if (body && typeof body === 'object') {
        return Object.entries(body).map(([key, value]) => ({ key, value: String(value), type: 'text' }));
    }
    return [];
}

/**
 * Extracts the file name from a path for snippet display.
 *
 * @param {string} filePath - Absolute or relative file path.
 * @returns {string}
 */
function baseName(filePath) {
    const parts = String(filePath).split(/[\\/]/);
    return parts[parts.length - 1] || 'file';
}

/**
 * Resolves the body for generators that emit a single string payload.
 * URL-encoded row arrays become an encoded string; form-data and binary
 * bodies cannot be represented portably and yield a comment instead.
 *
 * @param {RequestConfig} config - The request configuration.
 * @param {boolean} [pretty=false] - Pretty-print JSON object bodies.
 * @returns {{text: (string|null), comment: (string|null)}}
 */
function resolveSnippetBody(config, pretty = false) {
    if (isUrlencodedBody(config)) {
        const encoded = bodyRows(config.body)
            .map((row) => `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value || '')}`)
            .join('&');
        return { text: encoded || null, comment: null };
    }
    if (isFormDataBody(config) || isBinaryBody(config)) {
        return { text: null, comment: 'File upload bodies are only generated for cURL and Python snippets.' };
    }
    if (hasBody(config)) {
        return { text: stringifyBody(config.body, pretty), comment: null };
    }
    return { text: null, comment: null };
}

/**
 * Serializes a request body to a string. Objects are JSON-encoded.
 *
 * @param {string|Object} body - The request body.
 * @param {boolean} [pretty=false] - Pretty-print JSON objects with 2-space indentation.
 * @returns {string} The serialized body.
 */
function stringifyBody(body, pretty = false) {
    return typeof body === 'string' ? body : JSON.stringify(body, null, pretty ? 2 : undefined);
}

/**
 * Returns the non-empty header entries (both key and value truthy) of a config.
 *
 * @param {Object<string, string>} [headers] - Header name/value pairs.
 * @returns {Array<[string, string]>} The retained header entries.
 */
function validHeaders(headers) {
    return Object.entries(headers || {}).filter(([key, value]) => key && value);
}

/**
 * Generates a cURL command for the given request.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {string} The generated cURL command.
 */
function generateCurl(config) {
    const { method, url, headers, body } = config;
    const curlParts = ['curl'];

    if (method && method !== 'GET') {
        curlParts.push(`-X ${method}`);
    }

    const skipContentType = isFormDataBody(config) || isUrlencodedBody(config);
    for (const [key, value] of validHeaders(headers)) {
        if (skipContentType && key.toLowerCase() === 'content-type') {
            continue;
        }
        curlParts.push(`-H ${escapeShellArg(`${key}: ${value}`)}`);
    }

    if (isFormDataBody(config)) {
        for (const row of bodyRows(body)) {
            const spec = row.type === 'file'
                ? `${row.key}=@${row.filePath || ''}${row.contentType ? `;type=${row.contentType}` : ''}`
                : `${row.key}=${row.value || ''}`;
            curlParts.push(`-F ${escapeShellArg(spec)}`);
        }
    } else if (isUrlencodedBody(config)) {
        for (const row of bodyRows(body)) {
            curlParts.push(`--data-urlencode ${escapeShellArg(`${row.key}=${row.value || ''}`)}`);
        }
    } else if (isBinaryBody(config)) {
        const hasContentTypeHeader = validHeaders(headers).some(([key]) => key.toLowerCase() === 'content-type');
        if (!hasContentTypeHeader) {
            curlParts.push(`-H ${escapeShellArg(`Content-Type: ${body.contentType || 'application/octet-stream'}`)}`);
        }
        curlParts.push(`--data-binary ${escapeShellArg(`@${body.filePath}`)}`);
    } else if (hasBody(config)) {
        curlParts.push(`-d ${escapeShellArg(stringifyBody(body))}`);
    }

    curlParts.push(escapeShellArg(url));

    return curlParts.join(' \\\n  ');
}

/**
 * Generates Python code using the `requests` library.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {string} The generated Python code.
 */
function generatePythonRequests(config) {
    const { method, url, headers, body } = config;
    const hdrs = validHeaders(headers);
    const lines = [];

    lines.push('import requests');
    lines.push('');

    lines.push(`url = "${escapePythonString(url)}"`);
    lines.push('');

    if (hdrs.length > 0) {
        lines.push('headers = {');
        lines.push(hdrs.map(([key, value]) => `    "${escapePythonString(key)}": "${escapePythonString(value)}"`).join(',\n'));
        lines.push('}');
        lines.push('');
    }

    const methodLower = (method || 'GET').toLowerCase();
    const requestParts = [`requests.${methodLower}(url`];

    if (hdrs.length > 0) {
        requestParts.push('headers=headers');
    }

    if (isFormDataBody(config)) {
        const rows = bodyRows(body);
        const fileRows = rows.filter((row) => row.type === 'file');
        const textRows = rows.filter((row) => row.type !== 'file');
        if (fileRows.length > 0) {
            lines.push('files = {');
            lines.push(fileRows.map((row) => {
                const mime = row.contentType
                    ? `, "${escapePythonString(row.contentType)}"`
                    : '';
                return `    "${escapePythonString(row.key)}": ("${escapePythonString(baseName(row.filePath))}", open("${escapePythonString(row.filePath || '')}", "rb")${mime})`;
            }).join(',\n'));
            lines.push('}');
            lines.push('');
            requestParts.push('files=files');
        }
        if (textRows.length > 0) {
            lines.push('data = {');
            lines.push(textRows.map((row) => `    "${escapePythonString(row.key)}": "${escapePythonString(row.value || '')}"`).join(',\n'));
            lines.push('}');
            lines.push('');
            requestParts.push('data=data');
        }
    } else if (isUrlencodedBody(config)) {
        lines.push('data = [');
        lines.push(bodyRows(body).map((row) => `    ("${escapePythonString(row.key)}", "${escapePythonString(row.value || '')}")`).join(',\n'));
        lines.push(']');
        lines.push('');
        requestParts.push('data=data');
    } else if (isBinaryBody(config)) {
        lines.push(`data = open("${escapePythonString(body.filePath)}", "rb")`);
        lines.push('');
        requestParts.push('data=data');
    } else if (hasBody(config)) {
        lines.push(`data = """${stringifyBody(body, true)}"""`);
        lines.push('');
        requestParts.push('data=data');
    }

    lines.push(`response = ${requestParts.join(', ')})`);
    lines.push('');
    lines.push('print(response.status_code)');
    lines.push('print(response.text)');

    return lines.join('\n');
}

/**
 * Generates JavaScript code using the Fetch API.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {string} The generated JavaScript code.
 */
function generateJavaScriptFetch(config) {
    const { method, url, headers } = config;
    const hdrs = validHeaders(headers);
    const lines = [];

    lines.push(`fetch(\`${escapeJavaScriptString(url)}\`, {`);
    lines.push(`  method: '${method || 'GET'}',`);

    if (hdrs.length > 0) {
        lines.push('  headers: {');
        lines.push(hdrs.map(([key, value]) => `    '${escapeJavaScriptString(key)}': '${escapeJavaScriptString(value)}'`).join(',\n'));
        lines.push('  },');
    }

    const bodyInfo = resolveSnippetBody(config, true);
    if (bodyInfo.text !== null) {
        lines.push(`  body: \`${escapeJavaScriptString(bodyInfo.text)}\``);
    } else if (bodyInfo.comment) {
        lines.push(`  // ${bodyInfo.comment}`);
    }

    lines.push('})');
    lines.push('  .then(response => response.text())');
    lines.push('  .then(data => console.log(data))');
    lines.push('  .catch(error => console.error(\'Error:\', error));');

    return lines.join('\n');
}

/**
 * Generates JavaScript code using the Axios library.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {string} The generated JavaScript code.
 */
function generateJavaScriptAxios(config) {
    const { method, url, headers } = config;
    const hdrs = validHeaders(headers);
    const lines = [];

    lines.push('const axios = require(\'axios\');');
    lines.push('');

    lines.push('const config = {');
    lines.push(`  method: '${(method || 'GET').toLowerCase()}',`);
    lines.push(`  url: \`${escapeJavaScriptString(url)}\`,`);

    if (hdrs.length > 0) {
        lines.push('  headers: {');
        lines.push(hdrs.map(([key, value]) => `    '${escapeJavaScriptString(key)}': '${escapeJavaScriptString(value)}'`).join(',\n'));
        lines.push('  },');
    }

    const bodyInfo = resolveSnippetBody(config, true);
    if (bodyInfo.text !== null) {
        lines.push(`  data: \`${escapeJavaScriptString(bodyInfo.text)}\``);
    } else if (bodyInfo.comment) {
        lines.push(`  // ${bodyInfo.comment}`);
    }

    lines.push('};');
    lines.push('');
    lines.push('axios(config)');
    lines.push('  .then(response => console.log(response.data))');
    lines.push('  .catch(error => console.error(error));');

    return lines.join('\n');
}

/**
 * Generates Go code using the `net/http` package.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {string} The generated Go code.
 */
function generateGo(config) {
    const { method, url, headers } = config;
    const bodyInfo = resolveSnippetBody(config);
    const includeBody = bodyInfo.text !== null;
    const hdrs = validHeaders(headers);
    const lines = [];

    lines.push('package main');
    lines.push('');
    lines.push('import (');
    lines.push('    "fmt"');
    lines.push('    "io"');
    lines.push('    "net/http"');
    if (includeBody) {
        lines.push('    "strings"');
    }
    lines.push(')');
    lines.push('');
    lines.push('func main() {');

    if (includeBody) {
        lines.push(`    payload := strings.NewReader(\`${escapeGoString(bodyInfo.text)}\`)`);
        lines.push('');
    } else if (bodyInfo.comment) {
        lines.push(`    // ${bodyInfo.comment}`);
        lines.push('');
    }

    const bodyArg = includeBody ? 'payload' : 'nil';
    lines.push(`    req, err := http.NewRequest("${method || 'GET'}", "${escapeGoString(url)}", ${bodyArg})`);
    lines.push('    if err != nil {');
    lines.push('        fmt.Println(err)');
    lines.push('        return');
    lines.push('    }');
    lines.push('');

    if (hdrs.length > 0) {
        for (const [key, value] of hdrs) {
            lines.push(`    req.Header.Add("${escapeGoString(key)}", "${escapeGoString(value)}")`);
        }
        lines.push('');
    }

    lines.push('    client := &http.Client{}');
    lines.push('    res, err := client.Do(req)');
    lines.push('    if err != nil {');
    lines.push('        fmt.Println(err)');
    lines.push('        return');
    lines.push('    }');
    lines.push('    defer res.Body.Close()');
    lines.push('');
    lines.push('    body, err := io.ReadAll(res.Body)');
    lines.push('    if err != nil {');
    lines.push('        fmt.Println(err)');
    lines.push('        return');
    lines.push('    }');
    lines.push('');
    lines.push('    fmt.Println(string(body))');
    lines.push('}');

    return lines.join('\n');
}

/**
 * Generates Node.js code using the built-in `http`/`https` module.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {string} The generated Node.js code.
 */
function generateNodeJs(config) {
    const { method, url, headers } = config;
    const hdrs = validHeaders(headers);
    const lines = [];

    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const moduleName = isHttps ? 'https' : 'http';

    lines.push(`const ${moduleName} = require('${moduleName}');`);
    lines.push('');

    lines.push('const options = {');
    lines.push(`  hostname: '${escapeJavaScriptString(urlObj.hostname)}',`);
    if (urlObj.port) {
        lines.push(`  port: ${urlObj.port},`);
    }
    lines.push(`  path: '${escapeJavaScriptString(urlObj.pathname + urlObj.search)}',`);
    lines.push(`  method: '${method || 'GET'}',`);

    if (hdrs.length > 0) {
        lines.push('  headers: {');
        lines.push(hdrs.map(([key, value]) => `    '${escapeJavaScriptString(key)}': '${escapeJavaScriptString(value)}'`).join(',\n'));
        lines.push('  }');
    }

    lines.push('};');
    lines.push('');

    lines.push(`const req = ${moduleName}.request(options, (res) => {`);
    lines.push('  let data = \'\';');
    lines.push('');
    lines.push('  res.on(\'data\', (chunk) => {');
    lines.push('    data += chunk;');
    lines.push('  });');
    lines.push('');
    lines.push('  res.on(\'end\', () => {');
    lines.push('    console.log(data);');
    lines.push('  });');
    lines.push('});');
    lines.push('');
    lines.push('req.on(\'error\', (error) => {');
    lines.push('  console.error(error);');
    lines.push('});');
    lines.push('');

    const bodyInfo = resolveSnippetBody(config);
    if (bodyInfo.text !== null) {
        lines.push(`req.write(\`${escapeJavaScriptString(bodyInfo.text)}\`);`);
    } else if (bodyInfo.comment) {
        lines.push(`// ${bodyInfo.comment}`);
    }

    lines.push('req.end();');

    return lines.join('\n');
}

/**
 * Generates PHP code using the cURL extension.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {string} The generated PHP code.
 */
function generatePhp(config) {
    const { method, url, headers } = config;
    const hdrs = validHeaders(headers);
    const lines = [];

    lines.push('<?php');
    lines.push('');
    lines.push('$curl = curl_init();');
    lines.push('');

    lines.push('curl_setopt_array($curl, [');
    lines.push(`  CURLOPT_URL => "${escapePythonString(url)}",`);
    lines.push('  CURLOPT_RETURNTRANSFER => true,');
    lines.push('  CURLOPT_ENCODING => "",');
    lines.push('  CURLOPT_MAXREDIRS => 10,');
    lines.push('  CURLOPT_TIMEOUT => 30,');
    lines.push(`  CURLOPT_CUSTOMREQUEST => "${method || 'GET'}",`);

    const bodyInfo = resolveSnippetBody(config);
    if (bodyInfo.text !== null) {
        lines.push(`  CURLOPT_POSTFIELDS => "${escapePythonString(bodyInfo.text)}",`);
    } else if (bodyInfo.comment) {
        lines.push(`  // ${bodyInfo.comment}`);
    }

    if (hdrs.length > 0) {
        lines.push('  CURLOPT_HTTPHEADER => [');
        lines.push(hdrs.map(([key, value]) => `    "${escapePythonString(key)}: ${escapePythonString(value)}"`).join(',\n'));
        lines.push('  ],');
    }

    lines.push(']);');
    lines.push('');
    lines.push('$response = curl_exec($curl);');
    lines.push('$err = curl_error($curl);');
    lines.push('');
    lines.push('curl_close($curl);');
    lines.push('');
    lines.push('if ($err) {');
    lines.push('  echo "cURL Error: " . $err;');
    lines.push('} else {');
    lines.push('  echo $response;');
    lines.push('}');
    lines.push('?>');

    return lines.join('\n');
}

/**
 * Generates Ruby code using the `net/http` library.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {string} The generated Ruby code.
 */
function generateRuby(config) {
    const { method, url, headers } = config;
    const lines = [];

    lines.push('require "uri"');
    lines.push('require "net/http"');
    lines.push('');

    lines.push(`url = URI("${escapePythonString(url)}")`);
    lines.push('');

    lines.push('http = Net::HTTP.new(url.host, url.port)');

    const urlObj = new URL(url);
    if (urlObj.protocol === 'https:') {
        lines.push('http.use_ssl = true');
    }
    lines.push('');

    const methodCapitalized = (method || 'GET').charAt(0).toUpperCase() + (method || 'GET').slice(1).toLowerCase();
    lines.push(`request = Net::HTTP::${methodCapitalized}.new(url)`);

    for (const [key, value] of validHeaders(headers)) {
        lines.push(`request["${escapePythonString(key)}"] = "${escapePythonString(value)}"`);
    }

    const bodyInfo = resolveSnippetBody(config);
    if (bodyInfo.text !== null) {
        lines.push(`request.body = "${escapePythonString(bodyInfo.text)}"`);
    } else if (bodyInfo.comment) {
        lines.push(`# ${bodyInfo.comment}`);
    }

    lines.push('');
    lines.push('response = http.request(request)');
    lines.push('puts response.read_body');

    return lines.join('\n');
}

/**
 * Generates Java code using the `java.net.http.HttpClient` API.
 *
 * @param {RequestConfig} config - The request configuration.
 * @returns {string} The generated Java code.
 */
function generateJava(config) {
    const { method, url, headers } = config;
    const lines = [];

    lines.push('import java.net.URI;');
    lines.push('import java.net.http.HttpClient;');
    lines.push('import java.net.http.HttpRequest;');
    lines.push('import java.net.http.HttpResponse;');
    lines.push('');
    lines.push('public class ApiRequest {');
    lines.push('    public static void main(String[] args) throws Exception {');
    lines.push('        HttpClient client = HttpClient.newHttpClient();');
    lines.push('');

    lines.push('        HttpRequest.Builder requestBuilder = HttpRequest.newBuilder()');
    lines.push(`            .uri(URI.create("${escapeGoString(url)}"))`);

    for (const [key, value] of validHeaders(headers)) {
        lines.push(`            .header("${escapeGoString(key)}", "${escapeGoString(value)}")`);
    }

    const methodUpper = (method || 'GET').toUpperCase();
    const bodyInfo = resolveSnippetBody(config);
    if (bodyInfo.text !== null) {
        lines.push(`            .${methodUpper}(HttpRequest.BodyPublishers.ofString("${escapeGoString(bodyInfo.text)}"))`);
    } else {
        if (bodyInfo.comment) {
            lines.push(`            // ${bodyInfo.comment}`);
        }
        lines.push(`            .${methodUpper}(HttpRequest.BodyPublishers.noBody())`);
    }

    lines.push('            .build();');
    lines.push('');
    lines.push('        HttpResponse<String> response = client.send(requestBuilder,');
    lines.push('            HttpResponse.BodyHandlers.ofString());');
    lines.push('');
    lines.push('        System.out.println(response.statusCode());');
    lines.push('        System.out.println(response.body());');
    lines.push('    }');
    lines.push('}');

    return lines.join('\n');
}

/**
 * Registered code generators — the single source of truth for both dispatch
 * ({@link generateCode}) and the UI list ({@link SUPPORTED_LANGUAGES}). Add a language by
 * appending one entry here; nothing else needs to change.
 *
 * @type {Array<{ id: string, name: string, description: string, generate: (config: RequestConfig) => string }>}
 */
const GENERATORS = [
    { id: 'curl', name: 'cURL', description: 'Command line', generate: generateCurl },
    { id: 'python', name: 'Python', description: 'requests library', generate: generatePythonRequests },
    { id: 'javascript-fetch', name: 'JavaScript', description: 'Fetch API', generate: generateJavaScriptFetch },
    { id: 'javascript-axios', name: 'JavaScript', description: 'Axios', generate: generateJavaScriptAxios },
    { id: 'nodejs', name: 'Node.js', description: 'https module', generate: generateNodeJs },
    { id: 'go', name: 'Go', description: 'net/http', generate: generateGo },
    { id: 'php', name: 'PHP', description: 'cURL', generate: generatePhp },
    { id: 'ruby', name: 'Ruby', description: 'net/http', generate: generateRuby },
    { id: 'java', name: 'Java', description: 'HttpClient', generate: generateJava },
];

/**
 * Generates request code for the given language.
 *
 * @param {string} language - One of the {@link SUPPORTED_LANGUAGES} ids.
 * @param {RequestConfig} config - The request configuration.
 * @returns {string} The generated code snippet.
 * @throws {Error} If the language is not supported.
 */
export function generateCode(language, config) {
    const entry = GENERATORS.find((g) => g.id === language);
    if (!entry) {
        throw new Error(`Unsupported language: ${language}`);
    }
    return entry.generate(config);
}

/**
 * Languages and clients supported by {@link generateCode}, for populating UI selectors.
 *
 * @type {Array<{ id: string, name: string, description: string }>}
 */
export const SUPPORTED_LANGUAGES = GENERATORS.map(({ id, name, description }) => ({ id, name, description }));
