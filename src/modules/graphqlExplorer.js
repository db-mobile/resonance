/**
 * @fileoverview Postman-style click-build GraphQL query explorer. Renders a
 * checkbox tree projected from the query text (the single source of truth):
 * ticking a field rewrites the query AST, editing the query re-derives the tree.
 * @module graphqlExplorer
 */

import { parse, print, visit, parseType, Kind, getNamedType, isObjectType, isScalarType, isEnumType, isRequiredArgument } from 'graphql';
import { inputKindForType, enumValuesForType, coerceInputValue } from './graphqlTypeUtils.js';
import { debounce } from './utils/debounce.js';

const PATH_SEP = '.';

const ROOT_SECTIONS = [
    { label: 'Query', operationType: 'query', getter: 'getQueryType' },
    { label: 'Mutation', operationType: 'mutation', getter: 'getMutationType' },
    { label: 'Subscription', operationType: 'subscription', getter: 'getSubscriptionType' }
];

/**
 * Locate the operation a section's edits target: a same-type operation matching
 * the explicit name, else the first operation of that type.
 * @param {Array} definitions - Document definitions.
 * @param {string} operationType - 'query' | 'mutation' | 'subscription'.
 * @param {string|null} operationName
 * @returns {object|null} The matching OperationDefinition node, or null.
 */
function findOperation(definitions, operationType, operationName) {
    const ops = definitions.filter(def => def.kind === Kind.OPERATION_DEFINITION);
    if (operationName) {
        const named = ops.find(
            op => op.name && op.name.value === operationName && op.operation === operationType
        );
        if (named) {
            return named;
        }
    }
    return ops.find(op => op.operation === operationType) || null;
}

/**
 * Build an empty operation definition of the given type.
 * @param {string} operationType
 * @param {string|null} operationName
 * @returns {object} An OperationDefinition AST node.
 */
function createOperation(operationType, operationName) {
    return {
        kind: Kind.OPERATION_DEFINITION,
        operation: operationType,
        name: operationName ? { kind: Kind.NAME, value: operationName } : undefined,
        variableDefinitions: [],
        directives: [],
        selectionSet: { kind: Kind.SELECTION_SET, selections: [] }
    };
}

/**
 * Find a direct child Field node by name within a selection set.
 * @param {object|undefined} selectionSet
 * @param {string} name
 * @returns {object|null}
 */
function findFieldNode(selectionSet, name) {
    if (!selectionSet) {
        return null;
    }
    return selectionSet.selections.find(
        sel => sel.kind === Kind.FIELD && sel.name.value === name
    ) || null;
}

/**
 * Build a Field AST node, optionally with an (empty) selection set.
 * @param {string} name
 * @param {boolean} withSelectionSet
 * @returns {object}
 */
function makeFieldNode(name, withSelectionSet) {
    const node = {
        kind: Kind.FIELD,
        name: { kind: Kind.NAME, value: name },
        arguments: [],
        directives: []
    };
    if (withSelectionSet) {
        node.selectionSet = { kind: Kind.SELECTION_SET, selections: [] };
    }
    return node;
}

/**
 * Parse a query, or return an empty document when the text is blank.
 * @param {string} queryText
 * @returns {object} A Document AST node.
 */
function parseOrEmpty(queryText) {
    const trimmed = (queryText || '').trim();
    if (!trimmed) {
        return { kind: Kind.DOCUMENT, definitions: [] };
    }
    return parse(trimmed);
}

/**
 * Whether every field along a path exists in the selection set.
 * @param {object|undefined} selectionSet
 * @param {string[]} path
 * @returns {boolean}
 */
function pathPresent(selectionSet, path) {
    let current = selectionSet;
    for (const name of path) {
        const node = findFieldNode(current, name);
        if (!node) {
            return false;
        }
        current = node.selectionSet;
    }
    return true;
}

/**
 * Drop variable definitions no longer referenced anywhere in the operation's
 * selection set (GraphQL treats an unused variable as an error).
 * @param {object} op - OperationDefinition node.
 */
