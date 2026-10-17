/**
 * @fileoverview Builds the JSON body of a GraphQL request from its query, variables text and operation name
 * @module utils/graphqlBody
 */

/**
 * @param {{query?: string, variables?: string, operationName?: string|null}} graphqlData
 * @param {(text: string) => string} process
 * @returns {{body?: {query: string, variables: Object, operationName?: string}, error?: Error}}
 */
export function buildGraphQLBody(graphqlData, process) {
    const query = process((graphqlData.query || '').trim());
    const variablesText = process((graphqlData.variables || '').trim());

    let parsedVariables = {};
    if (variablesText) {
        try {
            parsedVariables = JSON.parse(variablesText);
        } catch (error) {
            return { error };
        }
    }

    const body = { query, variables: parsedVariables };
    if (graphqlData.operationName) {
        body.operationName = graphqlData.operationName;
    }
    return { body };
}
