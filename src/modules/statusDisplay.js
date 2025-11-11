/**
 * @fileoverview Status display utilities for showing request status and response metrics
 * @module modules/statusDisplay
 */

import { statusDisplay, responseTimeDisplay, responseSizeDisplay } from './domElements.js';

/**
 * Updates the status display with request status and applies appropriate styling
 *
 * @param {string} statusText - Status text to display
 * @param {number|null} [statusCode=null] - HTTP status code for styling
 * @returns {void}
 *
 * @example
 * updateStatusDisplay('Status: 200 OK', 200);
 * updateStatusDisplay('Request Failed', 404);
 */
export function updateStatusDisplay(statusText, statusCode = null) {
    statusDisplay.classList.remove('status-success', 'status-redirect', 'status-client-error', 'status-server-error', 'status-info');

    statusDisplay.textContent = statusText;

    if (statusCode) {
        if (statusCode >= 200 && statusCode < 300) {
            statusDisplay.classList.add('status-success');
        } else if (statusCode >= 300 && statusCode < 400) {
            statusDisplay.classList.add('status-redirect');
        } else if (statusCode >= 400 && statusCode < 500) {
            statusDisplay.classList.add('status-client-error');
        } else if (statusCode >= 500 && statusCode < 600) {
            statusDisplay.classList.add('status-server-error');
        } else {
            statusDisplay.classList.add('status-info');
        }
    } else {
        statusDisplay.classList.add('status-info');
    }
}

/**
 * Updates the response time display with TTFB (Time To First Byte)
 *
 * @param {number|null} timeInMs - Response time in milliseconds
 * @returns {void}
 *
 * @example
 * updateResponseTime(245); // Displays "TTFB: 245ms"
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
 * Formats bytes to human-readable string
 *
 * @private
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string (e.g., "1.5 KB", "2.3 MB")
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
 * Updates the response size display
 *
 * @param {number|null} sizeInBytes - Response size in bytes
 * @returns {void}
 *
 * @example
 * updateResponseSize(1536); // Displays "Size: 1.5 KB"
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
