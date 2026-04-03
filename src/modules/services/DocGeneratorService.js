/**
 * @fileoverview Service for generating API documentation from collections
 * @module services/DocGeneratorService
 */

import { generateCode, SUPPORTED_LANGUAGES } from '../codeGenerator.js';

/**
 * Service for generating API documentation from collections
 *
 * @class
 * @classdesc Generates human-readable API documentation in Markdown and HTML formats.
 * Supports code samples in multiple languages, optional inclusion of persisted data,
 * and organized output by folders/endpoints.
 */
export class DocGeneratorService {
    /**
     * Creates a DocGeneratorService instance
     *
     * @param {CollectionRepository} collectionRepository - Repository for accessing collection data
     */
    constructor(collectionRepository) {
        this.collectionRepository = collectionRepository;
    }

    /**
     * Default languages for code samples
     * @static
     */
    static DEFAULT_LANGUAGES = ['curl', 'python', 'javascript-fetch'];

    /**
     * Get available languages for code samples
     * @returns {Array<Object>} Array of language objects with id, name, description
     */
    static getAvailableLanguages() {
        return SUPPORTED_LANGUAGES;
    }

    /**
     * HTTP methods supported for documentation
     * @static
     * @private
     */
    static HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

    /**
     * Checks if an endpoint is an HTTP request
     * @param {Object} endpoint - The endpoint to check
     * @returns {boolean} True if HTTP request
     * @private
     */
    _isHttpEndpoint(endpoint) {
        if (!endpoint || !endpoint.method) {return false;}
        return DocGeneratorService.HTTP_METHODS.includes(endpoint.method.toUpperCase());
    }

    /**
     * Filters endpoints to only include HTTP requests
     * @param {Array} endpoints - Array of endpoints
     * @returns {Array} Filtered array of HTTP endpoints
     * @private
     */
    _filterHttpEndpoints(endpoints) {
        if (!endpoints) {return [];}
        return endpoints.filter(ep => this._isHttpEndpoint(ep));
    }

    /**
     * Checks if a collection has any HTTP endpoints
     * @param {Object} collection - The collection to check
     * @returns {boolean} True if collection has HTTP endpoints
     */
    hasHttpEndpoints(collection) {
        if (collection.folders && collection.folders.length > 0) {
            for (const folder of collection.folders) {
                if (this._filterHttpEndpoints(folder.endpoints).length > 0) {
                    return true;
                }
            }
            return false;
        }
        return this._filterHttpEndpoints(collection.endpoints).length > 0;
    }

    /**
     * Generates Markdown documentation for a collection
     *
     * @async
     * @param {Object} collection - The collection to document
     * @param {Object} options - Generation options
     * @param {boolean} [options.includePersistedData=false] - Include user's saved data
     * @param {Array<string>} [options.languages=[]] - Language IDs for code samples
     * @returns {Promise<string>} Markdown documentation string
     */
    async generateMarkdown(collection, options = {}) {
        const {
            includePersistedData = false,
            languages = []
        } = options;

        const lines = [];

        // Header
        lines.push(`# ${collection.name}`);
        lines.push('');

        if (collection.description) {
            lines.push(collection.description);
            lines.push('');
        }

        if (collection.baseUrl) {
            lines.push(`**Base URL:** \`${collection.baseUrl}\``);
            lines.push('');
        }

        // Table of Contents
        lines.push('## Table of Contents');
        lines.push('');
        
        if (collection.folders && collection.folders.length > 0) {
            for (const folder of collection.folders) {
                const httpEndpoints = this._filterHttpEndpoints(folder.endpoints);
                if (httpEndpoints.length === 0) {continue;}
                
                const folderId = this._slugify(folder.name);
                lines.push(`- [${folder.name}](#${folderId})`);
                for (const endpoint of httpEndpoints) {
                    const endpointId = this._slugify(`${endpoint.method}-${endpoint.name || endpoint.path}`);
                    lines.push(`  - [${endpoint.method} ${endpoint.name || endpoint.path}](#${endpointId})`);
                }
            }
        } else {
            const httpEndpoints = this._filterHttpEndpoints(collection.endpoints);
            for (const endpoint of httpEndpoints) {
                const endpointId = this._slugify(`${endpoint.method}-${endpoint.name || endpoint.path}`);
                lines.push(`- [${endpoint.method} ${endpoint.name || endpoint.path}](#${endpointId})`);
            }
        }
        lines.push('');

        // Content
        if (collection.folders && collection.folders.length > 0) {
            for (const folder of collection.folders) {
                const httpEndpoints = this._filterHttpEndpoints(folder.endpoints);
                if (httpEndpoints.length === 0) {continue;}
                
                lines.push(`## ${folder.name}`);
                lines.push('');

                for (const endpoint of httpEndpoints) {
                    const endpointDoc = await this._generateEndpointMarkdown(
                        collection,
                        endpoint,
                        includePersistedData,
                        languages
                    );
                    lines.push(endpointDoc);
                }
            }
        } else {
            const httpEndpoints = this._filterHttpEndpoints(collection.endpoints);
            for (const endpoint of httpEndpoints) {
                const endpointDoc = await this._generateEndpointMarkdown(
                    collection,
                    endpoint,
                    includePersistedData,
                    languages
                );
                lines.push(endpointDoc);
            }
        }

        // Footer
        lines.push('---');
        lines.push('');
        lines.push(`*Generated by Resonance on ${new Date().toLocaleDateString()}*`);

        return lines.join('\n');
    }

