
/**
 * @param {string} scopeName
 * @returns {Object}
 */
function scope(scopeName) {
    const formatMeta = (meta) => {
        if (!meta || Object.keys(meta).length === 0) {
            return undefined;
        }
        return meta;
    };

    return {
        error: (message, meta) => window.backendAPI.logger.error(scopeName, message, formatMeta(meta)),
        warn: (message, meta) => window.backendAPI.logger.warn(scopeName, message, formatMeta(meta)),
        info: (message, meta) => window.backendAPI.logger.info(scopeName, message, formatMeta(meta)),
        debug: (message, meta) => window.backendAPI.logger.debug(scopeName, message, formatMeta(meta)),
        verbose: (message, meta) => window.backendAPI.logger.verbose(scopeName, message, formatMeta(meta))
    };
}

const rootLogger = {
    error: (message, meta) => window.backendAPI.logger.error('App', message, meta),
    warn: (message, meta) => window.backendAPI.logger.warn('App', message, meta),
    info: (message, meta) => window.backendAPI.logger.info('App', message, meta),
    debug: (message, meta) => window.backendAPI.logger.debug('App', message, meta),
    verbose: (message, meta) => window.backendAPI.logger.verbose('App', message, meta),
    scope
};

export default rootLogger;
