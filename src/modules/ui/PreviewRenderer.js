/**
 * PreviewRenderer
 *
 * Renders response content in preview format based on content type.
 * Handles HTML (iframe), JSON (tree view), and XML (formatted tree).
 */
export class PreviewRenderer {
    constructor(containerElement) {
        this.container = containerElement;
    }

    /**
     * Render content based on type
     * @param {string} content - Response content
     * @param {string} contentType - Content type (json, html, xml)
     */
    render(content, contentType) {
        this.clear();

        if (!content) {
            this._renderEmptyState();
            return;
        }

        switch (contentType) {
            case 'json':
                this._renderJSON(content);
                break;
            case 'html':
                this._renderHTML(content);
                break;
            case 'xml':
                this._renderXML(content);
                break;
            default:
                this._renderEmptyState();
        }
    }

    /**
     * Render JSON as collapsible tree
     * @private
     */
    _renderJSON(content) {
        try {
            const data = JSON.parse(content);
            const tree = this._buildJSONTree(data);
            tree.classList.add('json-tree');
            this.container.appendChild(tree);
        } catch (e) {
            this._renderError('Invalid JSON');
        }
    }

    /**
     * Build interactive JSON tree
     * @private
     * @param {*} data - JSON data
     * @param {number} level - Nesting level
     * @returns {HTMLElement}
     */
    _buildJSONTree(data, level = 0) {
        const node = document.createElement('div');
        node.className = 'json-tree-node';

        if (data === null) {
            const valueSpan = document.createElement('span');
            valueSpan.className = 'json-tree-null';
            valueSpan.textContent = 'null';
            node.appendChild(valueSpan);
        } else if (Array.isArray(data)) {
            this._buildArrayNode(node, data, level);
        } else if (typeof data === 'object') {
            this._buildObjectNode(node, data, level);
        } else {
            // Primitive value
            const valueSpan = document.createElement('span');
            valueSpan.className = `json-tree-${typeof data}`;
            valueSpan.textContent = JSON.stringify(data);
            node.appendChild(valueSpan);
        }

        return node;
    }

