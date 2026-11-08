/**
 * @fileoverview CodeMirror support for `{{variable}}` tokens: pills, hover tooltip and completion
 * @module editors/variableExtension
 */

import { Decoration, ViewPlugin, MatchDecorator, hoverTooltip } from '@codemirror/view';
import { StateEffect, EditorState } from '@codemirror/state';
import { TOKEN_PATTERN, tokenize, filterEntries } from '../variables/variableTokens.js';
import { VARIABLES_CHANGED_EVENT } from '../variables/VariableContext.js';
import { renderVariableTooltip } from '../ui/VariableTooltip.js';
import { describeScope, describeValue } from '../ui/variableLabels.js';

export const refreshVariablesEffect = StateEffect.define();

const STATUS_CLASSES = new Set(['resolved', 'unresolved', 'dynamic', 'path-param', 'unknown']);
const COMPLETION_PREFIX = /\{\{\s*\$?[A-Za-z0-9_.-]*/;
const CLOSING_PATTERN = /^\s*\}\}/;

/**
 * @param {function(): (Object|null|undefined)} getContext
 * @param {string} name
 * @returns {Object}
 */
function lookupWith(getContext, name) {
    const context = getContext?.();
    return context?.lookup?.(name) ?? { status: 'unknown', name, scope: null, value: null, secret: false, envName: null };
}

/**
 * @param {Object} entry
 * @returns {string}
 */
function statusClass(entry) {
    return STATUS_CLASSES.has(entry?.status) ? entry.status : 'unresolved';
}

/**
 * @param {RegExpExecArray} match
 * @returns {string}
 */
function tokenName(match) {
    return match[1] !== undefined ? `$${match[1]}` : match[3];
}

/**
 * @param {function(): (Object|null|undefined)} getContext
 * @returns {import('@codemirror/state').Extension}
 */
export function variableDecorations(getContext) {
    const decorator = new MatchDecorator({
        regexp: new RegExp(TOKEN_PATTERN.source, 'g'),
        decoration: (match) => {
            const name = tokenName(match);
            return Decoration.mark({
                class: `var-token ${statusClass(lookupWith(getContext, name))}`,
                attributes: { 'data-var': name }
            });
        }
    });

    return ViewPlugin.fromClass(class {
        /** @param {import('@codemirror/view').EditorView} view */
        constructor(view) {
            this.decorations = decorator.createDeco(view);
            this.onVariablesChanged = () => view.dispatch({ effects: refreshVariablesEffect.of(null) });
            document.addEventListener(VARIABLES_CHANGED_EVENT, this.onVariablesChanged);
        }

        /** @param {import('@codemirror/view').ViewUpdate} update */
        update(update) {
            const refresh = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshVariablesEffect)));
            if (refresh) {
                this.decorations = decorator.createDeco(update.view);
            } else if (update.docChanged || update.viewportChanged) {
                this.decorations = decorator.updateDeco(update, this.decorations);
            }
        }

        destroy() {
            document.removeEventListener(VARIABLES_CHANGED_EVENT, this.onVariablesChanged);
        }
    }, { decorations: (plugin) => plugin.decorations });
}

/**
 * @param {function(): (Object|null|undefined)} getContext
 * @returns {import('@codemirror/state').Extension}
 */
export function variableHover(getContext) {
    return hoverTooltip((view, pos) => {
        const line = view.state.doc.lineAt(pos);
        const offset = pos - line.from;
        const token = tokenize(line.text).find((candidate) => candidate.start <= offset && offset < candidate.end);
        if (!token) {
            return null;
        }
        return {
            pos: line.from + token.start,
            end: line.from + token.end,
            above: true,
            create: () => ({ dom: renderVariableTooltip(lookupWith(getContext, token.name)) })
        };
    }, { hoverTime: 200 });
}

/**
 * @param {function(): (Object|null|undefined)} getContext
 * @returns {import('@codemirror/autocomplete').CompletionSource}
 */
export function variableCompletionSource(getContext) {
    return (completionContext) => {
        const word = completionContext.matchBefore(COMPLETION_PREFIX);
        if (!word) {
            return null;
        }
        const query = word.text.replace(/^\{\{\s*/, '');
        const entries = filterEntries(getContext?.()?.list?.() ?? [], query, 50);
        if (entries.length === 0) {
            return null;
        }
        return {
            from: word.to - query.length,
            validFor: /^\$?[A-Za-z0-9_.-]*$/,
            options: entries.map((entry) => ({
                label: entry.name,
                detail: describeScope(entry),
                info: describeValue(entry) || undefined,
                type: entry.status === 'dynamic' ? 'keyword' : 'variable',
                apply: (view, _completion, from, to) => {
                    const closing = CLOSING_PATTERN.exec(view.state.sliceDoc(to, to + 8));
                    const insert = `${entry.name}${closing ? '' : '}}'}`;
                    const anchor = from + insert.length + (closing ? closing[0].length : 0);
                    view.dispatch({ changes: { from, to, insert }, selection: { anchor } });
                }
            }))
        };
    };
}

/**
 * @param {function(): (Object|null|undefined)} getContext
 * @returns {import('@codemirror/state').Extension[]}
 */
export function variableSupport(getContext) {
    const languageData = [{ autocomplete: variableCompletionSource(getContext) }];
    return [
        variableDecorations(getContext),
        variableHover(getContext),
        EditorState.languageData.of(() => languageData)
    ];
}
