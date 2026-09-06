/**
 * @fileoverview Centralized DOM element references for the application
 * @module modules/domElements
 */

export const urlInput = document.getElementById('url-input');
export const methodSelect = document.getElementById('method-select');

export const bodyInput = document.getElementById('body-input');

export const bodyEditorContainer = document.getElementById('body-editor-container');

export const bodyTextEditorContainer = document.getElementById('body-text-editor-container');

export const graphqlQueryEditor = document.getElementById('graphql-query-editor');

export const graphqlVariablesEditor = document.getElementById('graphql-variables-editor');

export const graphqlFormatBtn = document.getElementById('graphql-format-btn');

export const bodyModeSelect = document.getElementById('body-mode-select');

export const curlBtn = document.getElementById('curl-btn');

export const sendRequestBtn = document.getElementById('send-request-btn');

export const cancelRequestBtn = document.getElementById('cancel-request-btn');

export const statusDisplay = document.getElementById('status-display');

export const responseTimeDisplay = document.getElementById('response-time-display');

export const responseSizeDisplay = document.getElementById('response-size-display');

export const pathParamsList = document.getElementById('path-params-list');

export const addPathParamBtn = document.getElementById('add-path-param-btn');

export const headersList = document.getElementById('headers-list');

export const addHeaderBtn = document.getElementById('add-header-btn');

export const queryParamsList = document.getElementById('query-params-list');

export const addQueryParamBtn = document.getElementById('add-query-param-btn');

export const responseBodyContainer = document.getElementById('response-body-container');

export const responseHeadersDisplay = document.getElementById('response-headers-display');

export const responseCookiesDisplay = document.getElementById('response-cookies-display');

export const responsePerformanceDisplay = document.getElementById('response-performance-display');

export const languageSelector = document.getElementById('language-selector');

export const requestTabButtons = document.querySelectorAll('.request-config .tab-button');

export const requestTabContents = document.querySelectorAll('.request-config .tab-content');

export const responseTabButtons = document.querySelectorAll('.response-tabs .tab-button');

export const importCollectionBtn = document.getElementById('import-collection-btn');

export const authTypeSelect = document.getElementById('auth-type-select');

export const authFieldsContainer = document.getElementById('auth-fields-container');

export const grpcTargetInput = document.getElementById('grpc-target-input');
export const grpcTlsCheckbox = document.getElementById('grpc-tls-checkbox');
export const grpcConnectBtn = document.getElementById('grpc-connect-btn');
export const grpcConnectionStatus = document.getElementById('grpc-connection-status');
export const grpcServiceSelect = document.getElementById('grpc-service-select');
export const grpcMethodSelect = document.getElementById('grpc-method-select');
export const grpcBodyInput = document.getElementById('grpc-body-input');
export const grpcBodyEditorContainer = document.getElementById('grpc-body-editor-container');
export const grpcGenerateSkeletonBtn = document.getElementById('grpc-generate-skeleton-btn');
export const grpcMetadataList = document.getElementById('grpc-metadata-list');
export const grpcAddMetadataBtn = document.getElementById('grpc-add-metadata-btn');
export const grpcSendBtn = document.getElementById('grpc-send-btn');
export const grpcLoadProtoBtn = document.getElementById('grpc-load-proto-btn');
export const grpcClearProtoBtn = document.getElementById('grpc-clear-proto-btn');
export const grpcProtoFilename = document.getElementById('grpc-proto-filename');
export const grpcProtoStatus = document.getElementById('grpc-proto-status');
