import { requestTabButtons, requestTabContents, responseTabButtons } from './domElements.js';

export function initTabListeners() {
    requestTabButtons.forEach(button => {
        button.addEventListener('click', () => {
            requestTabButtons.forEach(btn => btn.classList.remove('active'));
            requestTabContents.forEach(content => content.classList.remove('active'));
            button.classList.add('active');
            const targetTabId = button.dataset.tab;
            const targetTabContent = document.getElementById(targetTabId);
            if (targetTabContent) {
                targetTabContent.classList.add('active');
            }
        });
    });

    responseTabButtons.forEach(button => {
        button.addEventListener('click', () => {
            responseTabButtons.forEach(btn => btn.classList.remove('active'));
            // Select all response content tabs specifically
            document.querySelectorAll('.response-content-wrapper .tab-content').forEach(content => {
                content.classList.remove('active');
            });
            button.classList.add('active');
            const targetTabId = button.dataset.tab;
            const targetTabContent = document.getElementById(targetTabId);
            if (targetTabContent) {
                targetTabContent.classList.add('active');
            }
        });
    });
}

export function activateTab(tabType, tabId) {
    let buttons;
    let contents;
    if (tabType === 'request') {
        buttons = requestTabButtons;
        contents = requestTabContents;
    } else if (tabType === 'response') {
        buttons = responseTabButtons;
        contents = document.querySelectorAll('.response-content-wrapper .tab-content');
    } else {
        console.warn('Unknown tab type:', tabType);
        return;
    }

    buttons.forEach(btn => btn.classList.remove('active'));
    contents.forEach(content => content.classList.remove('active'));

    const targetButton = document.querySelector(`.${tabType}-tabs .tab-button[data-tab="${tabId}"]`);
    const targetContent = document.getElementById(tabId);

    if (targetButton) {
        targetButton.classList.add('active');
    }
    if (targetContent) {
        targetContent.classList.add('active');
    }
}