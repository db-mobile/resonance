/**
 * @fileoverview Catalogue of the dynamic `{{$name}}` variables generated at request time
 * @module variables/dynamicVariables
 * @typedef {'time'|'number'|'sample'} DynamicVariableGroup
 * @typedef {Object} DynamicVariableInfo
 * @property {string} name
 * @property {string} example
 * @property {DynamicVariableGroup} group
 * @property {string} description
 * @property {string} descriptionKey
 */

/**
 * @param {string} name
 * @param {string} example
 * @param {DynamicVariableGroup} group
 * @param {string} description
 * @returns {DynamicVariableInfo}
 */
function entry(name, example, group, description) {
    return Object.freeze({ name, example, group, description, descriptionKey: `variables.dynamic.${name}` });
}

/** @type {ReadonlyArray<DynamicVariableInfo>} */
export const DYNAMIC_VARIABLES = Object.freeze([
    entry('timestamp', '{{$timestamp}}', 'time', 'Unix timestamp, seconds'),
    entry('timestampMs', '{{$timestampMs}}', 'time', 'Unix timestamp, milliseconds'),
    entry('isoTimestamp', '{{$isoTimestamp}}', 'time', 'ISO 8601 date and time'),
    entry('randomDate', '{{$randomDate:30}}', 'time', 'Date within ±N days (default 365)'),
    entry('randomDatePast', '{{$randomDatePast:30}}', 'time', 'Date in the past N days'),
    entry('randomDateFuture', '{{$randomDateFuture:30}}', 'time', 'Date in the next N days'),
    entry('uuid', '{{$uuid}}', 'number', 'UUID v4'),
    entry('randomInt', '{{$randomInt:1:100}}', 'number', 'Integer in range (default 0–1000)'),
    entry('randomPrice', '{{$randomPrice:1:100}}', 'number', 'Price with 2 decimals (default 1–1000)'),
    entry('randomBoolean', '{{$randomBoolean}}', 'number', 'true or false'),
    entry('randomString', '{{$randomString:16}}', 'sample', 'Alphanumeric string (default 8 chars)'),
    entry('randomLoremWords', '{{$randomLoremWords:5}}', 'sample', 'Lorem ipsum words'),
    entry('randomEmail', '{{$randomEmail}}', 'sample', 'Email address'),
    entry('randomName', '{{$randomName}}', 'sample', 'Full name'),
    entry('randomPhoneNumber', '{{$randomPhoneNumber}}', 'sample', 'Phone number'),
    entry('randomIPv4', '{{$randomIPv4}}', 'sample', 'IPv4 address'),
    entry('randomUrl', '{{$randomUrl}}', 'sample', 'https URL')
]);

/** @type {Readonly<Record<DynamicVariableGroup, {label: string, labelKey: string}>>} */
export const DYNAMIC_VARIABLE_GROUPS = Object.freeze({
    time: Object.freeze({ label: 'Time & dates', labelKey: 'variables.dynamic_groups.time' }),
    number: Object.freeze({ label: 'Numbers & IDs', labelKey: 'variables.dynamic_groups.number' }),
    sample: Object.freeze({ label: 'Sample data', labelKey: 'variables.dynamic_groups.sample' })
});

const BY_NAME = new Map(DYNAMIC_VARIABLES.map((info) => [info.name, info]));

/**
 * @param {string} name
 * @returns {DynamicVariableInfo|null}
 */
export function getDynamicVariable(name) {
    return BY_NAME.get(name) ?? null;
}
