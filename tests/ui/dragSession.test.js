/* global document, MouseEvent */
import { startDragSession } from '../../src/modules/ui/dragSession.js';

describe('startDragSession', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    });

    test('marks the handle and body while dragging and restores them on mouseup', () => {
        const handle = document.createElement('div');
        document.body.appendChild(handle);
        const onMove = jest.fn();
        const onEnd = jest.fn();

        startDragSession({ handle, cursor: 'col-resize', onMove, onEnd });

        expect(handle.classList.contains('dragging')).toBe(true);
        expect(document.body.style.userSelect).toBe('none');
        expect(document.body.style.cursor).toBe('col-resize');

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40 }));
        expect(onMove).toHaveBeenCalledTimes(1);
        expect(onMove.mock.calls[0][0].clientX).toBe(40);

        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(onEnd).toHaveBeenCalledTimes(1);
        expect(handle.classList.contains('dragging')).toBe(false);
        expect(document.body.style.userSelect).toBe('');
        expect(document.body.style.cursor).toBe('');

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 80 }));
        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(onMove).toHaveBeenCalledTimes(1);
        expect(onEnd).toHaveBeenCalledTimes(1);
    });

    test('uses a custom dragging class and tolerates a missing onEnd', () => {
        const handle = document.createElement('div');
        startDragSession({ handle, cursor: 'row-resize', draggingClass: 'is-dragging', onMove: () => {} });

        expect(handle.classList.contains('is-dragging')).toBe(true);
        expect(() => document.dispatchEvent(new MouseEvent('mouseup'))).not.toThrow();
        expect(handle.classList.contains('is-dragging')).toBe(false);
    });
});