function pruneUnusedVariables(op) {
    if (!op.variableDefinitions || op.variableDefinitions.length === 0) {
        return;
    }
    const used = new Set();
    visit(op.selectionSet, { Variable(node) { used.add(node.name.value); } });
    op.variableDefinitions = op.variableDefinitions.filter(def => used.has(def.variable.name.value));
}

/**
 * Add a field (and any missing ancestors) along a path. Ancestors always get a
 * selection set; the leaf gets one only when it is an object type. Arguments are
 * not added here — they are filled inline in the Explorer (see setArgumentInQuery).
 * @param {object} selectionSet - The operation's root selection set.
 * @param {string[]} path
 * @param {boolean} leafIsObject
 * @param {string[]} leafDefaultFields - Scalar/enum field names to pre-select
 *   when the leaf is a newly created object field.
 */
function addPath(selectionSet, path, leafIsObject, leafDefaultFields) {
    let current = selectionSet;
    path.forEach((name, index) => {
        const isLeaf = index === path.length - 1;
        let node = findFieldNode(current, name);
        if (!node) {
            node = makeFieldNode(name, !isLeaf || leafIsObject);
            if (isLeaf && leafIsObject && leafDefaultFields.length > 0) {
                node.selectionSet.selections = leafDefaultFields.map(child => makeFieldNode(child, false));
            }
            current.selections = [...current.selections, node];
        } else if (!isLeaf && !node.selectionSet) {
            node.selectionSet = { kind: Kind.SELECTION_SET, selections: [] };
        }
        current = node.selectionSet;
    });
}

/**
 * Remove the field at a path and prune any ancestor left with no selections.
 * @param {object|undefined} selectionSet
 * @param {string[]} path
 */
function removePath(selectionSet, path) {
    if (!selectionSet || path.length === 0) {
        return;
    }
    const [head, ...rest] = path;
    const node = findFieldNode(selectionSet, head);
    if (!node) {
        return;
    }
    if (rest.length === 0) {
        selectionSet.selections = selectionSet.selections.filter(sel => sel !== node);
        return;
    }
    removePath(node.selectionSet, rest);
    if (node.selectionSet && node.selectionSet.selections.length === 0) {
        selectionSet.selections = selectionSet.selections.filter(sel => sel !== node);
    }
}

/**
 * Collect the dotted paths of every field in a selection set (all depths).
 * @param {object|undefined} selectionSet
 * @param {string[]} prefix
 * @param {Set<string>} out
 */
function collectPaths(selectionSet, prefix, out) {
    if (!selectionSet) {
        return;
    }
    selectionSet.selections.forEach(sel => {
        if (sel.kind !== Kind.FIELD) {
            return;
        }
        const next = [...prefix, sel.name.value];
        out.add(next.join(PATH_SEP));
        collectPaths(sel.selectionSet, next, out);
    });
}

/**
 * Add or remove a field in a query, returning the reprinted query text. The
 * document AST is edited surgically, so unmodeled nodes (fragments, directives,
 * arguments, aliases on other fields) are preserved on round-trip.
 * @param {object} opts
 * @param {string} opts.queryText - Current query (may be empty).
 * @param {string} [opts.operationType] - Root operation type.
 * @param {string|null} [opts.operationName]
 * @param {string[]} opts.path - Field path from the root operation.
 * @param {boolean} [opts.leafIsObject] - Whether the leaf field is an object type.
 * @param {string[]} [opts.leafDefaultFields] - Scalar/enum field names to
 *   pre-select when adding an object leaf, so it is never an empty selection.
 * @returns {string} The new query text.
 */
export function toggleFieldInQuery({
    queryText,
    operationType = 'query',
    operationName = null,
    path,
    leafIsObject = false,
    leafDefaultFields = []
}) {
    const doc = parseOrEmpty(queryText);
    let op = findOperation(doc.definitions, operationType, operationName);
    if (!op) {
        op = createOperation(operationType, operationName);
        doc.definitions = [...doc.definitions, op];
    }
    if (pathPresent(op.selectionSet, path)) {
        removePath(op.selectionSet, path);
        pruneUnusedVariables(op);
        if (op.selectionSet.selections.length === 0) {
            doc.definitions = doc.definitions.filter(def => def !== op);
        }
    } else {
        addPath(op.selectionSet, path, leafIsObject, leafDefaultFields);
    }
    return print(doc);
}