    /**
     * Generates HTML documentation for a collection
     *
     * @async
     * @param {Object} collection - The collection to document
     * @param {Object} options - Generation options
     * @param {boolean} [options.includePersistedData=false] - Include user's saved data
     * @param {Array<string>} [options.languages=[]] - Language IDs for code samples
     * @returns {Promise<string>} HTML documentation string
     */
    async generateHtml(collection, options = {}) {
        const {
            includePersistedData = false,
            languages = []
        } = options;

        const endpoints = await this._getAllEndpointsWithData(collection, includePersistedData);
        
        // Load template file
        const template = await this._loadTemplate('./src/templates/docs/docTemplate.html');

        // Generate dynamic content
        const title = this._escapeHtml(collection.name);
        const description = collection.description 
            ? `<p class="description">${this._escapeHtml(collection.description)}</p>` 
            : '';
        const baseUrl = collection.baseUrl 
            ? `<p class="base-url"><strong>Base URL:</strong> <code>${this._escapeHtml(collection.baseUrl)}</code></p>` 
            : '';
        const toc = this._generateHtmlToc(collection);
        const content = await this._generateHtmlContent(collection, endpoints, languages);
        const date = new Date().toLocaleDateString();

        // Replace placeholders in template
        const html = template
            .replace(/\{\{TITLE\}\}/g, title)
            .replace('{{DESCRIPTION}}', description)
            .replace('{{BASE_URL}}', baseUrl)
            .replace('{{TOC}}', toc)
            .replace('{{CONTENT}}', content)
            .replace('{{DATE}}', date);

        return html;
    }

    /**
     * Loads a template file
     * @private
     * @async
     */
    async _loadTemplate(path) {
        const cacheKey = `_cached_${path}`;
        if (DocGeneratorService[cacheKey]) {
            return DocGeneratorService[cacheKey];
        }
        
        try {
            const response = await fetch(path);
            if (response.ok) {
                DocGeneratorService[cacheKey] = await response.text();
                return DocGeneratorService[cacheKey];
            }
        } catch (error) {
            console.warn(`Failed to load template: ${path}`);
        }
        
        return '';
    }

