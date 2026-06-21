/**
 * PreviewRenderer
 *
 * Renders response content in preview format based on content type.
 * Handles HTML (iframe), JSON (tree view), and XML (formatted tree).
 */
import { templateLoader } from '../templateLoader.js';

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
        } catch {
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
            if (this._shouldRenderInline(data)) {
                this._buildInlineArray(node, data);
            } else {
                this._buildArrayNode(node, data, level);
            }
        } else if (typeof data === 'object') {
            if (this._shouldRenderInline(data)) {
                this._buildInlineObject(node, data);
            } else {
                this._buildObjectNode(node, data, level);
            }
        } else {
            const valueSpan = document.createElement('span');
            valueSpan.className = `json-tree-${typeof data}`;
            valueSpan.textContent = JSON.stringify(data);
            node.appendChild(valueSpan);
        }

        return node;
    }

    /**
     * Check if object/array should be rendered inline
     * @private
     * @param {Object|Array} data - Data to check
     * @returns {boolean}
     */
    _shouldRenderInline(data) {
        if (Array.isArray(data) && data.length === 0) {
            return true;
        }
        if (typeof data === 'object' && Object.keys(data).length === 0) {
            return true;
        }

        const entries = Array.isArray(data) ? data : Object.values(data);

        if (entries.length <= 3) {
            return entries.every(val =>
                val === null ||
                typeof val !== 'object'
            );
        }

        return false;
    }

    /**
     * Build inline object representation
     * @private
     */
    _buildInlineObject(node, obj) {
        node.className = 'json-tree-node json-tree-inline';

        const entries = Object.entries(obj);
        if (entries.length === 0) {
            node.textContent = '{}';
            return;
        }

        node.appendChild(document.createTextNode('{ '));

        entries.forEach(([key, value], index) => {
            const keySpan = document.createElement('span');
            keySpan.className = 'json-tree-key';
            keySpan.textContent = `"${key}"`;
            node.appendChild(keySpan);

            node.appendChild(document.createTextNode(': '));

            const valueSpan = document.createElement('span');
            if (value === null) {
                valueSpan.className = 'json-tree-null';
                valueSpan.textContent = 'null';
            } else {
                valueSpan.className = `json-tree-${typeof value}`;
                valueSpan.textContent = JSON.stringify(value);
            }
            node.appendChild(valueSpan);

            if (index < entries.length - 1) {
                node.appendChild(document.createTextNode(', '));
            }
        });

        node.appendChild(document.createTextNode(' }'));
    }

    /**
     * Build inline array representation
     * @private
     */
    _buildInlineArray(node, arr) {
        node.className = 'json-tree-node json-tree-inline';

        if (arr.length === 0) {
            node.textContent = '[]';
            return;
        }

        node.appendChild(document.createTextNode('[ '));

        arr.forEach((value, index) => {
            const valueSpan = document.createElement('span');
            if (value === null) {
                valueSpan.className = 'json-tree-null';
                valueSpan.textContent = 'null';
            } else {
                valueSpan.className = `json-tree-${typeof value}`;
                valueSpan.textContent = JSON.stringify(value);
            }
            node.appendChild(valueSpan);

            if (index < arr.length - 1) {
                node.appendChild(document.createTextNode(', '));
            }
        });

        node.appendChild(document.createTextNode(' ]'));
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

        const toggle = document.createElement('span');
        toggle.className = 'json-tree-toggle';
        toggle.textContent = level < 2 ? '▼' : '▶';
        node.appendChild(toggle);

        const openBrace = document.createElement('span');
        openBrace.textContent = '{';
        node.appendChild(openBrace);

        const children = document.createElement('div');
        children.className = 'json-tree-children';
        children.style.display = level < 2 ? 'block' : 'none';

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

        const closeBrace = document.createElement('span');
        closeBrace.textContent = '}';
        node.appendChild(closeBrace);

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

        const toggle = document.createElement('span');
        toggle.className = 'json-tree-toggle';
        toggle.textContent = level < 2 ? '▼' : '▶';
        node.appendChild(toggle);

        const openBracket = document.createElement('span');
        openBracket.textContent = '[';
        node.appendChild(openBracket);

        const children = document.createElement('div');
        children.className = 'json-tree-children';
        children.style.display = level < 2 ? 'block' : 'none';

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

        const closeBracket = document.createElement('span');
        closeBracket.textContent = ']';
        node.appendChild(closeBracket);

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

        const cspMeta = '<meta http-equiv="Content-Security-Policy" content="img-src \'none\'; script-src \'none\';">';
        const sanitizedContent = this._stripScripts(content);
        const modifiedContent = this._injectCSP(sanitizedContent, cspMeta);

        iframe.srcdoc = modifiedContent;

        this.container.appendChild(iframe);
    }

    /**
     * Remove script tags so the sandboxed iframe never attempts to execute
     * them (avoids the browser's "Blocked script execution" console warning).
     * @private
     * @param {string} content - Original HTML content
     * @returns {string} HTML content with script elements removed
     */
    _stripScripts(content) {
        return content
            .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
            .replace(/<script\b[^>]*>/gi, '');
    }

    /**
     * Inject CSP meta tag into HTML content
     * @private
     * @param {string} content - Original HTML content
     * @param {string} cspMeta - CSP meta tag to inject
     * @returns {string} Modified HTML content with CSP
     */
    _injectCSP(content, cspMeta) {
        const headMatch = content.match(/<head[^>]*>/i);
        if (headMatch) {
            return content.replace(headMatch[0], `${headMatch[0]}\n${cspMeta}`);
        }

        const htmlMatch = content.match(/<html[^>]*>/i);
        if (htmlMatch) {
            return content.replace(htmlMatch[0], `${htmlMatch[0]}\n<head>${cspMeta}</head>`);
        }

        return `<!DOCTYPE html><html><head>${cspMeta}</head><body>${content}</body></html>`;
    }

    /**
     * Render XML as formatted tree
     * @private
     */
    _renderXML(content) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(content, 'text/xml');

            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                this._renderError('Invalid XML');
                return;
            }

            const tree = this._buildXMLTree(xmlDoc.documentElement);
            tree.classList.add('xml-tree');
            this.container.appendChild(tree);
        } catch {
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
            const toggle = document.createElement('span');
            toggle.className = 'xml-tree-toggle';
            toggle.textContent = level < 2 ? '▼' : '▶';
            treeNode.appendChild(toggle);

            const openTag = document.createElement('span');
            openTag.className = 'xml-tree-tag';
            openTag.textContent = `<${node.tagName}`;
            treeNode.appendChild(openTag);

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

            const children = document.createElement('div');
            children.className = 'xml-tree-children';
            children.style.display = level < 2 ? 'block' : 'none';

            for (const child of node.children) {
                const childNode = this._buildXMLTree(child, level + 1);
                children.appendChild(childNode);
            }

            treeNode.appendChild(children);

            const closeTag = document.createElement('span');
            closeTag.className = 'xml-tree-tag';
            closeTag.textContent = `</${node.tagName}>`;
            treeNode.appendChild(closeTag);

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = children.style.display === 'block';
                children.style.display = isExpanded ? 'none' : 'block';
                toggle.textContent = isExpanded ? '▶' : '▼';
            });
        } else if (hasText) {
            const tag = document.createElement('span');
            tag.className = 'xml-tree-tag';
            tag.textContent = `<${node.tagName}`;
            treeNode.appendChild(tag);

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

            const textContent = document.createElement('span');
            textContent.className = 'xml-tree-text';
            textContent.textContent = node.textContent;
            treeNode.appendChild(textContent);

            const closeTag = document.createElement('span');
            closeTag.className = 'xml-tree-tag';
            closeTag.textContent = `</${node.tagName}>`;
            treeNode.appendChild(closeTag);
        } else {
            const tag = document.createElement('span');
            tag.className = 'xml-tree-tag';
            tag.textContent = `<${node.tagName}`;
            treeNode.appendChild(tag);

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
        const fragment = templateLoader.cloneSync(
            './src/templates/preview/previewRenderer.html',
            'tpl-preview-empty'
        );
        this.container.innerHTML = '';
        this.container.appendChild(fragment);
    }

    /**
     * Render error message
     * @private
     */
    _renderError(message) {
        const fragment = templateLoader.cloneSync(
            './src/templates/preview/previewRenderer.html',
            'tpl-preview-error'
        );
        const el = fragment.firstElementChild;
        const messageEl = el.querySelector('[data-role="message"]');
        if (messageEl) {
            messageEl.textContent = message;
        }
        this.container.innerHTML = '';
        this.container.appendChild(el);
    }

    /**
     * Clear preview container
     */
    clear() {
        this.container.innerHTML = '';
    }
}
