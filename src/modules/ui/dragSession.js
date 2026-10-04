/**
 * @fileoverview Mouse-drag lifecycle shared by the pane resizers
 * @module ui/dragSession
 */

/**
 * @param {Object} options
 * @param {HTMLElement} options.handle
 * @param {string} options.cursor
 * @param {(event: MouseEvent) => void} options.onMove
 * @param {() => void} [options.onEnd]
 * @param {string} [options.draggingClass='dragging']
 * @returns {void}
 */
export function startDragSession({ handle, cursor, onMove, onEnd, draggingClass = 'dragging' }) {
    handle.classList.add(draggingClass);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = cursor;

    const handleMove = (event) => onMove(event);
    const handleUp = () => {
        handle.classList.remove(draggingClass);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        onEnd?.();
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
}