    /**
     * Generates Markdown documentation for a single endpoint
     * @private
     */
    async _generateEndpointMarkdown(collection, endpoint, includePersistedData, languages) {
        const lines = [];
        const displayName = endpoint.name || endpoint.path;

        lines.push(`### ${endpoint.method} ${displayName}`);
        lines.push('');

        if (endpoint.description || endpoint.summary) {
            lines.push(endpoint.description || endpoint.summary);
            lines.push('');
        }

        // URL
        let fullUrl = endpoint.path;
        if (collection.baseUrl) {
            fullUrl = `${collection.baseUrl}${endpoint.path}`;
        }
        lines.push(`**URL:** \`${fullUrl}\``);
        lines.push('');

        // Get persisted data if requested
        let persistedData = null;
        if (includePersistedData) {
            persistedData = await this.collectionRepository.getAllPersistedEndpointData(
                collection.id,
                endpoint.id
            );
        }

        // Path Parameters
        const pathParams = this._getPathParams(endpoint, persistedData);
        if (pathParams.length > 0) {
            lines.push('#### Path Parameters');
            lines.push('');
            lines.push('| Name | Type | Required | Description |');
            lines.push('|------|------|----------|-------------|');
            for (const param of pathParams) {
                lines.push(`| ${param.name} | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${param.description || '-'} |`);
            }
            lines.push('');
        }

        // Query Parameters
        const queryParams = this._getQueryParams(endpoint, persistedData);
        if (queryParams.length > 0) {
            lines.push('#### Query Parameters');
            lines.push('');
            lines.push('| Name | Type | Required | Description |');
            lines.push('|------|------|----------|-------------|');
            for (const param of queryParams) {
                lines.push(`| ${param.name} | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${param.description || '-'} |`);
            }
            lines.push('');
        }

        // Headers
        const headers = this._getHeaders(endpoint, persistedData, collection);
        if (headers.length > 0) {
            lines.push('#### Headers');
            lines.push('');
            lines.push('| Name | Value | Description |');
            lines.push('|------|-------|-------------|');
            for (const header of headers) {
                lines.push(`| ${header.name} | ${header.value || '-'} | ${header.description || '-'} |`);
            }
            lines.push('');
        }

        // Request Body
        const requestBody = this._getRequestBody(endpoint, persistedData);
        if (requestBody) {
            lines.push('#### Request Body');
            lines.push('');
            if (requestBody.contentType) {
                lines.push(`**Content-Type:** \`${requestBody.contentType}\``);
                lines.push('');
            }
            if (requestBody.example) {
                lines.push('```json');
                lines.push(requestBody.example);
                lines.push('```');
                lines.push('');
            }
        }

        // Response Schema - always fetch this regardless of includePersistedData
        let responseSchema = persistedData?.responseSchema;
        if (!responseSchema) {
            const endpointData = await this.collectionRepository.getAllPersistedEndpointData(
                collection.id,
                endpoint.id
            );
            responseSchema = endpointData?.responseSchema;
        }
        if (responseSchema) {
            lines.push('#### Response Schema');
            lines.push('');
            lines.push('```json');
            lines.push(JSON.stringify(responseSchema, null, 2));
            lines.push('```');
            lines.push('');
        }

        // Code Samples
        if (languages.length > 0) {
            lines.push('#### Code Samples');
            lines.push('');

            const config = this._buildRequestConfig(collection, endpoint, persistedData);

            for (const langId of languages) {
                const lang = SUPPORTED_LANGUAGES.find(l => l.id === langId);
                if (!lang) {continue;}

                try {
                    const code = generateCode(langId, config);
                    const langLabel = lang.description ? `${lang.name} (${lang.description})` : lang.name;
                    lines.push(`**${langLabel}**`);
                    lines.push('');
                    lines.push(`\`\`\`${this._getCodeBlockLang(langId)}`);
                    lines.push(code);
                    lines.push('```');
                    lines.push('');
                } catch (error) {
                    // Skip if code generation fails
                }
            }
        }

        lines.push('---');
        lines.push('');

        return lines.join('\n');
    }

    /**
     * Gets all endpoints with their persisted data
     * @private
     */
    async _getAllEndpointsWithData(collection, includePersistedData) {
        const endpoints = [];

        const processEndpoint = async (endpoint, folderName = null) => {
            // Skip non-HTTP endpoints
            if (!this._isHttpEndpoint(endpoint)) {return;}
            
            let persistedData = null;
            if (includePersistedData) {
                persistedData = await this.collectionRepository.getAllPersistedEndpointData(
                    collection.id,
                    endpoint.id
                );
            }
            endpoints.push({
                ...endpoint,
                folderName,
                persistedData
            });
        };

        if (collection.folders && collection.folders.length > 0) {
            for (const folder of collection.folders) {
                for (const endpoint of folder.endpoints || []) {
                    await processEndpoint(endpoint, folder.name);
                }
            }
        } else if (collection.endpoints) {
            for (const endpoint of collection.endpoints) {
                await processEndpoint(endpoint);
            }
        }

        return endpoints;
    }

