import { textToBase64 } from '../../src/modules/utils/encoding.js';

describe('textToBase64', () => {
    test('matches btoa for ASCII input', () => {
        expect(textToBase64('user:pass')).toBe(btoa('user:pass'));
    });

    test('encodes non-Latin-1 text as UTF-8 without throwing', () => {
        const text = 'ada:pä密码🔑';

        const encoded = textToBase64(text);

        const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        expect(new TextDecoder().decode(bytes)).toBe(text);
    });

    test('handles input larger than one chunk', () => {
        const text = 'ü'.repeat(0x9000);

        const bytes = Uint8Array.from(atob(textToBase64(text)), (c) => c.charCodeAt(0));

        expect(new TextDecoder().decode(bytes)).toBe(text);
    });
});
