import { translate, translateCount } from '../../src/modules/utils/translate.js';
import { app } from '../../src/modules/appContext.js';

describe('translate', () => {
    afterEach(() => {
        delete app.i18n;
    });

    test('uses the interpolated English fallback when i18n is not loaded', () => {
        expect(translate('runner.loaded', 'Loaded runner: {{name}}', { name: 'Smoke' })).toBe('Loaded runner: Smoke');
    });

    test('uses the fallback when the key is missing, instead of showing the key', () => {
        app.i18n = { t: (key) => key };

        expect(translate('runner.nope', 'Fallback')).toBe('Fallback');
    });

    test('prefers the translation when one exists', () => {
        app.i18n = { t: (key, params) => (key === 'runner.loaded' ? `Geladen: ${params.name}` : key) };

        expect(translate('runner.loaded', 'Loaded runner: {{name}}', { name: 'Smoke' })).toBe('Geladen: Smoke');
    });

    test('translateCount picks the singular or plural form', () => {
        const fallbacks = { one: '{{count}} request', other: '{{count}} requests' };

        expect(translateCount('runner.request_count', 1, fallbacks)).toBe('1 request');
        expect(translateCount('runner.request_count', 3, fallbacks)).toBe('3 requests');
    });
});