    /**
     * Generates HTML table of contents
     * @private
     */
    _generateHtmlToc(collection) {
        const items = [];

        if (collection.folders && collection.folders.length > 0) {
            for (const folder of collection.folders) {
                const httpEndpoints = this._filterHttpEndpoints(folder.endpoints);
                if (httpEndpoints.length === 0) {continue;}
                
                const folderId = this._slugify(folder.name);
                items.push(`<li><a href="#${folderId}">${this._escapeHtml(folder.name)}</a>`);
                items.push('<ul>');
                for (const endpoint of httpEndpoints) {
                    const endpointId = this._slugify(`${endpoint.method}-${endpoint.name || endpoint.path}`);
                    items.push(`<li><a href="#${endpointId}"><span class="method method-${endpoint.method.toLowerCase()}">${endpoint.method}</span> ${this._escapeHtml(endpoint.name || endpoint.path)}</a></li>`);
                }
                items.push('</ul></li>');
            }
        } else {
            const httpEndpoints = this._filterHttpEndpoints(collection.endpoints);
            for (const endpoint of httpEndpoints) {
                const endpointId = this._slugify(`${endpoint.method}-${endpoint.name || endpoint.path}`);
                items.push(`<li><a href="#${endpointId}"><span class="method method-${endpoint.method.toLowerCase()}">${endpoint.method}</span> ${this._escapeHtml(endpoint.name || endpoint.path)}</a></li>`);
            }
        }

        return `<ul>${items.join('')}</ul>`;
    }

    /**
     * Generates HTML content for all endpoints
     * @private
     */
    async _generateHtmlContent(collection, endpoints, languages) {
        const sections = [];
        let currentFolder = null;

        for (const endpoint of endpoints) {
            // Start new folder section if needed
            if (endpoint.folderName && endpoint.folderName !== currentFolder) {
                if (currentFolder !== null) {
                    sections.push('</section>');
                }
                currentFolder = endpoint.folderName;
                const folderId = this._slugify(endpoint.folderName);
                sections.push(`<section class="folder" id="${folderId}">`);
                sections.push(`<h2>${this._escapeHtml(endpoint.folderName)}</h2>`);
            }

            sections.push(await this._generateEndpointHtml(collection, endpoint, languages));
        }

        if (currentFolder !== null) {
            sections.push('</section>');
        }

        return sections.join('\n');
    }

