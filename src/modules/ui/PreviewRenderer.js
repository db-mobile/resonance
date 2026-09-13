import { templateLoader } from '../templateLoader.js';
import { el } from '../htmlUtils.js';

const MAX_PREVIEW_CHARS = 512 * 1024;
const MAX_CHILD_ENTRIES = 200;

export class PreviewRenderer {
    constructor(containerElement) {
        this.container = containerElement;
    }

    /**
     * @param {string} content
     * @param {string} contentType
     */
    render(content, contentType) {
        this.clear();

        if (!content) {
            this._renderEmptyState();
            return;
        }

        if (content.length > MAX_PREVIEW_CHARS) {
            this._renderTooLarge();
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
     * @param {*} data
     * @param {number} level
     * @returns {HTMLElement}
     */
    _buildJSONTree(data, level = 0) {
        const node = el('div', 'json-tree-node');

        if (data === null) {
            const valueSpan = el('span', 'json-tree-null', 'null');
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
            const valueSpan = el('span', `json-tree-${typeof data}`, JSON.stringify(data));
            node.appendChild(valueSpan);
        }

        return node;
    }

    /**
     * @param {Object|Array} data
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

    _buildInlineObject(node, obj) {
        node.className = 'json-tree-node json-tree-inline';

        const entries = Object.entries(obj);
        if (entries.length === 0) {
            node.textContent = '{}';
            return;
        }

        node.appendChild(document.createTextNode('{ '));

        entries.forEach(([key, value], index) => {
            const keySpan = el('span', 'json-tree-key', `"${key}"`);
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

    _buildObjectNode(node, obj, level) {
        const allEntries = Object.entries(obj);
        const entries = allEntries.slice(0, MAX_CHILD_ENTRIES);

        if (allEntries.length === 0) {
            node.textContent = '{}';
            return;
        }

        const toggle = el('span', 'json-tree-toggle', level < 2 ? '▼' : '▶');
        node.appendChild(toggle);

        const openBrace = document.createElement('span');
        openBrace.textContent = '{';
        node.appendChild(openBrace);

        const children = el('div', 'json-tree-children');
        children.style.display = level < 2 ? 'block' : 'none';

        entries.forEach(([key, value], index) => {
            const childLine = el('div', 'json-tree-line');

            const keySpan = el('span', 'json-tree-key', `"${key}"`);
            childLine.appendChild(keySpan);

            childLine.appendChild(document.createTextNode(': '));

            const valueNode = this._buildJSONTree(value, level + 1);
            childLine.appendChild(valueNode);

            if (index < entries.length - 1) {
                childLine.appendChild(document.createTextNode(','));
            }

            children.appendChild(childLine);
        });

        if (allEntries.length > entries.length) {
            this._appendTruncationNotice(children, allEntries.length - entries.length);
        }

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

    _buildArrayNode(node, arr, level) {
        if (arr.length === 0) {
            node.textContent = '[]';
            return;
        }

        const toggle = el('span', 'json-tree-toggle', level < 2 ? '▼' : '▶');
        node.appendChild(toggle);

        const openBracket = document.createElement('span');
        openBracket.textContent = '[';
        node.appendChild(openBracket);

        const children = el('div', 'json-tree-children');
        children.style.display = level < 2 ? 'block' : 'none';

        const visible = arr.slice(0, MAX_CHILD_ENTRIES);
        visible.forEach((value, index) => {
            const childLine = el('div', 'json-tree-line');

            const valueNode = this._buildJSONTree(value, level + 1);
            childLine.appendChild(valueNode);

            if (index < visible.length - 1) {
                childLine.appendChild(document.createTextNode(','));
            }

            children.appendChild(childLine);
        });

        if (arr.length > visible.length) {
            this._appendTruncationNotice(children, arr.length - visible.length);
        }

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

    _renderHTML(content) {
        const iframe = el('iframe', 'response-preview-iframe');
        iframe.setAttribute('sandbox', 'allow-same-origin');

        const cspMeta = '<meta http-equiv="Content-Security-Policy" content="img-src \'none\'; script-src \'none\';">';
        const sanitizedContent = this._stripScripts(content);
        const modifiedContent = this._injectCSP(sanitizedContent, cspMeta);

        iframe.srcdoc = modifiedContent;

        this.container.appendChild(iframe);
    }

    /**
     * @param {string} content
     * @returns {string}
     */
    _stripScripts(content) {
        return content
            .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
            .replace(/<script\b[^>]*>/gi, '');
    }

    /**
     * @param {string} content
     * @param {string} cspMeta
     * @returns {string}
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
     * @param {HTMLElement} treeNode
     * @param {Element} node
     * @returns {void}
     */
    _appendOpenTag(treeNode, node) {
        const tag = el('span', 'xml-tree-tag', `<${node.tagName}`);
        treeNode.appendChild(tag);

        for (const attr of node.attributes) {
            const attrSpan = el('span', 'xml-tree-attribute', ` ${attr.name}`);
            treeNode.appendChild(attrSpan);

            treeNode.appendChild(document.createTextNode('='));

            const attrValue = el('span', 'xml-tree-string', `"${attr.value}"`);
            treeNode.appendChild(attrValue);
        }
    }

    /**
     * @param {Element} node
     * @param {number} level
     * @returns {HTMLElement}
     */
    _buildXMLTree(node, level = 0) {
        const treeNode = el('div', 'xml-tree-node');

        const hasChildren = node.children.length > 0;
        const hasText = node.childNodes.length > 0 &&
                       Array.from(node.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());

        if (hasChildren) {
            const toggle = el('span', 'xml-tree-toggle', level < 2 ? '▼' : '▶');
            treeNode.appendChild(toggle);

            this._appendOpenTag(treeNode, node);

            const closingBracket = document.createTextNode('>');
            treeNode.appendChild(closingBracket);

            const children = el('div', 'xml-tree-children');
            children.style.display = level < 2 ? 'block' : 'none';

            const childElements = Array.from(node.children).slice(0, MAX_CHILD_ENTRIES);
            for (const child of childElements) {
                const childNode = this._buildXMLTree(child, level + 1);
                children.appendChild(childNode);
            }
            if (node.children.length > childElements.length) {
                this._appendTruncationNotice(children, node.children.length - childElements.length);
            }

            treeNode.appendChild(children);

            const closeTag = el('span', 'xml-tree-tag', `</${node.tagName}>`);
            treeNode.appendChild(closeTag);

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = children.style.display === 'block';
                children.style.display = isExpanded ? 'none' : 'block';
                toggle.textContent = isExpanded ? '▶' : '▼';
            });
        } else if (hasText) {
            this._appendOpenTag(treeNode, node);

            treeNode.appendChild(document.createTextNode('>'));

            const textContent = el('span', 'xml-tree-text', node.textContent);
            treeNode.appendChild(textContent);

            const closeTag = el('span', 'xml-tree-tag', `</${node.tagName}>`);
            treeNode.appendChild(closeTag);
        } else {
            this._appendOpenTag(treeNode, node);

            treeNode.appendChild(document.createTextNode(' />'));
        }

        return treeNode;
    }

    _renderEmptyState() {
        const fragment = templateLoader.cloneSync(
            './src/templates/preview/previewRenderer.html',
            'tpl-preview-empty'
        );
        this.container.innerHTML = '';
        this.container.appendChild(fragment);
    }

    _renderError(message) {
        const fragment = templateLoader.cloneSync(
            './src/templates/preview/previewRenderer.html',
            'tpl-preview-error'
        );
        const root = fragment.firstElementChild;
        const messageEl = root.querySelector('[data-role="message"]');
        if (messageEl) {
            messageEl.textContent = message;
        }
        this.container.innerHTML = '';
        this.container.appendChild(root);
    }

    /** @returns {void} */
    _renderTooLarge() {
        this._renderError('Response too large to preview — use the code view');
    }

    /**
     * @param {HTMLElement} children
     * @param {number} hiddenCount
     * @returns {void}
     */
    _appendTruncationNotice(children, hiddenCount) {
        const line = el('div', 'json-tree-line json-tree-truncated', `… ${hiddenCount} more entries not shown`);
        children.appendChild(line);
    }

    clear() {
        this.container.innerHTML = '';
    }
}
