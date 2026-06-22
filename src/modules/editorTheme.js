/**
 * @fileoverview Shared CodeMirror theme utilities
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
    if (theme === 'dark' || theme === 'black') {
        return true;
    }
    if (theme === 'system') {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
}

/**
 * Resolve the active theme name to one of: 'light', 'dark', 'black'.
 * @returns {'light' | 'dark' | 'black'}
 */
function getActiveTheme() {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'black') {
        return 'black';
    }
    if (theme === 'dark') {
        return 'dark';
    }
    if (theme === 'system') {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
    }
    return 'light';
}

/**
 * Light highlight style tuned for the light theme background (#f8f9fc).
 * All token colors meet WCAG AA contrast (>=4.5:1) against the background.
 */
export const lightHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword,        color: '#9333ea' },
    { tag: tags.atom,           color: '#0369a1' },
    { tag: tags.bool,           color: '#0369a1' },
    { tag: tags.null,           color: '#0369a1' },
    { tag: tags.number,         color: '#1d4ed8' },
    { tag: tags.string,         color: '#15803d' },
    { tag: tags.propertyName,   color: '#6d28d9' },
    { tag: tags.comment,        color: '#475569', fontStyle: 'italic' },
    { tag: tags.operator,       color: '#b91c1c' },
    { tag: tags.punctuation,    color: '#1e293b' },
    { tag: tags.bracket,        color: '#1e293b' },
    { tag: tags.typeName,       color: '#7c3aed' },
    { tag: tags.variableName,   color: '#b45309' },
    { tag: tags.function(tags.variableName), color: '#1d4ed8' },
    { tag: tags.tagName,        color: '#b91c1c' },
    { tag: tags.attributeName,  color: '#6d28d9' },
    { tag: tags.attributeValue, color: '#15803d' },
]);

/**
 * Dark highlight style tuned for the dark theme background (#0a0a0b).
 * Bright comment color (#8b949e) keeps comments legible on near-black.
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
    { tag: tags.function(tags.variableName), color: '#61afef' },
    { tag: tags.tagName,        color: '#e06c75' },
    { tag: tags.attributeName,  color: '#d19a66' },
    { tag: tags.attributeValue, color: '#98c379' },
]);

/**
 * Black highlight style tuned for the OLED black background (#000000).
 * Slightly brightened versions of the dark palette so tokens don't get
 * muddy against pure black.
 */
export const blackHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword,        color: '#d586eb' },
    { tag: tags.atom,           color: '#e0a370' },
    { tag: tags.bool,           color: '#e0a370' },
    { tag: tags.null,           color: '#e0a370' },
    { tag: tags.number,         color: '#e0a370' },
    { tag: tags.string,         color: '#a3d089' },
    { tag: tags.propertyName,   color: '#ec7780' },
    { tag: tags.comment,        color: '#9ba3ad', fontStyle: 'italic' },
    { tag: tags.operator,       color: '#5fc1cd' },
    { tag: tags.punctuation,    color: '#c5cad4' },
    { tag: tags.bracket,        color: '#c5cad4' },
    { tag: tags.typeName,       color: '#edc886' },
    { tag: tags.variableName,   color: '#edc886' },
    { tag: tags.function(tags.variableName), color: '#6cbaf0' },
    { tag: tags.tagName,        color: '#ec7780' },
    { tag: tags.attributeName,  color: '#e0a370' },
    { tag: tags.attributeValue, color: '#a3d089' },
]);

export const lightHighlighting = syntaxHighlighting(lightHighlightStyle);
export const darkHighlighting = syntaxHighlighting(darkHighlightStyle);
export const blackHighlighting = syntaxHighlighting(blackHighlightStyle);

/**
 * Pick the syntax-highlighting extension for the currently active theme.
 * @returns {import('@codemirror/state').Extension}
 */
export function getHighlighting() {
    switch (getActiveTheme()) {
        case 'black': return blackHighlighting;
        case 'dark':  return darkHighlighting;
        default:      return lightHighlighting;
    }
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