/**
 * Navigate to the Field node at a path within a selection set.
 * @param {object|undefined} selectionSet
 * @param {string[]} path
 * @returns {object|null}
 */
function findFieldAtPath(selectionSet, path) {
    let current = selectionSet;
    let node = null;
    for (const name of path) {
        node = findFieldNode(current, name);
        if (!node) {
            return null;
        }
        current = node.selectionSet;
    }
    return node;
}

/**
 * @param {string} value
 * @returns {string}
 */
function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The names of variables already declared on an operation.
 * @param {object} op
 * @returns {Set<string>}
 */
function existingVarNames(op) {
    const set = new Set();
    (op.variableDefinitions || []).forEach(def => set.add(def.variable.name.value));
    return set;
}

/**
 * Pick a unique variable name, preferring the bare argument name and
 * disambiguating with the field name (then a counter) on collision.
 * @param {Set<string>} used
 * @param {string} fieldName
 * @param {string} argName
 * @returns {string}
 */
function allocVarName(used, fieldName, argName) {
    const base = used.has(argName) ? fieldName + capitalize(argName) : argName;
    let name = base;
    let i = 2;
    while (used.has(name)) {
        name = base + i;
        i += 1;
    }
    return name;
}

/**
 * @param {string} argName
 * @param {string} varName
 * @returns {object} An Argument node binding the argument to a variable.
 */
function variableArgument(argName, varName) {
    return {
        kind: Kind.ARGUMENT,
        name: { kind: Kind.NAME, value: argName },
        value: { kind: Kind.VARIABLE, name: { kind: Kind.NAME, value: varName } }
    };
}

/**
 * @param {string} varName
 * @param {string} typeString
 * @returns {object} A VariableDefinition node.
 */
function variableDefinition(varName, typeString) {
    return {
        kind: Kind.VARIABLE_DEFINITION,
        variable: { kind: Kind.VARIABLE, name: { kind: Kind.NAME, value: varName } },
        type: parseType(typeString),
        directives: []
    };
}

/**
 * @param {*} value
 * @returns {string} An input display string for a stored variable value.
 */
