/**
 * @fileoverview Request tag normalization and include/exclude matching, mirroring the Rust core's tags module
 * @module utils/requestTags
 */

/**
 * @param {Array<string>|null|undefined} list
 * @returns {Array<string>}
 */
export function normalizeTags(list) {
    const seen = new Set();
    const tags = [];
    for (const raw of Array.isArray(list) ? list : []) {
        const tag = String(raw ?? '').trim();
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) {
            continue;
        }
        seen.add(key);
        tags.push(tag);
    }
    return tags;
}

/**
 * @param {string|null|undefined} text
 * @returns {Array<string>}
 */
export function parseTagInput(text) {
    return normalizeTags(String(text ?? '').split(','));
}

/**
 * @param {Array<string>|null|undefined} tags
 * @returns {string}
 */
export function formatTagInput(tags) {
    return normalizeTags(tags).join(', ');
}

/**
 * @param {{include?: Array<string>, exclude?: Array<string>}|null|undefined} filter
 * @returns {boolean}
 */
export function isEmptyTagFilter(filter) {
    return normalizeTags(filter?.include).length === 0 && normalizeTags(filter?.exclude).length === 0;
}

/**
 * @param {Array<string>} wanted
 * @param {Array<string>} tags
 * @returns {boolean}
 */
function anyMatch(wanted, tags) {
    const have = new Set(tags.map(tag => tag.toLowerCase()));
    return wanted.some(tag => have.has(tag.toLowerCase()));
}

/**
 * @param {Array<string>|null|undefined} tags
 * @param {{include?: Array<string>, exclude?: Array<string>}|null|undefined} filter
 * @returns {boolean}
 */
export function matchesTagFilter(tags, filter) {
    const have = normalizeTags(tags);
    const include = normalizeTags(filter?.include);
    const exclude = normalizeTags(filter?.exclude);
    if (anyMatch(exclude, have)) {
        return false;
    }
    return include.length === 0 || anyMatch(include, have);
}
