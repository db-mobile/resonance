/* global document */
import { RunnerSelectorMenu, groupRunnersByCollection } from '../../src/modules/ui/runner/RunnerSelectorMenu.js';

describe('groupRunnersByCollection', () => {
    test('groups by collection, sorts known collections by name and unknown ids last', () => {
        const runners = [
            { id: 'r3', name: 'zulu', collectionId: 'c2', requests: [] },
            { id: 'r1', name: 'Beta', collectionId: 'c1', requests: [{}] },
            { id: 'r2', name: 'alpha', collectionId: 'c1', requests: [] },
            { id: 'r4', name: 'orphan', collectionId: 'gone', requests: [] }
        ];
        const collections = [{ id: 'c2', name: 'Apple' }, { id: 'c1', name: 'Banana' }];

        const groups = groupRunnersByCollection(runners, collections);

        expect(groups.map(g => [g.collectionId, g.name, g.runners.map(r => r.id)])).toEqual([
            ['c2', 'Apple', ['r3']],
            ['c1', 'Banana', ['r2', 'r1']],
            ['gone', 'gone', ['r4']]
        ]);
    });
});

describe('RunnerSelectorMenu', () => {
    function mount() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div data-role="runner-selector"><button data-action="toggle-dropdown"></button></div>
            <div data-role="runner-dropdown" class="is-hidden"><div data-role="runner-list"></div></div>`;
        const onSelect = jest.fn();
        const onLoadRunners = jest.fn(async () => groupRunnersByCollection(
            [{ id: 'r1', name: 'Smoke', collectionId: 'c1', requests: [{}, {}] }],
            [{ id: 'c1', name: 'Petstore' }]
        ));
        const menu = new RunnerSelectorMenu({ onLoadRunners, onSelect });
        menu.mount(container);
        return { menu, container, onSelect };
    }

    test('renders a heading per collection and reports both ids on select', async () => {
        const { menu, container, onSelect } = mount();

        await menu.open();

        expect(container.querySelector('.runner-dropdown-group-label').textContent).toBe('Petstore');
        const item = container.querySelector('.runner-dropdown-item');
        expect(item.textContent).toContain('2 requests');
        item.click();
        expect(onSelect).toHaveBeenCalledWith('r1', 'c1');
        expect(menu.currentRunnerId).toBe('r1');
        menu.destroy();
    });
});
