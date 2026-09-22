/**
 * @fileoverview Collection-runner data files: CSV (RFC 4180, header row) or a JSON array of objects, one row per iteration
 * @module utils/dataFile
 */

import { translate } from './translate.js';

/**
 * @param {string} text
 * @returns {{records: string[][], lines: number[]}}
 */
function readCsvRecords(text) {
    const records = [];
    const lines = [];
    let field = '';
    let record = [];
    let inQuotes = false;
    let line = 1;
    let recordLine = 1;

    const endRecord = () => {
        record.push(field);
        field = '';
        if (!(record.length === 1 && record[0] === '')) {
            records.push(record);
            lines.push(recordLine);
        }
        record = [];
    };

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                if (char === '\n') {
                    line++;
                }
                field += char;
            }
            continue;
        }

        if (char === '"' && field === '') {
            inQuotes = true;
        } else if (char === ',') {
            record.push(field);
            field = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[i + 1] === '\n') {
                i++;
            }
            endRecord();
            line++;
            recordLine = line;
        } else {
            field += char;
        }
    }

    if (inQuotes) {
        throw new Error(translate('runner.data_unclosed_quote', 'Line {{line}}: a quoted value is never closed', {
            line: recordLine
        }));
    }
    if (field !== '' || record.length > 0) {
        endRecord();
    }

    return { records, lines };
}

/**
 * @param {string} text
 * @returns {Array<Object<string, string>>}
 */
export function parseCsv(text) {
    const { records, lines } = readCsvRecords(text.replace(/^\uFEFF/, ''));
    if (records.length === 0) {
        return [];
    }

    const headers = records[0].map(header => header.trim());
    if (headers.some(header => header === '')) {
        throw new Error(translate('runner.data_empty_header', 'Line 1: every column needs a name'));
    }

    return records.slice(1).map((record, index) => {
        if (record.length > headers.length) {
            throw new Error(translate('runner.data_too_many_values', 'Line {{line}}: more values than columns', {
                line: lines[index + 1]
            }));
        }
        return Object.fromEntries(headers.map((header, column) => [header, record[column] ?? '']));
    });
}

/**
 * @param {*} value
 * @returns {string}
 */
function toVariableValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * @param {string} text
 * @returns {Array<Object<string, string>>}
 */
export function parseJsonRows(text) {
    let data;
    try {
        data = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (error) {
        throw new Error(translate('runner.data_invalid_json', 'Invalid JSON: {{message}}', { message: error.message }), {
            cause: error
        });
    }

    if (!Array.isArray(data) || data.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
        throw new Error(translate('runner.data_not_rows', 'A JSON data file must be an array of objects'));
    }

    return data.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toVariableValue(value)])));
}

/**
 * @param {string} name
 * @param {string} text
 * @returns {Array<Object<string, string>>}
 */
export function parseDataFile(name, text) {
    return /\.json$/i.test(name) ? parseJsonRows(text) : parseCsv(text);
}
