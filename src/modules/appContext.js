/**
 * @fileoverview Application context — the single, explicit home for app-wide singletons that
 * @module appContext
 * @typedef {Object} AppContext
 * @property {*} [cookieController]
 * @property {*} [certificateController]
 * @property {*} [environmentController]
 * @property {*} [scriptController]
 * @property {*} [inlineScriptManager]
 * @property {*} [schemaController]
 * @property {*} [historyController]
 * @property {*} [workspaceTabController]
 * @property {*} [responseContainerManager]
 * @property {*} [collectionController]
 * @property {*} [collectionService]
 * @property {*} [secretStore]
 * @property {*} [graphqlBodyManager]
 * @property {*} [formBodyManager]
 * @property {*} [requestBodyEditor]
 * @property {*} [requestBodyTextEditor]
 * @property {*} [grpcBodyEditor]
 * @property {*} [statusBar]
 * @property {*} [authManager]
 * @property {*} [i18n]
 * @property {Function} [captureGrpcState]
 * @property {Function} [applyGrpcState]
 * @property {Function} [invalidateApiHandlerSettingsCache]
 * @property {Function} [invalidateApiHandlerEnvironmentCache]
 * @property {Function} [getApiHandlerSettingsCache]
 */

/** @type {AppContext} */
export const app = {};
