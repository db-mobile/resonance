/**
 * @fileoverview Marks the active workspace tab modified unless a tab state restore is running
 * @module state/tabModified
 */

import { app } from '../appContext.js';

/** @returns {void} */
export function markTabModified() {
    if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
        app.workspaceTabController.markCurrentTabModified();
    }
}
