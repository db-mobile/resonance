/**
 * @fileoverview Application context — the single, explicit home for app-wide singletons that
 * previously lived on `window`. Populated during startup (`renderer.js` and the
 * `FeatureRegistry`) and read by modules via `import { app } from '.../appContext.js'`.
 * @module appContext
 *
 * This is a deliberate service-locator, not dependency injection: it removes the global
 * `window` namespace and makes the dependency importable and mockable, but lookups remain by
 * name. Prefer constructor injection for new code where practical.
 *
 * Truthiness guards behave exactly as the old `window.*` ones did — `app.X` is `undefined`
 * until assigned, so `if (app.X)` matches the previous `if (window.X)` semantics and timing.
 *
 * Intentionally NOT here: `window.backendAPI` (the Tauri IPC platform boundary) and
 * `window.currentEndpoint` (shared mutable app state, which needs a state store, not a locator).
 *
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
 * @property {Function} [setUrlUpdating]
 * @property {Function} [setGrpcMetadata]
 * @property {Function} [setGrpcTls]
 * @property {Function} [invalidateApiHandlerSettingsCache]
 * @property {Function} [invalidateApiHandlerEnvironmentCache]
 * @property {Function} [getApiHandlerSettingsCache]
 */

/** @type {AppContext} */
export const app = {};
