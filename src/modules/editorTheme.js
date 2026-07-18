/**
 * @fileoverview Shared CodeMirror theme utilities.
 * @module editorTheme
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment } from '@codemirror/state';
import { tags } from '@lezer/highlight';

export const THEME_CHANGED_EVENT = 'resonance:theme-changed';

/**
 * Detect if dark mode is active based on the data-theme attribute.
 * @returns {boolean}
 */
export function isDarkMode() {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark') {
        return true;
    }
    if (theme === 'system') {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
}

/**
 * Light highlight style on the light view background (#ffffff).
 */
export const lightHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword,        color: '#613583' },
    { tag: tags.atom,           color: '#c64600' },
    { tag: tags.bool,           color: '#c64600' },
    { tag: tags.null,           color: '#c64600' },
    { tag: tags.number,         color: '#c64600' },
    { tag: tags.string,         color: '#15772e' },
    { tag: tags.propertyName,   color: '#1a5fb4' },
    { tag: tags.comment,        color: '#77767b', fontStyle: 'italic' },
    { tag: tags.operator,       color: '#a51d2d' },
    { tag: tags.punctuation,    color: '#3d3846' },
    { tag: tags.bracket,        color: '#3d3846' },
    { tag: tags.typeName,       color: '#613583' },
    { tag: tags.variableName,   color: '#905400' },
    { tag: tags.function(tags.variableName), color: '#1a5fb4' },
    { tag: tags.tagName,        color: '#a51d2d' },
    { tag: tags.attributeName,  color: '#613583' },
    { tag: tags.attributeValue, color: '#15772e' },
]);

/**
 * Dark highlight style on the dark view background (#1e1e1e).
 */
export const darkHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword,        color: '#dc8add' },
    { tag: tags.atom,           color: '#ffbe6f' },
    { tag: tags.bool,           color: '#ffbe6f' },
    { tag: tags.null,           color: '#ffbe6f' },
    { tag: tags.number,         color: '#ffbe6f' },
    { tag: tags.string,         color: '#8ff0a4' },
    { tag: tags.propertyName,   color: '#99c1f1' },
    { tag: tags.comment,        color: '#9a9996', fontStyle: 'italic' },
    { tag: tags.operator,       color: '#93ddc2' },
    { tag: tags.punctuation,    color: '#deddda' },
    { tag: tags.bracket,        color: '#deddda' },
    { tag: tags.typeName,       color: '#f8e45c' },
    { tag: tags.variableName,   color: '#f8e45c' },
    { tag: tags.function(tags.variableName), color: '#99c1f1' },
    { tag: tags.tagName,        color: '#f66151' },
    { tag: tags.attributeName,  color: '#ffbe6f' },
    { tag: tags.attributeValue, color: '#8ff0a4' },
]);

export const lightHighlighting = syntaxHighlighting(lightHighlightStyle);
export const darkHighlighting = syntaxHighlighting(darkHighlightStyle);

/**
 * Pick the syntax-highlighting extension for the currently active theme.
 * @returns {import('@codemirror/state').Extension}
 */
export function getHighlighting() {
    return isDarkMode() ? darkHighlighting : lightHighlighting;
}

/**
 * Create a CodeMirror Compartment that wraps the active highlighting and
 * automatically reconfigures it when the THEME_CHANGED_EVENT fires.
 *
 * Usage:
 *   const themed = createThemedHighlighting();
 *   // include themed.extension in EditorState extensions
 *   themed.attach(view);    // after the view is created
 *   themed.dispose();       // on editor teardown
 *
 * @returns {{ extension: import('@codemirror/state').Extension, attach: (view: import('@codemirror/view').EditorView) => void, dispose: () => void }}
 */
export function createThemedHighlighting() {
    const compartment = new Compartment();
    let view = null;
    const onChange = () => {
        if (!view) {
            return;
        }
        try {
            view.dispatch({ effects: compartment.reconfigure(getHighlighting()) });
        } catch (_) {
        }
    };
    window.addEventListener(THEME_CHANGED_EVENT, onChange);
    return {
        extension: compartment.of(getHighlighting()),
        attach(v) { view = v; },
        dispose() {
            window.removeEventListener(THEME_CHANGED_EVENT, onChange);
            view = null;
        }
    };
}
