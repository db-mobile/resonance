/**
 * LoggerService - Production-tier logging for Resonance
 *
 * Features:
 * - File logging with automatic rotation
 * - Console logging in development
 * - Proper log levels (error, warn, info, debug)
 * - Structured logging with context
 * - Works in both main and renderer processes
 */

import log from 'electron-log';
import path from 'path';

class LoggerService {
    constructor() {
        this.isInitialized = false;
    }

    /**
     * Initialize the logger with production-ready configuration
     * @param {Object} options - Configuration options
     * @param {string} options.appName - Application name for log context
     * @param {boolean} options.isDevelopment - Whether in development mode
     * @param {string} options.logPath - Custom log file path (optional)
     */
    initialize(options = {}) {
        if (this.isInitialized) {
            return;
        }

        const {
            appName = 'Resonance',
            isDevelopment = false,
            logPath = null
        } = options;

        // Configure log levels
        // In production: file logs everything, console only errors/warnings
        // In development: both file and console log everything
        if (isDevelopment) {
            log.transports.console.level = 'debug';
            log.transports.file.level = 'debug';
        } else {
            log.transports.console.level = 'warn';
            log.transports.file.level = 'info';
        }

        // Configure file transport
        log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
        log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

        // Set custom log path if provided
        if (logPath) {
            log.transports.file.resolvePathFn = () => path.join(logPath, 'resonance.log');
        }

        // Configure console transport
        log.transports.console.format = isDevelopment
            ? '[{h}:{i}:{s}] [{level}] {text}'
            : '{text}';

        // Add app name to all logs
        log.variables.appName = appName;

        this.isInitialized = true;
        this.info('LoggerService initialized', { isDevelopment, logPath: log.transports.file.getFile().path });
    }

    /**
     * Create a scoped logger for a specific module/component
     * @param {string} scope - Scope name (e.g., 'WorkspaceTabManager', 'ApiHandler')
     * @returns {Object} Scoped logger with all log level methods
     */
    scope(scope) {
        return {
            error: (message, ...args) => this.error(message, { scope, ...this._extractMeta(args) }),
            warn: (message, ...args) => this.warn(message, { scope, ...this._extractMeta(args) }),
            info: (message, ...args) => this.info(message, { scope, ...this._extractMeta(args) }),
            debug: (message, ...args) => this.debug(message, { scope, ...this._extractMeta(args) }),
            verbose: (message, ...args) => this.verbose(message, { scope, ...this._extractMeta(args) })
        };
    }

    /**
     * Log an error message
     * @param {string} message - Error message
     * @param {Object} meta - Additional metadata
     */
    error(message, meta = {}) {
        log.error(this._formatMessage(message, meta));
    }

    /**
     * Log a warning message
     * @param {string} message - Warning message
     * @param {Object} meta - Additional metadata
     */
    warn(message, meta = {}) {
        log.warn(this._formatMessage(message, meta));
    }

    /**
     * Log an info message
     * @param {string} message - Info message
     * @param {Object} meta - Additional metadata
     */
    info(message, meta = {}) {
        log.info(this._formatMessage(message, meta));
    }

    /**
     * Log a debug message
     * @param {string} message - Debug message
     * @param {Object} meta - Additional metadata
     */
    debug(message, meta = {}) {
        log.debug(this._formatMessage(message, meta));
    }

    /**
     * Log a verbose message (most detailed)
     * @param {string} message - Verbose message
     * @param {Object} meta - Additional metadata
     */
    verbose(message, meta = {}) {
        log.verbose(this._formatMessage(message, meta));
    }

    /**
     * Get the log file path
     * @returns {string} Path to the log file
     */
    getLogPath() {
        return log.transports.file.getFile().path;
    }

    /**
     * Format message with metadata
     * @private
     */
    _formatMessage(message, meta = {}) {
        if (Object.keys(meta).length === 0) {
            return message;
        }

        const { scope, ...rest } = meta;
        const scopePrefix = scope ? `[${scope}] ` : '';
        const metaString = Object.keys(rest).length > 0
            ? ` ${JSON.stringify(rest)}`
            : '';

        return `${scopePrefix}${message}${metaString}`;
    }

    /**
     * Extract metadata from variadic arguments
     * @private
     */
    _extractMeta(args) {
        if (args.length === 0) {
            return {};
        }
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
            return args[0];
        }
        return { data: args };
    }
}

// Create singleton instance
const loggerService = new LoggerService();

export default loggerService;
export { loggerService };
