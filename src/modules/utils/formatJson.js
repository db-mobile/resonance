/**
 * @fileoverview Whitespace-only JSON pretty-printer that tolerates {{var}} placeholders.
 * @module modules/utils/formatJson
 */

const INDENT = '  ';

/**
 * @param {string} text
 * @param {number} start
 * @returns {number}
 */
function stringEnd(text, start) {
    let i = start + 1;
    while (i < text.length) {
        if (text[i] === '\\') {
            i += 2;
        } else if (text[i] === '"') {
            return i + 1;
        } else {
            i++;
        }
    }
    return text.length;
}

/**
 * @param {string} text
 * @returns {Array<{type: string, value: string, start?: number}>}
 */
function tokenize(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (/\s/.test(ch)) {
            i++;
        } else if (ch === '"') {
            const end = stringEnd(text, i);
            tokens.push({ type: 'string', value: text.slice(i, end) });
            i = end;
        } else if (text.startsWith('{{', i)) {
            const close = text.indexOf('}}', i + 2);
            const end = close === -1 ? text.length : close + 2;
            tokens.push({ type: 'placeholder', value: text.slice(i, end), start: i });
            i = end;
        } else if ('{}[],:'.includes(ch)) {
            tokens.push({ type: ch, value: ch });
            i++;
        } else {
            let end = i;
            while (end < text.length && !/[\s"{}[\],:]/.test(text[end])) {
                end++;
            }
            tokens.push({ type: 'literal', value: text.slice(i, end) });
            i = end;
        }
    }
    return tokens;
}

/**
 * @param {Array<{type: string, value: string}>} tokens
 * @returns {string}
 */
function render(tokens) {
    let out = '';
    let depth = 0;
    for (let i = 0; i < tokens.length; i++) {
        const { type, value } = tokens[i];
        const next = tokens[i + 1];
        if (type === '{' || type === '[') {
            const closer = type === '{' ? '}' : ']';
            if (next && next.type === closer) {
                out += type + closer;
                i++;
            } else {
                depth++;
                out += `${type}\n${INDENT.repeat(depth)}`;
            }
        } else if (type === '}' || type === ']') {
            depth--;
            out += `\n${INDENT.repeat(depth)}${type}`;
        } else if (type === ',') {
            out += `,\n${INDENT.repeat(depth)}`;
        } else if (type === ':') {
            out += ': ';
        } else {
            out += value;
        }
    }
    return out;
}

/**
 * @param {string} text
 * @param {Array<{type: string, value: string, start?: number}>} tokens
 * @returns {string}
 */
function toParseable(text, tokens) {
    let out = '';
    let cursor = 0;
    for (const { type, value, start } of tokens) {
        if (type === 'placeholder') {
            out += text.slice(cursor, start) + '0'.padEnd(value.length);
            cursor = start + value.length;
        }
    }
    return out + text.slice(cursor);
}

/**
 * @param {string} text
 * @returns {{ok: true, text: string} | {ok: false, error: Error}}
 */
export function formatJsonBody(text) {
    if (!text.trim()) {
        return { ok: true, text };
    }
    const tokens = tokenize(text);
    try {
        JSON.parse(toParseable(text, tokens));
    } catch (error) {
        return { ok: false, error: /** @type {Error} */ (error) };
    }
    return { ok: true, text: render(tokens) };
}
