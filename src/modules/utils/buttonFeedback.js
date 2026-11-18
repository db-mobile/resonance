/**
 * @fileoverview Timed title/class feedback on a button.
 * @module utils/buttonFeedback
 */

const FEEDBACK_MS = 2000;

/** @type {WeakMap<HTMLElement, {timer: ReturnType<typeof setTimeout>, restore: () => void}>} */
const pending = new WeakMap();

/**
 * @param {HTMLElement} button
 * @param {{title: string, stateClass: string, icon?: {from: string, to: string}}} feedback
 * @returns {void}
 */
export function flashButtonFeedback(button, { title, stateClass, icon }) {
    const previous = pending.get(button);
    if (previous) {
        clearTimeout(previous.timer);
        previous.restore();
    }

    const originalTitle = button.title;
    const iconEl = icon ? button.querySelector('.icon') : null;

    button.title = title;
    button.classList.add(stateClass);
    iconEl?.classList.replace(icon.from, icon.to);

    const restore = () => {
        button.title = originalTitle;
        button.classList.remove(stateClass);
        iconEl?.classList.replace(icon.to, icon.from);
        pending.delete(button);
    };

    pending.set(button, { restore, timer: setTimeout(restore, FEEDBACK_MS) });
}
