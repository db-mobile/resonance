/**
 * @fileoverview Generates request code snippets for various languages and clients (cURL,
 * @module codeGenerator
 */

/**
 * @typedef {Object} RequestConfig
 * @property {string} [method]
 * @property {string} url
 * @property {Object<string, string>} [headers]
 * @property {string|Object|Array} [body]
 * @property {string} [bodyType]
 */

/**
 * @param {string} str
 * @returns {string}
 */
function escapeShellArg(str) {
    if (!str) {
        return "''";
    }
    return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapePythonString(str) {
    if (!str) {
        return '';
    }
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapeJavaScriptString(str) {
    if (!str) {
        return '';
    }
    return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapeGoString(str) {
    if (!str) {
        return '';
    }
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapeJsSingleQuoted(str) {
    if (!str) {
        return '';
    }
    return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapePhpDoubleQuoted(str) {
    if (!str) {
        return '';
    }
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapeRubyDoubleQuoted(str) {
    if (!str) {
        return '';
    }
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/#([{@$])/g, '\\#$1')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

/**
 * @param {RequestConfig} config
 * @returns {boolean}
 */
function hasBody(config) {
    if (isFormDataBody(config) || isUrlencodedBody(config) || isBinaryBody(config)) {
        return true;
    }
    return Boolean(config.body) && ['POST', 'PUT', 'PATCH'].includes((config.method || 'GET').toUpperCase());
}

/**
 * @param {RequestConfig} config
 * @returns {boolean}
 */
function isFormDataBody(config) {
    return config.bodyType === 'formdata' && Boolean(config.body) && typeof config.body === 'object';
}

/**
 * @param {RequestConfig} config
 * @returns {boolean}
 */
function isUrlencodedBody(config) {
    return config.bodyType === 'urlencoded' && Boolean(config.body) && typeof config.body === 'object';
}

/**
 * @param {RequestConfig} config
 * @returns {boolean}
 */
function isBinaryBody(config) {
    return config.bodyType === 'binary' && Boolean(config.body?.filePath);
}

/**
 * @param {string|Object|Array} body
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
 * @param {string} filePath
 * @returns {string}
 */
function baseName(filePath) {
    const parts = String(filePath).split(/[\\/]/);
    return parts[parts.length - 1] || 'file';
}

/**
 * @param {RequestConfig} config
 * @param {boolean} [pretty=false]
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
 * @param {string|Object} body
 * @param {boolean} [pretty=false]
 * @returns {string}
 */
function stringifyBody(body, pretty = false) {
    return typeof body === 'string' ? body : JSON.stringify(body, null, pretty ? 2 : undefined);
}

/**
 * @param {Object<string, string>} [headers]
 * @returns {Array<[string, string]>}
 */
function validHeaders(headers) {
    return Object.entries(headers || {}).filter(([key, value]) => key && value);
}

/**
 * @param {RequestConfig} config
 * @returns {string}
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
 * @param {RequestConfig} config
 * @returns {string}
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
        lines.push(`data = "${escapePythonString(stringifyBody(body))}"`);
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
 * @param {RequestConfig} config
 * @returns {string}
 */
function generateJavaScriptFetch(config) {
    const { method, url, headers } = config;
    const hdrs = validHeaders(headers);
    const lines = [];

    lines.push(`fetch(\`${escapeJavaScriptString(url)}\`, {`);
    lines.push(`  method: '${method || 'GET'}',`);

    if (hdrs.length > 0) {
        lines.push('  headers: {');
        lines.push(hdrs.map(([key, value]) => `    '${escapeJsSingleQuoted(key)}': '${escapeJsSingleQuoted(value)}'`).join(',\n'));
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
 * @param {RequestConfig} config
 * @returns {string}
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
        lines.push(hdrs.map(([key, value]) => `    '${escapeJsSingleQuoted(key)}': '${escapeJsSingleQuoted(value)}'`).join(',\n'));
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
 * @param {RequestConfig} config
 * @returns {string}
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
        lines.push(`    payload := strings.NewReader("${escapeGoString(bodyInfo.text)}")`);
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
 * @param {RequestConfig} config
 * @returns {string}
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
    lines.push(`  hostname: '${escapeJsSingleQuoted(urlObj.hostname)}',`);
    if (urlObj.port) {
        lines.push(`  port: ${urlObj.port},`);
    }
    lines.push(`  path: '${escapeJsSingleQuoted(urlObj.pathname + urlObj.search)}',`);
    lines.push(`  method: '${method || 'GET'}',`);

    if (hdrs.length > 0) {
        lines.push('  headers: {');
        lines.push(hdrs.map(([key, value]) => `    '${escapeJsSingleQuoted(key)}': '${escapeJsSingleQuoted(value)}'`).join(',\n'));
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
 * @param {RequestConfig} config
 * @returns {string}
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
    lines.push(`  CURLOPT_URL => "${escapePhpDoubleQuoted(url)}",`);
    lines.push('  CURLOPT_RETURNTRANSFER => true,');
    lines.push('  CURLOPT_ENCODING => "",');
    lines.push('  CURLOPT_MAXREDIRS => 10,');
    lines.push('  CURLOPT_TIMEOUT => 30,');
    lines.push(`  CURLOPT_CUSTOMREQUEST => "${method || 'GET'}",`);

    const bodyInfo = resolveSnippetBody(config);
    if (bodyInfo.text !== null) {
        lines.push(`  CURLOPT_POSTFIELDS => "${escapePhpDoubleQuoted(bodyInfo.text)}",`);
    } else if (bodyInfo.comment) {
        lines.push(`  // ${bodyInfo.comment}`);
    }

    if (hdrs.length > 0) {
        lines.push('  CURLOPT_HTTPHEADER => [');
        lines.push(hdrs.map(([key, value]) => `    "${escapePhpDoubleQuoted(key)}: ${escapePhpDoubleQuoted(value)}"`).join(',\n'));
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
 * @param {RequestConfig} config
 * @returns {string}
 */
function generateRuby(config) {
    const { method, url, headers } = config;
    const lines = [];

    lines.push('require "uri"');
    lines.push('require "net/http"');
    lines.push('');

    lines.push(`url = URI("${escapeRubyDoubleQuoted(url)}")`);
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
        lines.push(`request["${escapeRubyDoubleQuoted(key)}"] = "${escapeRubyDoubleQuoted(value)}"`);
    }

    const bodyInfo = resolveSnippetBody(config);
    if (bodyInfo.text !== null) {
        lines.push(`request.body = "${escapeRubyDoubleQuoted(bodyInfo.text)}"`);
    } else if (bodyInfo.comment) {
        lines.push(`# ${bodyInfo.comment}`);
    }

    lines.push('');
    lines.push('response = http.request(request)');
    lines.push('puts response.read_body');

    return lines.join('\n');
}

/**
 * @param {string} method
 * @param {string|null} bodyText
 * @returns {string}
 */
function javaMethodCall(method, bodyText) {
    const hasBodyText = bodyText !== null;
    const publisher = hasBodyText
        ? `HttpRequest.BodyPublishers.ofString("${escapeGoString(bodyText)}")`
        : 'HttpRequest.BodyPublishers.noBody()';

    if (method === 'POST' || method === 'PUT') {
        return `.${method}(${publisher})`;
    }
    if (!hasBodyText && (method === 'GET' || method === 'DELETE')) {
        return `.${method}()`;
    }
    return `.method("${method}", ${publisher})`;
}

/**
 * @param {RequestConfig} config
 * @returns {string}
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

    lines.push('        HttpRequest request = HttpRequest.newBuilder()');
    lines.push(`            .uri(URI.create("${escapeGoString(url)}"))`);

    for (const [key, value] of validHeaders(headers)) {
        lines.push(`            .header("${escapeGoString(key)}", "${escapeGoString(value)}")`);
    }

    const methodUpper = (method || 'GET').toUpperCase();
    const bodyInfo = resolveSnippetBody(config);
    if (bodyInfo.comment) {
        lines.push(`            // ${bodyInfo.comment}`);
    }
    lines.push(`            ${javaMethodCall(methodUpper, bodyInfo.text)}`);

    lines.push('            .build();');
    lines.push('');
    lines.push('        HttpResponse<String> response = client.send(request,');
    lines.push('            HttpResponse.BodyHandlers.ofString());');
    lines.push('');
    lines.push('        System.out.println(response.statusCode());');
    lines.push('        System.out.println(response.body());');
    lines.push('    }');
    lines.push('}');

    return lines.join('\n');
}

/** @type {Array<{ id: string, name: string, description: string, generate: (config: RequestConfig) => string }>} */
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
 * @param {string} language
 * @param {RequestConfig} config
 * @returns {string}
 */
export function generateCode(language, config) {
    const entry = GENERATORS.find((g) => g.id === language);
    if (!entry) {
        throw new Error(`Unsupported language: ${language}`);
    }
    return entry.generate(config);
}

/** @type {Array<{ id: string, name: string, description: string }>} */
export const SUPPORTED_LANGUAGES = GENERATORS.map(({ id, name, description }) => ({ id, name, description }));