    /**
     * Generates HTML for a single endpoint
     * @private
     */
    async _generateEndpointHtml(collection, endpoint, languages) {
        const displayName = endpoint.name || endpoint.path;
        const endpointId = this._slugify(`${endpoint.method}-${displayName}`);
        const {persistedData} = endpoint;

        let fullUrl = endpoint.path;
        if (collection.baseUrl) {
            fullUrl = `${collection.baseUrl}${endpoint.path}`;
        }

        const html = [];
        html.push(`<article class="endpoint" id="${endpointId}">`);
        html.push(`<h3><span class="method method-${endpoint.method.toLowerCase()}">${endpoint.method}</span> ${this._escapeHtml(displayName)}</h3>`);

        if (endpoint.description || endpoint.summary) {
            html.push(`<p class="endpoint-description">${this._escapeHtml(endpoint.description || endpoint.summary)}</p>`);
        }

        html.push(`<p class="endpoint-url"><strong>URL:</strong> <code>${this._escapeHtml(fullUrl)}</code></p>`);

        // Path Parameters
        const pathParams = this._getPathParams(endpoint, persistedData);
        if (pathParams.length > 0) {
            html.push('<div class="params-section">');
            html.push('<h4>Path Parameters</h4>');
            html.push(this._generateParamsTable(pathParams));
            html.push('</div>');
        }

        // Query Parameters
        const queryParams = this._getQueryParams(endpoint, persistedData);
        if (queryParams.length > 0) {
            html.push('<div class="params-section">');
            html.push('<h4>Query Parameters</h4>');
            html.push(this._generateParamsTable(queryParams));
            html.push('</div>');
        }

        // Headers
        const headers = this._getHeaders(endpoint, persistedData, collection);
        if (headers.length > 0) {
            html.push('<div class="params-section">');
            html.push('<h4>Headers</h4>');
            html.push(this._generateHeadersTable(headers));
            html.push('</div>');
        }

        // Request Body
        const requestBody = this._getRequestBody(endpoint, persistedData);
        if (requestBody) {
            html.push('<div class="body-section">');
            html.push('<h4>Request Body</h4>');
            if (requestBody.contentType) {
                html.push(`<p><strong>Content-Type:</strong> <code>${this._escapeHtml(requestBody.contentType)}</code></p>`);
            }
            if (requestBody.example) {
                html.push(`<pre><code class="language-json">${this._escapeHtml(requestBody.example)}</code></pre>`);
            }
            html.push('</div>');
        }

        // Response Schema - always fetch this regardless of includePersistedData
        let responseSchema = persistedData?.responseSchema;
        if (!responseSchema) {
            const endpointData = await this.collectionRepository.getAllPersistedEndpointData(
                collection.id,
                endpoint.id
            );
            responseSchema = endpointData?.responseSchema;
        }
        if (responseSchema) {
            html.push('<details class="schema-section">');
            html.push('<summary><h4>Response Schema</h4></summary>');
            html.push(`<pre><code class="language-json">${this._escapeHtml(JSON.stringify(responseSchema, null, 2))}</code></pre>`);
            html.push('</details>');
        }

        // Code Samples
        if (languages.length > 0) {
            html.push('<div class="code-samples">');
            html.push('<h4>Code Samples</h4>');
            html.push('<div class="code-tabs">');

            const config = this._buildRequestConfig(collection, endpoint, persistedData);

            // Tab buttons
            html.push('<div class="tab-buttons">');
            let isFirst = true;
            for (const langId of languages) {
                const lang = SUPPORTED_LANGUAGES.find(l => l.id === langId);
                if (!lang) {continue;}
                const activeClass = isFirst ? ' active' : '';
                html.push(`<button class="tab-btn${activeClass}" data-lang="${langId}">${this._escapeHtml(lang.name)}</button>`);
                isFirst = false;
            }
            html.push('</div>');

            // Tab content
            isFirst = true;
            for (const langId of languages) {
                const lang = SUPPORTED_LANGUAGES.find(l => l.id === langId);
                if (!lang) {continue;}

                try {
                    const code = generateCode(langId, config);
                    const activeClass = isFirst ? ' active' : '';
                    html.push(`<div class="tab-content${activeClass}" data-lang="${langId}">`);
                    html.push(`<pre><code class="language-${this._getCodeBlockLang(langId)}">${this._escapeHtml(code)}</code></pre>`);
                    html.push('</div>');
                    isFirst = false;
                } catch (error) {
                    // Skip if code generation fails
                }
            }

            html.push('</div>');
            html.push('</div>');
        }

        html.push('</article>');

        return html.join('\n');
    }

