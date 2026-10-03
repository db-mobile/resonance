import { effectiveLayout, splitSizes } from '../src/modules/resizer.js';

describe('effectiveLayout', () => {
    test('stacked preference always stays stacked', () => {
        expect(effectiveLayout('stacked', 4000, 7)).toBe('stacked');
    });

    test('side by side falls back to stacked when both panes cannot fit their minimum width', () => {
        expect(effectiveLayout('side-by-side', 726, 7)).toBe('stacked');
        expect(effectiveLayout('side-by-side', 727, 7)).toBe('side-by-side');
    });
});

describe('splitSizes', () => {
    test('splits the available space by ratio', () => {
        expect(splitSizes(1000, 0.4, 100)).toEqual({ request: 400, response: 600 });
    });

    test('clamps both panes to the minimum size', () => {
        expect(splitSizes(1000, 0.05, 100)).toEqual({ request: 100, response: 900 });
        expect(splitSizes(1000, 0.99, 100)).toEqual({ request: 900, response: 100 });
    });

    test('returns null when the space cannot hold two minimum-size panes', () => {
        expect(splitSizes(150, 0.5, 100)).toBeNull();
    });
});
