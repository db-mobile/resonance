// Multi-language code generator for API requests

// Helper function to escape shell arguments for cURL
function escapeShellArg(str) {
    if (!str) {
        return "''";
    }
    return `'${str.replace(/'/g, "'\\''")}'`;
}

// Helper function to escape strings for Python
function escapePythonString(str) {
    if (!str) {
        return '';
    }
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// Helper function to escape strings for JavaScript
function escapeJavaScriptString(str) {
    if (!str) {
        return '';
    }
    return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

// Helper function to escape strings for Go
function escapeGoString(str) {
    if (!str) {
        return '';
    }
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// cURL Generator
function generateCurl(config) {
    const { method, url, headers, body } = config;
    const curlParts = ['curl'];

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
        const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
        curlParts.push(`-d ${escapeShellArg(bodyString)}`);
    }

    curlParts.push(escapeShellArg(url));

    return curlParts.join(' \\\n  ');
}

// Python (requests) Generator
function generatePythonRequests(config) {
    const { method, url, headers, body } = config;
    const lines = [];

    lines.push('import requests');
    lines.push('');

    // URL
    lines.push(`url = "${escapePythonString(url)}"`);
    lines.push('');

    // Headers
    if (headers && Object.keys(headers).length > 0) {
        lines.push('headers = {');
        const headerLines = Object.entries(headers)
            .filter(([key, value]) => key && value)
            .map(([key, value]) => `    "${escapePythonString(key)}": "${escapePythonString(value)}"`);
        lines.push(headerLines.join(',\n'));
        lines.push('}');
        lines.push('');
    }

    // Body
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        const bodyString = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
        lines.push(`data = """${  bodyString  }"""`);
        lines.push('');
    }

    // Request
    const methodLower = (method || 'GET').toLowerCase();
    const requestParts = [`requests.${methodLower}(url`];

    if (headers && Object.keys(headers).length > 0) {
        requestParts.push('headers=headers');
    }

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        requestParts.push('data=data');
    }

    lines.push(`response = ${requestParts.join(', ')})`);
    lines.push('');
    lines.push('print(response.status_code)');
    lines.push('print(response.text)');

    return lines.join('\n');
}

// JavaScript (fetch) Generator
function generateJavaScriptFetch(config) {
    const { method, url, headers, body } = config;
    const lines = [];

    lines.push(`fetch(\`${escapeJavaScriptString(url)}\`, {`);
    lines.push(`  method: '${method || 'GET'}',`);

    // Headers
    if (headers && Object.keys(headers).length > 0) {
        lines.push('  headers: {');
        const headerLines = Object.entries(headers)
            .filter(([key, value]) => key && value)
            .map(([key, value]) => `    '${escapeJavaScriptString(key)}': '${escapeJavaScriptString(value)}'`);
        lines.push(headerLines.join(',\n'));
        lines.push('  },');
    }

    // Body
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        const bodyString = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
        lines.push(`  body: \`${escapeJavaScriptString(bodyString)}\``);
    }

    lines.push('})');
    lines.push('  .then(response => response.text())');
    lines.push('  .then(data => console.log(data))');
    lines.push('  .catch(error => console.error(\'Error:\', error));');

    return lines.join('\n');
}

// JavaScript (axios) Generator
function generateJavaScriptAxios(config) {
    const { method, url, headers, body } = config;
    const lines = [];

    lines.push('const axios = require(\'axios\');');
    lines.push('');

    lines.push('const config = {');
    lines.push(`  method: '${(method || 'GET').toLowerCase()}',`);
    lines.push(`  url: \`${escapeJavaScriptString(url)}\`,`);

    // Headers
    if (headers && Object.keys(headers).length > 0) {
        lines.push('  headers: {');
        const headerLines = Object.entries(headers)
            .filter(([key, value]) => key && value)
            .map(([key, value]) => `    '${escapeJavaScriptString(key)}': '${escapeJavaScriptString(value)}'`);
        lines.push(headerLines.join(',\n'));
        lines.push('  },');
    }

    // Body
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        const bodyString = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
        lines.push(`  data: \`${escapeJavaScriptString(bodyString)}\``);
    }

    lines.push('};');
    lines.push('');
    lines.push('axios(config)');
    lines.push('  .then(response => console.log(response.data))');
    lines.push('  .catch(error => console.error(error));');

    return lines.join('\n');
}

// Go (net/http) Generator
function generateGo(config) {
    const { method, url, headers, body } = config;
    const lines = [];

    lines.push('package main');
    lines.push('');
    lines.push('import (');
    lines.push('    "fmt"');
    lines.push('    "io"');
    lines.push('    "net/http"');
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        lines.push('    "strings"');
    }
    lines.push(')');
    lines.push('');
    lines.push('func main() {');

    // Body
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
        lines.push(`    payload := strings.NewReader(\`${escapeGoString(bodyString)}\`)`);
        lines.push('');
    }

    // Create request
    const bodyArg = (body && ['POST', 'PUT', 'PATCH'].includes(method)) ? 'payload' : 'nil';
    lines.push(`    req, err := http.NewRequest("${method || 'GET'}", "${escapeGoString(url)}", ${bodyArg})`);
    lines.push('    if err != nil {');
    lines.push('        fmt.Println(err)');
    lines.push('        return');
    lines.push('    }');
    lines.push('');

    // Headers
    if (headers && Object.keys(headers).length > 0) {
        for (const [key, value] of Object.entries(headers)) {
            if (key && value) {
                lines.push(`    req.Header.Add("${escapeGoString(key)}", "${escapeGoString(value)}")`);
            }
        }
        lines.push('');
    }

    // Execute request
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