    /**
     * Generates HTML parameters table
     * @private
     */
    _generateParamsTable(params) {
        const rows = params.map(p => 
            `<tr><td><code>${this._escapeHtml(p.name)}</code></td><td>${this._escapeHtml(p.type)}</td><td>${p.required ? 'Yes' : 'No'}</td><td>${this._escapeHtml(p.description || '-')}</td></tr>`
        ).join('');

        return `<table><thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    /**
     * Generates HTML headers table
     * @private
     */
    _generateHeadersTable(headers) {
        const rows = headers.map(h => 
            `<tr><td><code>${this._escapeHtml(h.name)}</code></td><td>${this._escapeHtml(h.value || '-')}</td><td>${this._escapeHtml(h.description || '-')}</td></tr>`
        ).join('');

        return `<table><thead><tr><th>Name</th><th>Value</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    /**
     * Extracts path parameters from endpoint
     * @private
     */
    _getPathParams(endpoint, persistedData) {
        const params = [];

        if (endpoint.parameters?.path) {
            for (const [name, param] of Object.entries(endpoint.parameters.path)) {
                const persistedParam = persistedData?.pathParams?.find(p => p.key === name);
                params.push({
                    name,
                    type: param.type || param.schema?.type || 'string',
                    required: param.required !== false,
                    description: param.description || '',
                    example: persistedParam?.value || param.example || ''
                });
            }
        }

        return params;
    }

    /**
     * Extracts query parameters from endpoint
     * @private
     */
    _getQueryParams(endpoint, persistedData) {
        const params = [];

        if (endpoint.parameters?.query) {
            for (const [name, param] of Object.entries(endpoint.parameters.query)) {
                const persistedParam = persistedData?.queryParams?.find(p => p.key === name);
                params.push({
                    name,
                    type: param.type || param.schema?.type || 'string',
                    required: param.required === true,
                    description: param.description || '',
                    example: persistedParam?.value || param.example || ''
                });
            }
        }

        return params;
    }

    /**
     * Extracts headers from endpoint
     * @private
     */
    _getHeaders(endpoint, persistedData, collection) {
        const headers = [];
        const seen = new Set();

        // From persisted data
        if (persistedData?.headers) {
            for (const h of persistedData.headers) {
                if (h.key && !seen.has(h.key.toLowerCase())) {
                    seen.add(h.key.toLowerCase());
                    headers.push({
                        name: h.key,
                        value: h.value || '',
                        description: ''
                    });
                }
            }
        }

        // From endpoint definition
        if (endpoint.parameters?.header) {
            for (const [name, param] of Object.entries(endpoint.parameters.header)) {
                if (!seen.has(name.toLowerCase())) {
                    seen.add(name.toLowerCase());
                    headers.push({
                        name,
                        value: param.example || '',
                        description: param.description || ''
                    });
                }
            }
        }

        // From collection defaults
        if (collection.defaultHeaders) {
            for (const [name, value] of Object.entries(collection.defaultHeaders)) {
                if (!seen.has(name.toLowerCase())) {
                    seen.add(name.toLowerCase());
                    headers.push({
                        name,
                        value,
                        description: ''
                    });
                }
            }
        }

        return headers;
    }

    /**
     * Extracts request body from endpoint
     * @private
     */
    _getRequestBody(endpoint, persistedData) {
        if (!['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
            return null;
        }

        const contentType = endpoint.requestBody?.contentType || 'application/json';
        let example = '';

        if (persistedData?.modifiedBody) {
            example = persistedData.modifiedBody;
        } else if (endpoint.requestBody?.example) {
            example = typeof endpoint.requestBody.example === 'string'
                ? endpoint.requestBody.example
                : JSON.stringify(endpoint.requestBody.example, null, 2);
        }

        if (!example && !endpoint.requestBody) {
            return null;
        }

        return {
            contentType,
            example
        };
    }

    /**
     * Builds request config for code generation
     * @private
     */
    _buildRequestConfig(collection, endpoint, persistedData) {
        let url = endpoint.path;
        if (collection.baseUrl) {
            url = `${collection.baseUrl}${endpoint.path}`;
        }

        // Replace path params with examples
        if (endpoint.parameters?.path) {
            for (const [name, param] of Object.entries(endpoint.parameters.path)) {
                const persistedParam = persistedData?.pathParams?.find(p => p.key === name);
                const value = persistedParam?.value || param.example || `{${name}}`;
                url = url.replace(`{${name}}`, value);
                url = url.replace(`{{${name}}}`, value);
            }
        }

        // Build headers object
        const headers = {};
        const headersList = this._getHeaders(endpoint, persistedData, collection);
        for (const h of headersList) {
            if (h.name && h.value) {
                headers[h.name] = h.value;
            }
        }

        // Get body
        let body = null;
        const requestBody = this._getRequestBody(endpoint, persistedData);
        if (requestBody?.example) {
            try {
                body = JSON.parse(requestBody.example);
            } catch {
                body = requestBody.example;
            }
        }

        return {
            method: endpoint.method,
            url,
            headers,
            body
        };
    }

    /**
     * Gets code block language identifier
     * @private
     */
    _getCodeBlockLang(langId) {
        const mapping = {
            'curl': 'bash',
            'python': 'python',
            'javascript-fetch': 'javascript',
            'javascript-axios': 'javascript',
            'nodejs': 'javascript',
            'go': 'go',
            'php': 'php',
            'ruby': 'ruby',
            'java': 'java'
        };
        return mapping[langId] || 'text';
    }

    /**
     * Creates URL-friendly slug from text
     * @private
     */
    _slugify(text) {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }

    /**
     * Escapes HTML special characters
     * @private
     */
    _escapeHtml(text) {
        if (!text) {return '';}
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

}
