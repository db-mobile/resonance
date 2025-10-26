export function initTabListeners() {
    const requestTabButtons = document.querySelectorAll('.request-config .tab-button');
    const requestTabContents = document.querySelectorAll('.request-config .tab-content');

    requestTabButtons.forEach(button => {
        button.addEventListener('click', () => {
            requestTabButtons.forEach(btn => {
                btn.classList.remove('active');
                btn.setAttribute('aria-selected', 'false');
            });
            requestTabContents.forEach(content => content.classList.remove('active'));
            
            button.classList.add('active');
            button.setAttribute('aria-selected', 'true');
            
            const targetTabId = button.dataset.tab;
            const targetTabContent = document.getElementById(targetTabId);
            if (targetTabContent) {
                targetTabContent.classList.add('active');
            }
        });
    });

    const responseTabButtons = document.querySelectorAll('.response-tabs .tab-button');
    const responseTabContents = document.querySelectorAll('.response-display .tab-content');

    responseTabButtons.forEach(button => {
        button.addEventListener('click', () => {
            responseTabButtons.forEach(btn => {
                btn.classList.remove('active');
                btn.setAttribute('aria-selected', 'false');
            });
            responseTabContents.forEach(content => content.classList.remove('active'));
            
            button.classList.add('active');
            button.setAttribute('aria-selected', 'true');
            
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
        buttons = document.querySelectorAll('.request-config .tab-button');
        contents = document.querySelectorAll('.request-config .tab-content');
    } else if (tabType === 'response') {
        buttons = document.querySelectorAll('.response-tabs .tab-button');
        contents = document.querySelectorAll('.response-display .tab-content');
    } else {
        console.warn('Unknown tab type:', tabType);
        return;
    }

    buttons.forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
    });
    contents.forEach(content => content.classList.remove('active'));

    const targetButton = document.querySelector(`.${tabType === 'request' ? 'request-config' : 'response-tabs'} .tab-button[data-tab="${tabId}"]`);
    const targetContent = document.getElementById(tabId);

    if (targetButton) {
        targetButton.classList.add('active');
        targetButton.setAttribute('aria-selected', 'true');
    }
    if (targetContent) {
        targetContent.classList.add('active');
    }
}