/**
 * Logger - Renderer process logging utility
 *
 * This module provides a simple, scoped logging interface for the renderer process.
 * It uses electron-log through the preload script's exposed API.
 *
 * Usage:
 *   import logger from './modules/logger.js';
 *   const log = logger.scope('MyModule');
 *   log.info('Something happened');
 *   log.error('An error occurred', { details: 'extra info' });
 */

/**
 * Create a scoped logger for a specific module/component
 * @param {string} scopeName - Scope name (e.g., 'WorkspaceTabManager', 'ApiHandler')
 * @returns {Object} Scoped logger with all log level methods
 */
function scope(scopeName) {
    const formatMeta = (meta) => {
        if (!meta || Object.keys(meta).length === 0) {
            return undefined;
        }
        return meta;
    };

    return {
        error: (message, meta) => window.electronAPI.logger.error(scopeName, message, formatMeta(meta)),
        warn: (message, meta) => window.electronAPI.logger.warn(scopeName, message, formatMeta(meta)),
        info: (message, meta) => window.electronAPI.logger.info(scopeName, message, formatMeta(meta)),
        debug: (message, meta) => window.electronAPI.logger.debug(scopeName, message, formatMeta(meta)),
        verbose: (message, meta) => window.electronAPI.logger.verbose(scopeName, message, formatMeta(meta))
    };
}

/**
 * Root logger (without scope)
 */
const rootLogger = {
    error: (message, meta) => window.electronAPI.logger.error('App', message, meta),
    warn: (message, meta) => window.electronAPI.logger.warn('App', message, meta),
    info: (message, meta) => window.electronAPI.logger.info('App', message, meta),
    debug: (message, meta) => window.electronAPI.logger.debug('App', message, meta),
    verbose: (message, meta) => window.electronAPI.logger.verbose('App', message, meta),
    scope
};

export default rootLogger;
export { scope };
