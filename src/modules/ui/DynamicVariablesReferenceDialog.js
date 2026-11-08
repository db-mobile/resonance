/**
 * @fileoverview Modal dialog listing all supported dynamic variables
 * @module ui/DynamicVariablesReferenceDialog
 */

import { BaseModal } from './BaseModal.js';
import { DYNAMIC_VARIABLES, DYNAMIC_VARIABLE_GROUPS } from '../variables/dynamicVariables.js';
import { translateLabel } from './variableLabels.js';

/**
 * @param {HTMLElement} grid
 * @returns {void}
 */
export function renderDynamicVariableRows(grid) {
    grid.replaceChildren();
    for (const [group, meta] of Object.entries(DYNAMIC_VARIABLE_GROUPS)) {
        const heading = document.createElement('span');
        heading.className = 'var-reference-group u-flex u-flex-col u-gap-2';
        heading.textContent = translateLabel(meta.labelKey, meta.label);
        grid.appendChild(heading);
        for (const info of DYNAMIC_VARIABLES.filter((entry) => entry.group === group)) {
            const code = document.createElement('code');
            code.textContent = info.example;
            const description = document.createElement('span');
            description.textContent = translateLabel(info.descriptionKey, info.description);
            grid.append(code, description);
        }
    }
}

/** @augments */
export class DynamicVariablesReferenceDialog extends BaseModal {

    /** @returns {void} */
    show() {
        const dialog = this.mount({
            overlayClass: 'var-reference-overlay',
            dialogClass: 'var-reference-dialog modal-dialog modal-dialog--var-reference',
            templatePath: './src/templates/variables/dynamicVariablesReference.html',
            templateId: 'tpl-dynamic-variables-reference'
        });

        renderDynamicVariableRows(dialog.querySelector('.var-reference-grid'));
        dialog.querySelector('#var-reference-close-btn').addEventListener('click', () => this.destroy());
    }
}