function toInputString(value) {
    if (value === null || value === undefined || value === '') {
        return '';
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}

/**
 * Parse a variables JSON string into an object (empty object on blank/invalid).
 * @param {string} variablesText
 * @returns {object}
 */
function parseVariables(variablesText) {
    const trimmed = (variablesText || '').trim();
    if (!trimmed) {
        return {};
    }
    try {
        const obj = JSON.parse(trimmed);
        return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch (_e) {
        return {};
    }
}

/**
 * @param {object} vars
 * @returns {string} Pretty JSON, or '' when empty.
 */
function stringifyVariables(vars) {
    return Object.keys(vars).length === 0 ? '' : JSON.stringify(vars, null, 2);
}

/**
 * The variable an argument is bound to on a field, or null.
 * @param {object} field - Field node.
 * @param {string} argName
 * @returns {string|null}
 */
function boundVariableName(field, argName) {
    const arg = field?.arguments?.find(a => a.name.value === argName);
    return arg && arg.value.kind === Kind.VARIABLE ? arg.value.name.value : null;
}

/**
 * The current value of a field's argument (via its bound variable), as an input
 * display string.
 * @param {object} opts
 * @param {string} opts.queryText
 * @param {string} opts.variablesText
 * @param {string} [opts.operationType]
 * @param {string|null} [opts.operationName]
 * @param {string[]} opts.path
 * @param {string} opts.argName
 * @returns {string}
 */
export function getArgumentValue({ queryText, variablesText, operationType = 'query', operationName = null, path, argName }) {
    const trimmed = (queryText || '').trim();
    if (!trimmed) {
        return '';
    }
    let doc;
    try {
        doc = parse(trimmed);
    } catch (_e) {
        return '';
    }
    const op = findOperation(doc.definitions, operationType, operationName);
    const field = op ? findFieldAtPath(op.selectionSet, path) : null;
    const varName = field ? boundVariableName(field, argName) : null;
    if (!varName) {
        return '';
    }
    return toInputString(parseVariables(variablesText)[varName]);
}

/**
 * Set (or clear) an argument's value. The argument is bound to a query variable
 * (`arg: $var`, auto-declared) and the value is stored in the variables payload.
 * An empty value clears the value; for an optional argument it also unbinds the
 * variable, for a required one it keeps the binding (declared but unset).
 * @param {object} opts
 * @param {string} opts.queryText
 * @param {string} opts.variablesText
 * @param {string} [opts.operationType]
 * @param {string|null} [opts.operationName]
 * @param {string[]} opts.path
 * @param {string} opts.argName
 * @param {string} opts.argType - The argument's printed type.
 * @param {boolean} [opts.required]
 * @param {*} opts.raw - Widget value (string, or boolean for checkboxes).
 * @returns {{query: string, variables: string}}
 */
export function setArgumentValue({ queryText, variablesText, operationType = 'query', operationName = null, path, argName, argType, required = false, raw }) {
    const doc = parseOrEmpty(queryText);
    const op = findOperation(doc.definitions, operationType, operationName);
    const field = op ? findFieldAtPath(op.selectionSet, path) : null;
    if (!field) {
        return { query: queryText, variables: variablesText };
    }
    const vars = parseVariables(variablesText);
    const empty = typeof raw === 'boolean' ? raw === false : (typeof raw !== 'string' || raw.trim() === '');
    let varName = boundVariableName(field, argName);

    if (empty && !required) {
        field.arguments = (field.arguments || []).filter(a => a.name.value !== argName);
        pruneUnusedVariables(op);
        if (varName) {
            delete vars[varName];
        }
        return { query: print(doc), variables: stringifyVariables(vars) };
    }

    if (!varName) {
        varName = allocVarName(existingVarNames(op), field.name.value, argName);
        field.arguments = [...(field.arguments || []).filter(a => a.name.value !== argName), variableArgument(argName, varName)];
        op.variableDefinitions = [...(op.variableDefinitions || []), variableDefinition(varName, argType)];
    }
    if (empty) {
        delete vars[varName];
    } else {
        vars[varName] = coerceInputValue(raw, argType);
    }
    return { query: print(doc), variables: stringifyVariables(vars) };
}

/**
 * List the variable names declared by the operations in a query.
 * @param {string} queryText
 * @returns {string[]}
 */
export function getDeclaredVariables(queryText) {
    const trimmed = (queryText || '').trim();
    if (!trimmed) {
        return [];
    }
    let doc;
    try {
        doc = parse(trimmed);
    } catch (_e) {
        return [];
    }
    const names = [];
    doc.definitions.forEach(def => {
        if (def.kind !== Kind.OPERATION_DEFINITION) {
            return;
        }
        (def.variableDefinitions || []).forEach(v => names.push(v.variable.name.value));
    });
    return names;
}

/**
 * List the variables declared by the operations in a query, with their types.
 * @param {string} queryText
 * @returns {Array<{name: string, type: string, required: boolean}>}
 *   `type` is the printed GraphQL type (e.g. `ID!`, `[String!]`), `required`
 *   is true for a non-null top-level type.
 */
export function getDeclaredVariableDefs(queryText) {
    const trimmed = (queryText || '').trim();
    if (!trimmed) {
        return [];
    }
    let doc;
    try {
        doc = parse(trimmed);
    } catch (_e) {
        return [];
    }
    const defs = [];
    doc.definitions.forEach(def => {
        if (def.kind !== Kind.OPERATION_DEFINITION) {
            return;
        }
        (def.variableDefinitions || []).forEach(v => defs.push({
            name: v.variable.name.value,
            type: print(v.type),
            required: v.type.kind === Kind.NON_NULL_TYPE
        }));
    });
    return defs;
}

/**
 * Derive the set of selected field paths for a given operation type.
 * @param {string} queryText
 * @param {string} [operationType]
 * @param {string|null} [operationName]
 * @returns {Set<string>|null} Dotted paths, or null when the query cannot be parsed.
 */
export function getSelectedPaths(queryText, operationType = 'query', operationName = null) {
    const trimmed = (queryText || '').trim();
    if (!trimmed) {
        return new Set();
    }
    let doc;
    try {
        doc = parse(trimmed);
    } catch (_e) {
        return null;
    }
    const op = findOperation(doc.definitions, operationType, operationName);
    const paths = new Set();
    if (op) {
        collectPaths(op.selectionSet, [], paths);
    }
    return paths;
}

/**
 * Interactive schema tree bound to a query editor via the onQueryChange callback.
 */
export class GraphQLExplorer {
    /**
     * @param {HTMLElement} railEl - The container to render the tree into.
     */
    constructor(railEl) {
        this.railEl = railEl;
        this.schema = null;
        this.queryText = '';
        this.variablesText = '';
        this.operationName = null;
        this.onQueryChange = null;
        this.onVariablesChange = null;
        this.searchTerm = '';
        this.treeEl = null;
        this.noticeEl = null;
    }

    /**
     * Build (or rebuild) the whole tree. Expansion state is not preserved across
     * a full render; use {@link refreshState} for cheap checkbox updates.
     * @param {import('graphql').GraphQLSchema|null} schema
     * @param {string} queryText
     * @param {string} variablesText
     * @param {string|null} operationName
     * @param {{onQueryChange?: function(string): void, onVariablesChange?: function(string): void}} handlers
     */
    render(schema, queryText, variablesText, operationName, { onQueryChange, onVariablesChange } = {}) {
        this.schema = schema;
        this.queryText = queryText || '';
        this.variablesText = variablesText || '';
        this.operationName = operationName || null;
        this.onQueryChange = onQueryChange || null;
        this.onVariablesChange = onVariablesChange || null;
        this.railEl.innerHTML = '';

        if (!schema) {
            this._renderEmpty('Load the schema (Schema button) to browse and build queries.');
            return;
        }

        this.railEl.appendChild(this._buildSearch());
        this.noticeEl = document.createElement('div');
        this.noticeEl.className = 'graphql-explorer-notice';
        this.noticeEl.style.display = 'none';
        this.railEl.appendChild(this.noticeEl);

        this.treeEl = document.createElement('div');
        this.treeEl.className = 'graphql-explorer-tree';
        this.railEl.appendChild(this.treeEl);

        this._renderSections();
        this._applySelectionState();
    }

    /**
     * Recompute checkbox + argument state from new query/variables without
     * rebuilding the DOM. On a parse error the tree shows the disabled notice.
     * @param {string} queryText
     * @param {string} [variablesText]
     */
    refreshState(queryText, variablesText) {
        this.queryText = queryText || '';
        if (variablesText !== undefined) {
            this.variablesText = variablesText || '';
        }
        if (!this.treeEl) {
            return;
        }
        this._applySelectionState();
    }

    /**
     * @param {string} message
     */
    _renderEmpty(message) {
        const el = document.createElement('div');
        el.className = 'graphql-explorer-empty';
        el.textContent = message;
        this.railEl.appendChild(el);
    }

    /**
     * @returns {HTMLElement} The search field wrapper.
     */
    _buildSearch() {
        const input = document.createElement('input');
        input.type = 'search';
        input.className = 'entry graphql-explorer-search';
        input.placeholder = 'Search fields';
        input.setAttribute('aria-label', 'Search fields');
        input.addEventListener('input', () => {
            this.searchTerm = input.value.trim().toLowerCase();
            this._applyFilter();
        });
        return input;
    }

    /**
     * Render one section per root operation type present in the schema.
     */
    _renderSections() {
        ROOT_SECTIONS.forEach(({ label, operationType, getter }) => {
            const rootType = this.schema[getter]?.();
            if (!rootType) {
                return;
            }
            const section = document.createElement('section');
            section.className = 'graphql-explorer-section';
            const heading = document.createElement('h4');
            heading.textContent = label;
            section.appendChild(heading);
            const fields = rootType.getFields();
            Object.keys(fields).forEach(name => {
                section.appendChild(this._buildFieldRow(fields[name], [name], operationType));
            });
            this.treeEl.appendChild(section);
        });
    }

    /**
     * Build a single field row (checkbox, name, type, optional expander).
     * @param {object} field - graphql-js field definition.
     * @param {string[]} path
     * @param {string} operationType
     * @returns {HTMLElement}
     */
    _buildFieldRow(field, path, operationType) {
        const namedType = getNamedType(field.type);
        const isObj = isObjectType(namedType);

        const wrapper = document.createElement('div');
        wrapper.className = 'graphql-explorer-item';

        const row = document.createElement('div');
        row.className = 'graphql-explorer-node';
        row.dataset.path = path.join(PATH_SEP);
        row.dataset.optype = operationType;
        row.dataset.name = field.name.toLowerCase();

        const chevron = document.createElement('span');
        if (isObj) {
            chevron.className = 'graphql-explorer-toggle icon icon-12 icon-chevron-down';
        } else {
            chevron.className = 'graphql-explorer-toggle-spacer';
        }
        row.appendChild(chevron);

        const requiredArgs = (field.args || [])
            .filter(isRequiredArgument)
            .map(a => ({ name: a.name, type: a.type.toString() }));

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'check';
        checkbox.addEventListener('change', () => this._onToggle(path, operationType, isObj, wrapper, isObj ? namedType : null, requiredArgs));
        row.appendChild(checkbox);

        const name = document.createElement('span');
        name.className = 'graphql-explorer-name';
        name.textContent = field.name;
        row.appendChild(name);

        const type = document.createElement('span');
        type.className = 'graphql-explorer-type';
        type.textContent = field.type.toString();
        row.appendChild(type);

        const hasArgs = !!(field.args && field.args.length > 0);
        if (hasArgs) {
            const argHint = document.createElement('span');
            argHint.className = 'graphql-explorer-arg-tag';
            argHint.textContent = 'ARG';
            argHint.title = 'Takes arguments — check the field to edit them inline.';
            row.appendChild(argHint);
        }

        wrapper.appendChild(row);

        if (hasArgs) {
            const argsEl = document.createElement('div');
            argsEl.className = 'graphql-explorer-args';
            argsEl.style.display = 'none';
            field.args.forEach(arg => argsEl.appendChild(this._buildArgRow(arg, path, operationType)));
            wrapper.appendChild(argsEl);
        }

        if (isObj) {
            const children = document.createElement('div');
            children.className = 'graphql-explorer-children';
            wrapper.appendChild(children);
            chevron.addEventListener('click', () => this._toggleExpand(wrapper, namedType, path, operationType));
        }

        return wrapper;
    }

    /**
     * Build an inline argument row (name + type + typed value input).
     * @param {object} arg - graphql-js argument definition.
     * @param {string[]} path - Path of the field that owns the argument.
     * @param {string} operationType
     * @returns {HTMLElement}
     */
    _buildArgRow(arg, path, operationType) {
        const argType = arg.type.toString();
        const kind = inputKindForType(argType, this.schema);

        const row = document.createElement('div');
        row.className = 'graphql-explorer-arg-row';
        row.dataset.arg = arg.name;
        row.dataset.argtype = argType;
        row.dataset.required = String(isRequiredArgument(arg));
        row.dataset.path = path.join(PATH_SEP);
        row.dataset.optype = operationType;

        const name = document.createElement('span');
        name.className = 'graphql-explorer-arg-name';
        name.textContent = arg.name;
        row.appendChild(name);

        const type = document.createElement('span');
        type.className = 'graphql-explorer-arg-type';
        type.textContent = argType;
        if (isRequiredArgument(arg)) {
            type.classList.add('is-required');
            type.title = 'Required';
        }
        row.appendChild(type);

        row.appendChild(this._buildArgControl(kind, argType));
        return row;
    }

    /**
     * Build the value control for an argument row.
     * @param {string} kind
     * @param {string} argType
     * @returns {HTMLElement}
     */
    _buildArgControl(kind, argType) {
        if (kind === 'boolean') {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'check graphql-explorer-arg-value';
            cb.addEventListener('change', () => this._onArgChange(cb));
            return cb;
        }
        if (kind === 'enum') {
            const select = document.createElement('select');
            select.className = 'select-base compact graphql-explorer-arg-value';
            ['', ...enumValuesForType(argType, this.schema)].forEach(opt => {
                const o = document.createElement('option');
                o.value = opt;
                o.textContent = opt || '—';
                select.appendChild(o);
            });
            select.addEventListener('change', () => this._onArgChange(select));
            return select;
        }
        const input = document.createElement('input');
        input.type = kind === 'number' ? 'number' : 'text';
        input.className = 'entry graphql-explorer-arg-value';
        if (kind === 'json') {
            input.placeholder = 'value';
        }
        const debounced = debounce(() => this._onArgChange(input), 250);
        input.addEventListener('input', debounced);
        return input;
    }

    /**
     * Store an argument row's value on its bound query variable (auto-binding the
     * variable as needed) and emit the new query + variables.
     * @param {HTMLElement} control
     */
    _onArgChange(control) {
        const row = control.closest('.graphql-explorer-arg-row');
        if (!row) {
            return;
        }
        const raw = control.type === 'checkbox' ? control.checked : control.value;
        let result;
        try {
            result = setArgumentValue({
                queryText: this.queryText,
                variablesText: this.variablesText,
                operationType: row.dataset.optype,
                operationName: this.operationName,
                path: row.dataset.path ? row.dataset.path.split(PATH_SEP) : [],
                argName: row.dataset.arg,
                argType: row.dataset.argtype,
                required: row.dataset.required === 'true',
                raw
            });
        } catch (_e) {
            return;
        }
        this._emitChange(result);
    }

    /**
     * Push a {query, variables} result to the host and cache it locally.
     * @param {{query: string, variables: string}} result
     */
    _emitChange(result) {
        const queryChanged = result.query !== this.queryText;
        const variablesChanged = result.variables !== this.variablesText;
        this.queryText = result.query;
        this.variablesText = result.variables;
        if (queryChanged && this.onQueryChange) {
            this.onQueryChange(result.query);
        }
        if (variablesChanged && this.onVariablesChange) {
            this.onVariablesChange(result.variables);
        }
    }

    /**
     * Lazily build (once) and show/hide a field's child rows.
     * @param {HTMLElement} wrapper
     * @param {object} namedType - The object type whose fields to render.
     * @param {string[]} path
     * @param {string} operationType
     */
    _toggleExpand(wrapper, namedType, path, operationType) {
        const children = wrapper.querySelector(':scope > .graphql-explorer-children');
        if (!children) {
            return;
        }
        if (!wrapper.classList.contains('expanded')) {
            if (children.childElementCount === 0) {
                const fields = namedType.getFields();
                Object.keys(fields).forEach(name => {
                    children.appendChild(this._buildFieldRow(fields[name], [...path, name], operationType));
                });
                this._applySelectionState();
                this._applyFilter();
            }
            wrapper.classList.add('expanded');
        } else {
            wrapper.classList.remove('expanded');
        }
    }

    /**
     * Handle a checkbox toggle: rewrite the query and expand object fields so the
     * user can pick sub-fields (an object field with no selections is incomplete).
     * @param {string[]} path
     * @param {string} operationType
     * @param {boolean} leafIsObject
     * @param {HTMLElement} wrapper
     * @param {object|null} leafType
     * @param {Array<{name: string, type: string}>} [requiredArgs] - Bound to
     *   variables when the field is turned on (Postman-style).
     */
    _onToggle(path, operationType, leafIsObject, wrapper, leafType, requiredArgs = []) {
        let query;
        try {
            query = toggleFieldInQuery({
                queryText: this.queryText,
                operationType,
                operationName: this.operationName,
                path,
                leafIsObject,
                leafDefaultFields: leafIsObject ? this._defaultScalarFields(leafType) : []
            });
        } catch (_e) {
            return;
        }
        const nowChecked = !!getSelectedPaths(query, operationType, this.operationName)?.has(path.join(PATH_SEP));
        let variables = this.variablesText;
        if (nowChecked) {
            requiredArgs.forEach(arg => {
                const res = setArgumentValue({
                    queryText: query,
                    variablesText: variables,
                    operationType,
                    operationName: this.operationName,
                    path,
                    argName: arg.name,
                    argType: arg.type,
                    required: true,
                    raw: ''
                });
                ({ query, variables } = res);
            });
        }
        this._emitChange({ query, variables });
        this._applySelectionState();

        if (leafIsObject && wrapper && !wrapper.classList.contains('expanded')) {
            const checkbox = wrapper.querySelector(':scope > .graphql-explorer-node input.check');
            if (checkbox && checkbox.checked) {
                wrapper.querySelector(':scope > .graphql-explorer-node .graphql-explorer-toggle')?.click();
            }
        }
    }

    /**
     * The immediate scalar/enum field names of an object type, excluding any that
     * require arguments (which would be invalid without a supplied value). Used to
     * pre-populate a freshly checked object field with a sensible default selection.
     * @param {object|null} namedType - An object type, or null.
     * @returns {string[]}
     */
    _defaultScalarFields(namedType) {
        if (!namedType || typeof namedType.getFields !== 'function') {
            return [];
        }
        const fields = namedType.getFields();
        return Object.keys(fields).filter(name => {
            const field = fields[name];
            const type = getNamedType(field.type);
            if (!isScalarType(type) && !isEnumType(type)) {
                return false;
            }
            return !(field.args || []).some(isRequiredArgument);
        });
    }

    /**
     * Sync every rendered checkbox with the current query, or show the parse-error
     * notice and disable toggles when the query cannot be parsed.
     */
    _applySelectionState() {
        const byType = {};
        let parseError = false;
        ROOT_SECTIONS.forEach(({ operationType }) => {
            const paths = getSelectedPaths(this.queryText, operationType, this.operationName);
            if (paths === null) {
                parseError = true;
            }
            byType[operationType] = paths;
        });

        this._setNotice(parseError
            ? 'The query has a syntax error — fix it to use the explorer.'
            : '');

        this.treeEl.querySelectorAll('.graphql-explorer-node').forEach(row => {
            const checkbox = row.querySelector('input.check');
            if (!checkbox) {
                return;
            }
            checkbox.disabled = parseError;
            const paths = byType[row.dataset.optype];
            const checked = !parseError && !!paths && paths.has(row.dataset.path);
            checkbox.checked = checked;
            this._syncArgsForRow(row, checked, parseError);
        });
    }

    /**
     * Show a field's argument rows only when it is checked, and refresh each arg
     * input from the query (skipping the one being edited).
     * @param {HTMLElement} row - The field's `.graphql-explorer-node`.
     * @param {boolean} checked
     * @param {boolean} parseError
     */
    _syncArgsForRow(row, checked, parseError) {
        const argsEl = row.parentElement?.querySelector(':scope > .graphql-explorer-args');
        if (!argsEl) {
            return;
        }
        const show = checked && !parseError;
        argsEl.style.display = show ? '' : 'none';
        if (!show) {
            return;
        }
        argsEl.querySelectorAll('.graphql-explorer-arg-row').forEach(argRow => {
            const control = argRow.querySelector('.graphql-explorer-arg-value');
            if (!control || control === document.activeElement) {
                return;
            }
            const value = getArgumentValue({
                queryText: this.queryText,
                variablesText: this.variablesText,
                operationType: argRow.dataset.optype,
                operationName: this.operationName,
                path: argRow.dataset.path ? argRow.dataset.path.split(PATH_SEP) : [],
                argName: argRow.dataset.arg
            });
            if (control.type === 'checkbox') {
                control.checked = value === 'true';
            } else {
                control.value = value;
            }
        });
    }

    /**
     * @param {string} message - Empty string hides the notice.
     */
    _setNotice(message) {
        if (!this.noticeEl) {
            return;
        }
        this.noticeEl.textContent = message;
        this.noticeEl.style.display = message ? '' : 'none';
    }

    /**
     * Filter rendered rows by the current search term (matches field name).
     * Rows inside collapsed object fields are only searched once expanded.
     */
    _applyFilter() {
        const term = this.searchTerm;
        this.treeEl.querySelectorAll('.graphql-explorer-item').forEach(item => {
            const row = item.querySelector(':scope > .graphql-explorer-node');
            const name = row ? row.dataset.name || '' : '';
            const match = !term || name.includes(term);
            item.style.display = match ? '' : 'none';
        });
    }
}