// Node.js (https) Generator
function generateNodeJs(config) {
    const { method, url, headers, body } = config;
    const lines = [];

    // Parse URL to determine if http or https
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

    // Headers
    if (headers && Object.keys(headers).length > 0) {
        lines.push('  headers: {');
        const headerLines = Object.entries(headers)
            .filter(([key, value]) => key && value)
            .map(([key, value]) => `    '${escapeJavaScriptString(key)}': '${escapeJavaScriptString(value)}'`);
        lines.push(headerLines.join(',\n'));
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

    // Body
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
        lines.push(`req.write(\`${escapeJavaScriptString(bodyString)}\`);`);
    }

    lines.push('req.end();');

    return lines.join('\n');
}

// PHP (cURL) Generator
function generatePhp(config) {
    const { method, url, headers, body } = config;
    const lines = [];

    lines.push('<?php');
    lines.push('');
    lines.push('$curl = curl_init();');
    lines.push('');

    // cURL options
    lines.push('curl_setopt_array($curl, [');
    lines.push(`  CURLOPT_URL => "${escapePythonString(url)}",`);
    lines.push('  CURLOPT_RETURNTRANSFER => true,');
    lines.push('  CURLOPT_ENCODING => "",');
    lines.push('  CURLOPT_MAXREDIRS => 10,');
    lines.push('  CURLOPT_TIMEOUT => 30,');
    lines.push(`  CURLOPT_CUSTOMREQUEST => "${method || 'GET'}",`);

    // Body
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
        lines.push(`  CURLOPT_POSTFIELDS => "${escapePythonString(bodyString)}",`);
    }

    // Headers
    if (headers && Object.keys(headers).length > 0) {
        lines.push('  CURLOPT_HTTPHEADER => [');
        const headerLines = Object.entries(headers)
            .filter(([key, value]) => key && value)
            .map(([key, value]) => `    "${escapePythonString(key)}: ${escapePythonString(value)}"`);
        lines.push(headerLines.join(',\n'));
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

// Ruby (net/http) Generator
function generateRuby(config) {
    const { method, url, headers, body } = config;
    const lines = [];

    lines.push('require "uri"');
    lines.push('require "net/http"');
    lines.push('');

    lines.push(`url = URI("${escapePythonString(url)}")`);
    lines.push('');

    lines.push('http = Net::HTTP.new(url.host, url.port)');

    // Check if HTTPS
    const urlObj = new URL(url);
    if (urlObj.protocol === 'https:') {
        lines.push('http.use_ssl = true');
    }
    lines.push('');

    // Create request
    const methodCapitalized = (method || 'GET').charAt(0).toUpperCase() + (method || 'GET').slice(1).toLowerCase();
    lines.push(`request = Net::HTTP::${methodCapitalized}.new(url)`);

    // Headers
    if (headers && Object.keys(headers).length > 0) {
        for (const [key, value] of Object.entries(headers)) {
            if (key && value) {
                lines.push(`request["${escapePythonString(key)}"] = "${escapePythonString(value)}"`);
            }
        }
    }

    // Body
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
        lines.push(`request.body = "${escapePythonString(bodyString)}"`);
    }

    lines.push('');
    lines.push('response = http.request(request)');
    lines.push('puts response.read_body');

    return lines.join('\n');
}

// Java (HttpClient) Generator
function generateJava(config) {
    const { method, url, headers, body } = config;
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

    // Build request
    lines.push('        HttpRequest.Builder requestBuilder = HttpRequest.newBuilder()');
    lines.push(`            .uri(URI.create("${escapeGoString(url)}"))`);

    // Headers
    if (headers && Object.keys(headers).length > 0) {
        for (const [key, value] of Object.entries(headers)) {
            if (key && value) {
                lines.push(`            .header("${escapeGoString(key)}", "${escapeGoString(value)}")`);
            }
        }
    }

    // Method and body
    const methodUpper = (method || 'GET').toUpperCase();
    if (body && ['POST', 'PUT', 'PATCH'].includes(methodUpper)) {
        const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
        lines.push(`            .${methodUpper}(HttpRequest.BodyPublishers.ofString("${escapeGoString(bodyString)}"))`);
    } else {
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

// Main export function
export function generateCode(language, config) {
    const generators = {
        'curl': generateCurl,
        'python': generatePythonRequests,
        'javascript-fetch': generateJavaScriptFetch,
        'javascript-axios': generateJavaScriptAxios,
        'nodejs': generateNodeJs,
        'go': generateGo,
        'php': generatePhp,
        'ruby': generateRuby,
        'java': generateJava
    };

    const generator = generators[language];
    if (!generator) {
        throw new Error(`Unsupported language: ${language}`);
    }

    return generator(config);
}

// Language metadata for UI
export const SUPPORTED_LANGUAGES = [
    { id: 'curl', name: 'cURL', description: 'Command line' },
    { id: 'python', name: 'Python', description: 'requests library' },
    { id: 'javascript-fetch', name: 'JavaScript', description: 'Fetch API' },
    { id: 'javascript-axios', name: 'JavaScript', description: 'Axios' },
    { id: 'nodejs', name: 'Node.js', description: 'https module' },
    { id: 'go', name: 'Go', description: 'net/http' },
    { id: 'php', name: 'PHP', description: 'cURL' },
    { id: 'ruby', name: 'Ruby', description: 'net/http' },
    { id: 'java', name: 'Java', description: 'HttpClient' }
];

// Legacy export for backward compatibility
export function generateCurlCommand(config) {
    return generateCurl(config);
}
