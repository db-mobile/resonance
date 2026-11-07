/**
 * @fileoverview Feature descriptor wiring the shared VariableContext to environment, collection-variable and endpoint changes.
 * @module variableContext.feature
 */

import { VariableContext, VARIABLES_CHANGED_EVENT } from './variables/VariableContext.js';
import { getCurrentEndpoint, onCurrentEndpointChange } from './state/currentEndpoint.js';
import { parseKeyValuePairs } from './keyValueManager.js';
import { URL_UPDATED_EVENT } from './ui/mirroredUrlSection.js';
import { VariableAutocomplete } from './ui/VariableAutocomplete.js';
import { VariableTooltip } from './ui/VariableTooltip.js';
import {
    decorateInput,
    isDecorated,
    lookupVariable,
    refreshAll,
    refreshInput,
    setUrlVariableLookup,
    setVariableLookup,
    FORM_RESTORED_EVENT
} from './ui/inputDecorator.js';

/**
 * @param {VariableContext} context
 * @returns {void}
 */
function installInputDecoration(context) {
    const urlInput = document.getElementById('url-input');
    const pathParamsList = document.getElementById('path-params-list');

    setVariableLookup((name) => context.lookup(name));
    setUrlVariableLookup(() => (pathParamsList ? parseKeyValuePairs(pathParamsList) : null));

    document.addEventListener(VARIABLES_CHANGED_EVENT, refreshAll);
    document.addEventListener(FORM_RESTORED_EVENT, refreshAll);

    if (urlInput) {
        decorateInput(urlInput, { url: true });
        urlInput.addEventListener(URL_UPDATED_EVENT, () => refreshInput(urlInput));
    }
    pathParamsList?.addEventListener('input', refreshAll);

    new VariableAutocomplete(() => context).install();
    new VariableTooltip((name, input) => lookupVariable(name, input), { isTarget: isDecorated }).install();
}

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const variableContextFeature = {
    name: 'variableContext',
    create(ctx) {
        const environmentService = ctx.get('environmentService');
        const variableService = ctx.get('collectionVariableService');
        const context = new VariableContext({ environmentService, variableService, getCurrentEndpoint });

        environmentService.addChangeListener(() => context.refresh());
        variableService.addChangeListener(() => context.refresh());
        onCurrentEndpointChange(() => context.refresh());

        return { context };
    },
    globals: { variableContext: 'context' },
    provides: { variableContext: 'context' },
    init({ context }) {
        if (typeof document?.getElementById === 'function') {
            installInputDecoration(context);
        }
        return context.refresh();
    },
};
