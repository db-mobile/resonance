/**
 * @fileoverview Manages script sub-tab navigation (Pre-request, Test, API Reference)
 * @module scriptSubTabs
 */

/**
 * Initialize script sub-tab switching functionality
 */
export function initializeScriptSubTabs() {
    const subTabButtons = document.querySelectorAll('.script-sub-tab');
    const tabPanels = document.querySelectorAll('.script-tab-panel');

    subTabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-script-tab');

            // Remove active class from all buttons
            subTabButtons.forEach(btn => {
                btn.classList.remove('active');
                btn.setAttribute('aria-selected', 'false');
            });

            // Remove active class from all panels
            tabPanels.forEach(panel => {
                panel.classList.remove('active');
            });

            // Add active class to clicked button
            button.classList.add('active');
            button.setAttribute('aria-selected', 'true');

            // Show corresponding panel
            const targetPanel = document.getElementById(`script-${targetTab}`);
            if (targetPanel) {
                targetPanel.classList.add('active');
            }
        });
    });
}
