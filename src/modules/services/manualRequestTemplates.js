import { app } from '../appContext.js';
import { captureFormBody, captureSnippetBody, getRequestBodyContent } from '../requestBodyHelper.js';
import { buildGraphQLBody } from '../utils/graphqlBody.js';
import { clone } from '../utils/clone.js';

export function captureManualBody(bodyMode, graphqlManager = null) {
    try { return clone({ bodyMode, jsonContent: getRequestBodyContent(), form: captureFormBody(bodyMode),
        graphql: graphqlManager ? { query: graphqlManager.getGraphQLQuery(), variables: graphqlManager.getGraphQLVariables(), operationName: graphqlManager.getSelectedOperationName?.() } : null,
        text: app.requestBodyTextEditor?.getContent?.() || '' }); }
    catch (error) { return { bodyMode, captureError: `Error processing request body: ${error.message}` }; }
}

export function buildManualBody(source, processor, variables) {
    if (source.captureError) { return { error: source.captureError }; }
    if (source.graphql) {
        const built = buildGraphQLBody(source.graphql, text => processor.processTemplate(text, variables));
        return built.error ? { error: `Invalid GraphQL Variables JSON: ${built.error.message}` } : { body: built.body };
    }
    const {form} = source;
    const result = captureSnippetBody({ bodyMode: source.bodyMode, processor, variables, jsonContent: source.jsonContent,
        requestBodyTextEditor: { getContent: () => source.text },
        formBodyManager: form ? { getFormDataRows: () => form.fields, getUrlencodedRows: () => form.fields, getBinaryBody: () => form } : null });
    if (source.bodyMode === 'binary' && form && result.body === undefined) { return { error: 'No file selected for binary body.' }; }
    return result.error ? { error: `Invalid Body JSON: ${result.error}` } : result;
}
