/**
 * @fileoverview Fills `[data-role]` slots of a cloned template with text
 * @module ui/roleText
 */

/**
 * @param {ParentNode} root
 * @param {Object<string, string>} texts
 * @returns {void}
 */
export function setRoleTexts(root, texts) {
    for (const [role, text] of Object.entries(texts)) {
        const target = root.querySelector(`[data-role="${role}"]`);
        if (target) {
            target.textContent = text;
        }
    }
}
