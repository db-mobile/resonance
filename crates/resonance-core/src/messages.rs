//! Human-readable text for execution error codes. English is the source of
//! truth; a presentation layer may translate by code on top.
use crate::model::ExecutionError;
use serde_json::Value;

fn details_text(details: &Value) -> String {
    match details {
        Value::Array(items) => items
            .iter()
            .map(|item| match item {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .collect::<Vec<_>>()
            .join("; "),
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn template(code: &str) -> Option<&'static str> {
    Some(match code {
        "credentialsRemoved" => {
            "Authentication was removed because the script changed the request origin."
        }
        "oauthRefreshFailed" => "OAuth token refresh failed: {{message}}",
        "cancelled" => "Request cancelled",
        "preRequestFailed" => "Pre-request script failed: {{message}}",
        "scriptWorkerFailed" => "Script worker failed: {{message}}",
        "invalidRequest" => "Invalid request: {{message}}",
        "transportFailed" => "Request failed: {{message}}",
        "invalidBody" => "Invalid Body JSON: {{message}}",
        "invalidGraphqlVariables" => "Invalid GraphQL Variables JSON: {{message}}",
        "missingBinaryFile" => "No file selected for binary body",
        "missingCollection" => "The collection this request came from is not open.",
        "missingRequest" => "The request no longer exists in its collection.",
        "unsupportedProtocol" => "This protocol cannot be run by the collection runner.",
        "executionLimit" => "Execution limit reached.",
        "invalidTarget" => "Next request is missing or ambiguous in the selected queue.",
        "emptyQueue" => "Runner has no requests to execute",
        "emptyDataFile" => "Data file has no rows",
        "invalidExecutionLimit" => "Invalid maximum executions per iteration",
        "invalidDataJson" => "Data file is not valid JSON: {{message}}",
        "invalidDataRows" => "Data file must be a JSON array of objects",
        "unclosedDataQuote" => "Data file has an unclosed quote: {{message}}",
        "emptyDataHeader" => "Data file has an empty column header",
        "extraDataValues" => "Data file row has more values than headers: {{message}}",
        "testsFailed" => "Test script failed",
        "persistenceFailed" => "Execution persistence failed: {{message}}",
        _ => return None,
    })
}

impl ExecutionError {
    /// The message a user sees for this error.
    ///
    /// Mirrors the desktop's `executionError` table: array details are joined
    /// with `; `, string details are used verbatim, anything else is JSON, and
    /// unresolved variable names are listed five at a time.
    pub fn message(&self) -> String {
        if self.code == "unresolvedVariables" {
            let names: Vec<String> = self
                .details
                .as_array()
                .map(|items| items.iter().map(details_text).collect())
                .unwrap_or_default();
            let shown = names
                .iter()
                .take(5)
                .map(|name| format!("{{{{{name}}}}}"))
                .collect::<Vec<_>>()
                .join(", ");
            let more = if names.len() > 5 {
                format!(" and {} more", names.len() - 5)
            } else {
                String::new()
            };
            return format!("Request sent with unresolved variables: {shown}{more}");
        }
        let message = details_text(&self.details);
        match template(&self.code) {
            Some(text) => text.replace("{{message}}", &message),
            None => format!("{}: {}", self.code, message),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_known_code_has_a_message_and_details_are_substituted() {
        assert_eq!(
            ExecutionError::new("preRequestFailed", json!(["a", "b"])).message(),
            "Pre-request script failed: a; b"
        );
        assert_eq!(
            ExecutionError::new("transportFailed", "connection refused").message(),
            "Request failed: connection refused"
        );
        assert_eq!(
            ExecutionError::new("cancelled", Value::Null).message(),
            "Request cancelled"
        );
        assert_eq!(
            ExecutionError::new("executionLimit", json!({"limit": 3})).message(),
            "Execution limit reached."
        );
        assert_eq!(
            ExecutionError::new("extraDataValues", json!({"line": 4})).message(),
            "Data file row has more values than headers: {\"line\":4}"
        );
    }

    #[test]
    fn unresolved_variables_lists_five_names_then_a_count() {
        let error = ExecutionError::new(
            "unresolvedVariables",
            json!(["a", "b", "c", "d", "e", "f", "g"]),
        );
        assert_eq!(
            error.message(),
            "Request sent with unresolved variables: {{a}}, {{b}}, {{c}}, {{d}}, {{e}} and 2 more"
        );
        assert_eq!(
            ExecutionError::new("unresolvedVariables", json!(["only"])).message(),
            "Request sent with unresolved variables: {{only}}"
        );
    }

    #[test]
    fn unknown_codes_fall_back_to_code_and_details() {
        assert_eq!(
            ExecutionError::new("somethingNew", "details").message(),
            "somethingNew: details"
        );
    }
}
