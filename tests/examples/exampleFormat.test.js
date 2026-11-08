import { exampleBodyBytes, formatBytes, exampleMeta } from '../../src/modules/examples/exampleFormat.js';

describe('exampleFormat', () => {
    test('counts bytes for text and decoded base64 bodies', () => {
        expect(exampleBodyBytes({ body: 'héllo' })).toBe(6);
        expect(exampleBodyBytes({ body: 'AAAA', bodyEncoding: 'base64' })).toBe(3);
        expect(exampleBodyBytes({ body: 'AA==', bodyEncoding: 'base64' })).toBe(1);
        expect(exampleBodyBytes({})).toBe(0);
    });

    test('formats sizes', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2.0 KB');
        expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    });

    test('builds the meta line from content type, size and date', () => {
        expect(exampleMeta({ body: 'ab', contentType: 'text/plain; charset=utf-8' })).toBe('text/plain · 2 B');
        expect(exampleMeta({ body: '', savedAt: 'not a date' })).toBe('0 B');
        expect(exampleMeta({ body: '', savedAt: '2026-11-08T10:15:00.000Z' })).toMatch(/^0 B · .+/);
    });
});