    /**
     * Build object node in JSON tree
     * @private
     */
    _buildObjectNode(node, obj, level) {
        const entries = Object.entries(obj);

        if (entries.length === 0) {
            node.textContent = '{}';
            return;
        }

        // Create toggle arrow
        const toggle = document.createElement('span');
        toggle.className = 'json-tree-toggle';
        toggle.textContent = level < 2 ? '▼' : '▶';
        node.appendChild(toggle);

        // Opening brace
        const openBrace = document.createElement('span');
        openBrace.textContent = '{';
        node.appendChild(openBrace);

        // Create children container
        const children = document.createElement('div');
        children.className = 'json-tree-children';
        children.style.display = level < 2 ? 'block' : 'none';

        // Add children
        entries.forEach(([key, value], index) => {
            const childLine = document.createElement('div');
            childLine.className = 'json-tree-line';

            const keySpan = document.createElement('span');
            keySpan.className = 'json-tree-key';
            keySpan.textContent = `"${key}"`;
            childLine.appendChild(keySpan);

            childLine.appendChild(document.createTextNode(': '));

            const valueNode = this._buildJSONTree(value, level + 1);
            childLine.appendChild(valueNode);

            if (index < entries.length - 1) {
                childLine.appendChild(document.createTextNode(','));
            }

            children.appendChild(childLine);
        });

        node.appendChild(children);

        // Closing brace
        const closeBrace = document.createElement('span');
        closeBrace.textContent = '}';
        node.appendChild(closeBrace);

        // Toggle handler
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanded = children.style.display === 'block';
            children.style.display = isExpanded ? 'none' : 'block';
            toggle.textContent = isExpanded ? '▶' : '▼';
        });
    }

    /**
     * Build array node in JSON tree
     * @private
     */
    _buildArrayNode(node, arr, level) {
        if (arr.length === 0) {
            node.textContent = '[]';
            return;
        }

        // Create toggle arrow
        const toggle = document.createElement('span');
        toggle.className = 'json-tree-toggle';
        toggle.textContent = level < 2 ? '▼' : '▶';
        node.appendChild(toggle);

        // Opening bracket
        const openBracket = document.createElement('span');
        openBracket.textContent = '[';
        node.appendChild(openBracket);

        // Create children container
        const children = document.createElement('div');
        children.className = 'json-tree-children';
        children.style.display = level < 2 ? 'block' : 'none';

        // Add children
        arr.forEach((value, index) => {
            const childLine = document.createElement('div');
            childLine.className = 'json-tree-line';

            const valueNode = this._buildJSONTree(value, level + 1);
            childLine.appendChild(valueNode);

            if (index < arr.length - 1) {
                childLine.appendChild(document.createTextNode(','));
            }

            children.appendChild(childLine);
        });

        node.appendChild(children);

        // Closing bracket
        const closeBracket = document.createElement('span');
        closeBracket.textContent = ']';
        node.appendChild(closeBracket);

        // Toggle handler
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanded = children.style.display === 'block';
            children.style.display = isExpanded ? 'none' : 'block';
            toggle.textContent = isExpanded ? '▶' : '▼';
        });
    }

    /**
     * Render HTML in sandboxed iframe
     * @private
     */
    _renderHTML(content) {
        const iframe = document.createElement('iframe');
        iframe.className = 'response-preview-iframe';
        iframe.setAttribute('sandbox', 'allow-same-origin');
        iframe.srcdoc = content;
        iframe.style.cssText = 'width: 100%; height: 100%; border: none;';

        this.container.appendChild(iframe);
    }

    /**
     * Render XML as formatted tree
     * @private
     */
    _renderXML(content) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(content, 'text/xml');

            // Check for parse errors
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                this._renderError('Invalid XML');
                return;
            }

            // Build tree view
            const tree = this._buildXMLTree(xmlDoc.documentElement);
            tree.classList.add('xml-tree');
            this.container.appendChild(tree);
        } catch (e) {
            this._renderError('Invalid XML');
        }
    }

    /**
     * Build interactive XML tree
     * @private
     * @param {Element} node - XML element
     * @param {number} level - Nesting level
     * @returns {HTMLElement}
     */
    _buildXMLTree(node, level = 0) {
        const treeNode = document.createElement('div');
        treeNode.className = 'xml-tree-node';

        const hasChildren = node.children.length > 0;
        const hasText = node.childNodes.length > 0 &&
                       Array.from(node.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());

        if (hasChildren) {
            // Element with children
            const toggle = document.createElement('span');
            toggle.className = 'xml-tree-toggle';
            toggle.textContent = level < 2 ? '▼' : '▶';
            treeNode.appendChild(toggle);

            // Opening tag
            const openTag = document.createElement('span');
            openTag.className = 'xml-tree-tag';
            openTag.textContent = `<${node.tagName}`;
            treeNode.appendChild(openTag);

            // Attributes
            if (node.attributes.length > 0) {
                for (const attr of node.attributes) {
                    const attrSpan = document.createElement('span');
                    attrSpan.className = 'xml-tree-attribute';
                    attrSpan.textContent = ` ${attr.name}`;
                    treeNode.appendChild(attrSpan);

                    const equalSign = document.createTextNode('=');
                    treeNode.appendChild(equalSign);

                    const attrValue = document.createElement('span');
                    attrValue.className = 'xml-tree-string';
                    attrValue.textContent = `"${attr.value}"`;
                    treeNode.appendChild(attrValue);
                }
            }

            const closingBracket = document.createTextNode('>');
            treeNode.appendChild(closingBracket);

            // Children container
            const children = document.createElement('div');
            children.className = 'xml-tree-children';
            children.style.display = level < 2 ? 'block' : 'none';

            for (const child of node.children) {
                const childNode = this._buildXMLTree(child, level + 1);
                children.appendChild(childNode);
            }

            treeNode.appendChild(children);

            // Closing tag
            const closeTag = document.createElement('span');
            closeTag.className = 'xml-tree-tag';
            closeTag.textContent = `</${node.tagName}>`;
            treeNode.appendChild(closeTag);

            // Toggle handler
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = children.style.display === 'block';
                children.style.display = isExpanded ? 'none' : 'block';
                toggle.textContent = isExpanded ? '▶' : '▼';
            });
        } else if (hasText) {
            // Element with text content only
            const tag = document.createElement('span');
            tag.className = 'xml-tree-tag';
            tag.textContent = `<${node.tagName}`;
            treeNode.appendChild(tag);

            // Attributes
            if (node.attributes.length > 0) {
                for (const attr of node.attributes) {
                    const attrSpan = document.createElement('span');
                    attrSpan.className = 'xml-tree-attribute';
                    attrSpan.textContent = ` ${attr.name}`;
                    treeNode.appendChild(attrSpan);

                    treeNode.appendChild(document.createTextNode('='));

                    const attrValue = document.createElement('span');
                    attrValue.className = 'xml-tree-string';
                    attrValue.textContent = `"${attr.value}"`;
                    treeNode.appendChild(attrValue);
                }
            }

            treeNode.appendChild(document.createTextNode('>'));

            // Text content
            const textContent = document.createElement('span');
            textContent.className = 'xml-tree-text';
            textContent.textContent = node.textContent;
            treeNode.appendChild(textContent);

            // Closing tag
            const closeTag = document.createElement('span');
            closeTag.className = 'xml-tree-tag';
            closeTag.textContent = `</${node.tagName}>`;
            treeNode.appendChild(closeTag);
        } else {
            // Empty element
            const tag = document.createElement('span');
            tag.className = 'xml-tree-tag';
            tag.textContent = `<${node.tagName}`;
            treeNode.appendChild(tag);

            // Attributes
            if (node.attributes.length > 0) {
                for (const attr of node.attributes) {
                    const attrSpan = document.createElement('span');
                    attrSpan.className = 'xml-tree-attribute';
                    attrSpan.textContent = ` ${attr.name}`;
                    treeNode.appendChild(attrSpan);

                    treeNode.appendChild(document.createTextNode('='));

                    const attrValue = document.createElement('span');
                    attrValue.className = 'xml-tree-string';
                    attrValue.textContent = `"${attr.value}"`;
                    treeNode.appendChild(attrValue);
                }
            }

            treeNode.appendChild(document.createTextNode(' />'));
        }

        return treeNode;
    }

    /**
     * Render empty state
     * @private
     */
    _renderEmptyState() {
        this.container.innerHTML = `
            <div class="preview-empty-state">
                <svg class="preview-empty-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                <p class="preview-empty-text">Preview not available for this content type</p>
                <p class="preview-empty-subtext">Supported formats: HTML, JSON, XML</p>
            </div>
        `;
    }

    /**
     * Render error message
     * @private
     */
    _renderError(message) {
        this.container.innerHTML = `
            <div class="preview-empty-state">
                <svg class="preview-empty-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p class="preview-empty-text">${this._escapeHtml(message)}</p>
            </div>
        `;
    }

    /**
     * Escape HTML for safe rendering
     * @private
     */
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Clear preview container
     */
    clear() {
        this.container.innerHTML = '';
    }
}
