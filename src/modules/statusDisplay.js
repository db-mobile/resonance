/**
 * @fileoverview Status display utilities for showing request status and response metrics
 * @module modules/statusDisplay
 */

import { statusDisplay, responseTimeDisplay, responseSizeDisplay } from './domElements.js';
import { statusCategory } from './utils/statusCategory.js';

/**
 * @param {string} statusText
 * @param {number|null} [statusCode=null]
 * @returns {void}
 */
export function updateStatusDisplay(statusText, statusCode = null) {
    statusDisplay.classList.remove('status-success', 'status-redirect', 'status-client-error', 'status-server-error', 'status-info');

    statusDisplay.textContent = statusText;

    statusDisplay.classList.add(`status-${statusCategory(statusCode)}`);
}

/**
 * @param {number|null} timeInMs
 * @returns {void}
 */
export function updateResponseTime(timeInMs) {
    if (timeInMs !== null && timeInMs !== undefined) {
        responseTimeDisplay.textContent = `TTFB: ${timeInMs}ms`;
        responseTimeDisplay.style.display = 'block';
    } else {
        responseTimeDisplay.textContent = '';
        responseTimeDisplay.style.display = 'none';
    }
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
    if (bytes === 0) {return '0 B';}
    if (!bytes) {return '';}

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))  } ${  sizes[i]}`;
}

/**
 * @param {number|null} sizeInBytes
 * @returns {void}
 */
export function updateResponseSize(sizeInBytes) {
    if (sizeInBytes !== null && sizeInBytes !== undefined) {
        responseSizeDisplay.textContent = `Size: ${formatBytes(sizeInBytes)}`;
        responseSizeDisplay.style.display = 'block';
    } else {
        responseSizeDisplay.textContent = '';
        responseSizeDisplay.style.display = 'none';
    }
}
