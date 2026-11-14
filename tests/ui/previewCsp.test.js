import { PreviewRenderer } from '../../src/modules/ui/PreviewRenderer.js';

const META = '<meta http-equiv="Content-Security-Policy" content="img-src \'none\';">';
const inject = (content) => PreviewRenderer.prototype._injectCSP.call(null, content, META);

describe('PreviewRenderer CSP injection', () => {
    test('a page with <header> but no <head> gets a real <head> for the policy', () => {
        const out = inject('<html><body><header>x</header><img src="https://t.test/p.gif"></body></html>');

        expect(out).toContain(`<html>\n<head>${META}</head>`);
        expect(out).not.toContain(`<header>\n${META}`);
    });

    test('a <header> before <head> does not capture the policy', () => {
        const out = inject('<header>early</header><html><head><title>t</title></head><body></body></html>');

        expect(out).toContain(`<head>\n${META}`);
        expect(out.indexOf(META)).toBeGreaterThan(out.indexOf('<head>'));
    });

    test('dollar patterns in the matched tag are kept verbatim', () => {
        const out = inject('<html><head data-x="$&$`$\'"><title>t</title></head></html>');

        expect(out).toContain(`<head data-x="$&$\`$'">\n${META}`);
    });

    test('a fragment without html or head is wrapped', () => {
        expect(inject('<p>hi</p>')).toBe(`<!DOCTYPE html><html><head>${META}</head><body><p>hi</p></body></html>`);
    });
});
