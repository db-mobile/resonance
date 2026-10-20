import { normalizeTags, parseTagInput, formatTagInput, isEmptyTagFilter, matchesTagFilter } from '../../src/modules/utils/requestTags.js';

describe('requestTags', () => {
    test('normalizeTags trims, drops empties and dedupes case-insensitively keeping the first spelling', () => {
        expect(normalizeTags([' smoke ', '', 'Smoke', 'pets', '  ', 'PETS', 'auth'])).toEqual(['smoke', 'pets', 'auth']);
        expect(normalizeTags(null)).toEqual([]);
        expect(normalizeTags('smoke')).toEqual([]);
    });

    test('parseTagInput splits on commas and formatTagInput joins them back', () => {
        expect(parseTagInput('smoke, Pets ,,auth,pets')).toEqual(['smoke', 'Pets', 'auth']);
        expect(parseTagInput(' , ')).toEqual([]);
        expect(formatTagInput(['smoke', 'Pets', 'SMOKE'])).toBe('smoke, Pets');
        expect(formatTagInput(undefined)).toBe('');
    });

    test('an empty filter passes everything', () => {
        expect(isEmptyTagFilter(null)).toBe(true);
        expect(isEmptyTagFilter({ include: [' '], exclude: [] })).toBe(true);
        expect(matchesTagFilter([], null)).toBe(true);
        expect(matchesTagFilter(['slow'], { include: [], exclude: [] })).toBe(true);
    });

    test('include matches any tag case-insensitively and exclude wins', () => {
        expect(matchesTagFilter(['pets', 'smoke'], { include: ['SMOKE', 'auth'] })).toBe(true);
        expect(matchesTagFilter(['pets'], { include: ['smoke'] })).toBe(false);
        expect(matchesTagFilter(undefined, { include: ['smoke'] })).toBe(false);
        expect(matchesTagFilter(['smoke', 'Slow'], { include: ['smoke'], exclude: ['slow'] })).toBe(false);
        expect(matchesTagFilter([], { exclude: ['slow'] })).toBe(true);
        expect(isEmptyTagFilter({ exclude: ['slow'] })).toBe(false);
    });
});
