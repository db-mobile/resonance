import { app } from '../appContext.js';
import { captureFormBody, getRequestBodyContent } from '../requestBodyHelper.js';
import { clone } from '../utils/clone.js';

export function captureManualBody(bodyMode, graphqlManager = null) {
    try {
        return clone({
            bodyMode,
            jsonContent: getRequestBodyContent(),
            form: captureFormBody(bodyMode),
            graphql: graphqlManager
                ? {
                      query: graphqlManager.getGraphQLQuery(),
                      variables: graphqlManager.getGraphQLVariables(),
                      operationName: graphqlManager.getSelectedOperationName?.()
                  }
                : null,
            text: app.requestBodyTextEditor?.getContent?.() || ''
        });
    } catch (error) {
        return { bodyMode, captureError: `Error processing request body: ${error.message}` };
    }
}
