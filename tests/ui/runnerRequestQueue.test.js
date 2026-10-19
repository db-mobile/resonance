/* global document, DOMParser */
import fs from 'fs';
import path from 'path';
import { RequestQueue } from '../../src/modules/ui/runner/RequestQueue.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const RUNNER_TEMPLATE = './src/templates/runner/runnerPanel.html';

describe('RequestQueue.appendRequests', () => {
    let queue;
    let onChange;
    let container;

    beforeEach(() => {
        const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/runner/runnerPanel.html'), 'utf8');
        templateLoader.cache.set(RUNNER_TEMPLATE, new DOMParser().parseFromString(html, 'text/html'));
        onChange = jest.fn();
        queue = new RequestQueue({ onChange });
        container = document.createElement('div');
        queue.mount(container);
    });

    test('adds every entry in order with one render and one change event', () => {
        const collection = { id: 'c1' };
        queue.appendRequests([
            { collection, endpoint: { id: 'e1', name: 'List', method: 'GET', path: '/a' } },
            { collection, endpoint: { id: 'e2', method: 'POST', path: '/b' } }
        ]);

        expect(queue.getRequests()).toEqual([
            { collectionId: 'c1', endpointId: 'e1', name: 'List', method: 'GET', path: '/a', postResponseScript: '', overrides: {} },
            { collectionId: 'c1', endpointId: 'e2', name: '/b', method: 'POST', path: '/b', postResponseScript: '', overrides: {} }
        ]);
        expect(container.querySelectorAll('.runner-request-item')).toHaveLength(2);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    test('an empty batch changes nothing', () => {
        queue.appendRequests([]);

        expect(queue.count).toBe(0);
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('RequestQueue collection binding', () => {
    let queue;

    beforeEach(() => {
        const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/runner/runnerPanel.html'), 'utf8');
        templateLoader.cache.set(RUNNER_TEMPLATE, new DOMParser().parseFromString(html, 'text/html'));
        queue = new RequestQueue({});
        queue.mount(document.createElement('div'));
    });

    test('collectionId reflects the first queued request and clears with the queue', () => {
        expect(queue.collectionId).toBeNull();
        queue.addRequest({ id: 'c1' }, { id: 'e1', method: 'GET', path: '/a' });
        expect(queue.collectionId).toBe('c1');
        queue.reset();
        expect(queue.collectionId).toBeNull();
    });

    test('entries from another collection are ignored once bound', () => {
        queue.addRequest({ id: 'c1' }, { id: 'e1', method: 'GET', path: '/a' });
        queue.appendRequests([
            { collection: { id: 'c2' }, endpoint: { id: 'x', method: 'GET', path: '/x' } },
            { collection: { id: 'c1' }, endpoint: { id: 'e2', method: 'GET', path: '/b' } }
        ]);

        expect(queue.getRequests().map(r => r.endpointId)).toEqual(['e1', 'e2']);
    });
});
