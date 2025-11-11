/**
 * @fileoverview Centralized DOM element references for the application
 * @module modules/domElements
 */

/**
 * URL input field
 * @const {HTMLInputElement}
 */
export const urlInput = document.getElementById('url-input');
/**
 * HTTP method dropdown select
 * @const {HTMLSelectElement}
 */
export const methodSelect = document.getElementById('method-select');

/**
 * Request body textarea input
 * @const {HTMLTextAreaElement}
 */
export const bodyInput = document.getElementById('body-input');

/**
 * cURL export button
 * @const {HTMLButtonElement}
 */
export const curlBtn = document.getElementById('curl-btn');

/**
 * Send request button
 * @const {HTMLButtonElement}
 */
export const sendRequestBtn = document.getElementById('send-request-btn');

/**
 * Cancel request button
 * @const {HTMLButtonElement}
 */
export const cancelRequestBtn = document.getElementById('cancel-request-btn');

/**
 * Status display element
 * @const {HTMLElement}
 */
export const statusDisplay = document.getElementById('status-display');

/**
 * Response time display element
 * @const {HTMLElement}
 */
export const responseTimeDisplay = document.getElementById('response-time-display');

/**
 * Response size display element
 * @const {HTMLElement}
 */
export const responseSizeDisplay = document.getElementById('response-size-display');

/**
 * Path parameters list container
 * @const {HTMLElement}
 */
export const pathParamsList = document.getElementById('path-params-list');

/**
 * Add path parameter button
 * @const {HTMLButtonElement}
 */
export const addPathParamBtn = document.getElementById('add-path-param-btn');

/**
 * Headers list container
 * @const {HTMLElement}
 */
export const headersList = document.getElementById('headers-list');

/**
 * Add header button
 * @const {HTMLButtonElement}
 */
export const addHeaderBtn = document.getElementById('add-header-btn');

/**
 * Query parameters list container
 * @const {HTMLElement}
 */
export const queryParamsList = document.getElementById('query-params-list');

/**
 * Add query parameter button
 * @const {HTMLButtonElement}
 */
export const addQueryParamBtn = document.getElementById('add-query-param-btn');

/**
 * Response body container element
 * @const {HTMLElement}
 */
export const responseBodyContainer = document.getElementById('response-body-container');

/**
 * Response headers display element
 * @const {HTMLElement}
 */
export const responseHeadersDisplay = document.getElementById('response-headers-display');

/**
 * Response cookies display element
 * @const {HTMLElement}
 */
export const responseCookiesDisplay = document.getElementById('response-cookies-display');

/**
 * Response performance metrics display element
 * @const {HTMLElement}
 */
export const responsePerformanceDisplay = document.getElementById('response-performance-display');

/**
 * Copy response button
 * @const {HTMLButtonElement}
 */
export const copyResponseBtn = document.getElementById('copy-response-btn');

/**
 * Language selector for syntax highlighting
 * @const {HTMLSelectElement}
 */
export const languageSelector = document.getElementById('language-selector');

/**
 * Request tab buttons
 * @const {NodeList}
 */
export const requestTabButtons = document.querySelectorAll('.request-config .tab-button');

/**
 * Request tab contents
 * @const {NodeList}
 */
export const requestTabContents = document.querySelectorAll('.request-config .tab-content');

/**
 * Response tab buttons
 * @const {NodeList}
 */
export const responseTabButtons = document.querySelectorAll('.response-tabs .tab-button');

/**
 * Import collection button
 * @const {HTMLButtonElement}
 */
export const importCollectionBtn = document.getElementById('import-collection-btn');

/**
 * Collections list container
 * @const {HTMLElement}
 */
export const collectionsListDiv = document.getElementById('collections-list');

/**
 * Authentication type select dropdown
 * @const {HTMLSelectElement}
 */
export const authTypeSelect = document.getElementById('auth-type-select');

/**
 * Authentication fields container
 * @const {HTMLElement}
 */
export const authFieldsContainer = document.getElementById('auth-fields-container');
