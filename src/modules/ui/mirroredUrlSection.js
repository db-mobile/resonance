import { app } from '../appContext.js';

export const URL_UPDATED_EVENT = 'url-updated';

/** @param {HTMLInputElement|null} peerInput */
export function notifyUrlUpdated(peerInput) {
    peerInput?.dispatchEvent(new CustomEvent(URL_UPDATED_EVENT));
}

function markTabModified() {
    if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
        app.workspaceTabController.markCurrentTabModified();
    }
}

/**
 * @param {object} config
 * @param {string} config.sectionId
 * @param {string} config.method
 * @param {string} config.label
 * @param {string} config.inputId
 * @param {string} config.inputType
 * @param {string} config.placeholder
 * @param {string} config.ariaLabel
 * @param {string} config.peerId
 * @param {boolean} [config.syncQueryParams]
 * @returns {HTMLElement|null}
 */
export function createMirroredUrlSection({
    sectionId,
    method,
    label,
    inputId,
    inputType,
    placeholder,
    ariaLabel,
    peerId,
    syncQueryParams = false
}) {
    const requestUrlSection = document.querySelector('.request-url-section');
    if (!requestUrlSection) {
        return null;
    }

    const section = document.createElement('div');
    section.id = sectionId;
    section.className = 'grpc-url-section';
    section.style.display = 'none';

    const badge = document.createElement('span');
    badge.className = 'method-pill';
    badge.dataset.method = method;
    badge.textContent = label;

    const targetWrapper = document.createElement('div');
    targetWrapper.className = 'grpc-target-wrapper';

    const mirrorInput = document.createElement('input');
    mirrorInput.type = inputType;
    mirrorInput.id = inputId;
    mirrorInput.className = 'input-base url-input';
    mirrorInput.placeholder = placeholder;
    mirrorInput.setAttribute('aria-label', ariaLabel);

    const peerInput = document.getElementById(peerId);
    if (peerInput) {
        mirrorInput.value = peerInput.value;

        mirrorInput.addEventListener('input', () => {
            peerInput.value = mirrorInput.value;
            if (syncQueryParams) {
                peerInput.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
            markTabModified();
        });

        const copyFromPeer = () => {
            if (mirrorInput.value !== peerInput.value) {
                mirrorInput.value = peerInput.value;
            }
        };
        peerInput.addEventListener('input', copyFromPeer);
        peerInput.addEventListener(URL_UPDATED_EVENT, copyFromPeer);
    }

    targetWrapper.appendChild(mirrorInput);
    section.appendChild(badge);
    section.appendChild(targetWrapper);

    const methodSelectContainer = document.querySelector('.method-select-container');
    if (methodSelectContainer) {
        methodSelectContainer.after(section);
    } else {
        requestUrlSection.prepend(section);
    }

    return section;
}

/**
 * @param {string} inputId
 * @param {string} peerId
 */
export function syncMirroredUrlInput(inputId, peerId) {
    const peerInput = document.getElementById(peerId);
    const mirrorInput = document.getElementById(inputId);

    if (peerInput && mirrorInput) {
        mirrorInput.value = peerInput.value;
    }
}
