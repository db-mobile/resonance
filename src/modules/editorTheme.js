/**
 * @fileoverview Shared CodeMirror theme utilities
 * @module editorTheme
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Detect if dark mode is active based on the data-theme attribute.
 * @returns {boolean}
 */
export function isDarkMode() {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark' || theme === 'black') {
        return true;
    }
    if (theme === 'system') {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
}

/**
 * Custom dark highlight style tuned for near-black backgrounds.
 * Uses vibrant colors with a bright comment color (#8b949e) so that
 * comments remain legible on backgrounds as dark as #0a0a0b.
 */
export const darkHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword,        color: '#c678dd' },
    { tag: tags.atom,           color: '#d19a66' },
    { tag: tags.bool,           color: '#d19a66' },
    { tag: tags.null,           color: '#d19a66' },
    { tag: tags.number,         color: '#d19a66' },
    { tag: tags.string,         color: '#98c379' },
    { tag: tags.propertyName,   color: '#e06c75' },
    { tag: tags.comment,        color: '#8b949e', fontStyle: 'italic' },
    { tag: tags.operator,       color: '#56b6c2' },
    { tag: tags.punctuation,    color: '#abb2bf' },
    { tag: tags.bracket,        color: '#abb2bf' },
    { tag: tags.typeName,       color: '#e5c07b' },
    { tag: tags.variableName,   color: '#e5c07b' },
    { tag: tags.tagName,        color: '#e06c75' },
    { tag: tags.attributeName,  color: '#d19a66' },
    { tag: tags.attributeValue, color: '#98c379' },
]);

export const darkHighlighting = syntaxHighlighting(darkHighlightStyle);
