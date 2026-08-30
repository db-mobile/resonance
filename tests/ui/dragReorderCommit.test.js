/* global document, DOMParser */
import fs from 'fs';
import path from 'path';
import { RequestQueue } from '../../src/modules/ui/runner/RequestQueue.js';
import { WorkspaceTabBar } from '../../src/modules/ui/WorkspaceTabBar.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const RUNNER_TEMPLATE = './src/templates/runner/runnerPanel.html';

const dragend = (element) => element.dispatchEvent(new Event('dragend', { bubbles: true }));

describe('drag reorder commits on dragend', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    describe('RequestQueue', () => {
        let queue;
        let onChange;
        let container;

        beforeEach(() => {
            const html = fs.readFileSync(
                path.join(process.cwd(), 'src/templates/runner/runnerPanel.html'),
                'utf8'
            );
            templateLoader.cache.set(RUNNER_TEMPLATE, new DOMParser().parseFromString(html, 'text/html'));

            onChange = jest.fn();
            queue = new RequestQueue({ onChange });
            container = document.createElement('div');
            document.body.appendChild(container);
            queue.mount(container);
            queue.setRequests([
                { name: 'first', method: 'GET', path: '/a' },
                { name: 'second', method: 'GET', path: '/b' },
                { name: 'third', method: 'GET', path: '/c' }
            ]);
        });

        test('a drag released outside a row still commits the DOM order', () => {
            const items = container.querySelectorAll('.runner-request-item');
            container.insertBefore(items[2], items[0]);

            dragend(items[2]);

            expect(queue.getRequests().map(r => r.name)).toEqual(['third', 'first', 'second']);
            expect(onChange).toHaveBeenCalledTimes(1);
        });

        test('dragend with an unchanged order emits no change', () => {
            const items = container.querySelectorAll('.runner-request-item');

            dragend(items[0]);

            expect(queue.getRequests().map(r => r.name)).toEqual(['first', 'second', 'third']);
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    describe('WorkspaceTabBar', () => {
        let tabBar;
        let onTabReorder;

        beforeEach(() => {
            global.ResizeObserver = class {
                observe() {}
                unobserve() {}
                disconnect() {}
            };
            document.body.innerHTML = '<div id="workspace-tab-bar-container"></div>';
            tabBar = new WorkspaceTabBar('workspace-tab-bar-container');
            onTabReorder = jest.fn();
            tabBar.onTabReorder = onTabReorder;
            tabBar.render([
                { id: 'tab-1', name: 'One' },
                { id: 'tab-2', name: 'Two' },
                { id: 'tab-3', name: 'Three' }
            ], 'tab-1');
        });

        test('a drag released outside a tab still commits the DOM order', () => {
            const container = document.querySelector('.workspace-tabs-container');
            const tabEls = container.querySelectorAll('.workspace-tab');
            container.insertBefore(tabEls[2], tabEls[0]);

            dragend(tabEls[2]);

            expect(onTabReorder).toHaveBeenCalledTimes(1);
            expect(onTabReorder).toHaveBeenCalledWith(['tab-3', 'tab-1', 'tab-2']);
            expect(tabBar.tabs.map(t => t.id)).toEqual(['tab-3', 'tab-1', 'tab-2']);
        });

        test('a second dragend with no further movement does not re-fire the callback', () => {
            const container = document.querySelector('.workspace-tabs-container');
            const tabEls = container.querySelectorAll('.workspace-tab');
            container.insertBefore(tabEls[1], tabEls[0]);

            dragend(tabEls[1]);
            dragend(tabEls[1]);

            expect(onTabReorder).toHaveBeenCalledTimes(1);
        });
    });
});
