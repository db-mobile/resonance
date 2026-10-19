//! Hiding credentials before a request or response is shown or stored. The
//! rules match the desktop's history redaction.
use crate::results::HistorySensitive;
use serde_json::{Map, Value};
use std::collections::HashMap;

pub const REDACTED: &str = "[redacted]";
pub const SENSITIVE_REQUEST_HEADERS: &[&str] = &["authorization", "proxy-authorization", "cookie"];
pub const SENSITIVE_RESPONSE_HEADERS: &[&str] = &["set-cookie"];

fn is_sensitive(name: &str, base: &[&str], extra: &[String]) -> bool {
    base.iter().any(|b| b.eq_ignore_ascii_case(name))
        || extra.iter().any(|e| e.eq_ignore_ascii_case(name))
}

/// Replaces the values of sensitive headers, matched case-insensitively.
pub fn redact_headers(
    headers: &Map<String, Value>,
    base: &[&str],
    extra: &[String],
) -> Map<String, Value> {
    headers
        .iter()
        .map(|(name, value)| {
            let value = if is_sensitive(name, base, extra) {
                Value::String(REDACTED.into())
            } else {
                value.clone()
            };
            (name.clone(), value)
        })
        .collect()
}

/// Replaces the values of the named query parameters in a URL; a URL that
/// does not parse is returned unchanged.
pub fn redact_url_query(url: &str, names: &[String]) -> String {
    if names.is_empty() {
        return url.to_string();
    }
    let Ok(mut parsed) = url::Url::parse(url) else {
        return url.to_string();
    };
    let pairs: Vec<(String, String)> = parsed.query_pairs().into_owned().collect();
    if !pairs.iter().any(|(k, _)| names.contains(k)) {
        return url.to_string();
    }
    parsed.set_query(None);
    {
        let mut query = parsed.query_pairs_mut();
        for (key, value) in pairs {
            if names.contains(&key) {
                query.append_pair(&key, REDACTED);
            } else {
                query.append_pair(&key, &value);
            }
        }
    }
    parsed.to_string()
}

/// A prepared request config with credentials hidden: the standard
/// credential headers plus the ones the preparation step generated, and any
/// generated query parameters in `url` and `rawUrl`.
pub fn redact_request(config: &Value, sensitive: Option<&HistorySensitive>) -> Value {
    let header_names = sensitive
        .map(|s| s.header_names.clone())
        .unwrap_or_default();
    let query_names = sensitive.map(|s| s.query_names.clone()).unwrap_or_default();
    let mut redacted = config.clone();
    if let Some(object) = redacted.as_object_mut() {
        if let Some(headers) = object.get("headers").and_then(Value::as_object) {
            let cleaned = redact_headers(headers, SENSITIVE_REQUEST_HEADERS, &header_names);
            object.insert("headers".into(), Value::Object(cleaned));
        }
        for key in ["url", "rawUrl"] {
            if let Some(url) = object.get(key).and_then(Value::as_str) {
                let cleaned = redact_url_query(url, &query_names);
                object.insert(key.into(), Value::String(cleaned));
            }
        }
        for key in ["auth", "awsAuth", "ntlm", "clientCert"] {
            if object.contains_key(key) {
                object.insert(key.into(), Value::String(REDACTED.into()));
            }
        }
    }
    redacted
}

/// Response headers with cookies hidden.
pub fn redact_response_headers(headers: &HashMap<String, String>) -> HashMap<String, String> {
    headers
        .iter()
        .map(|(name, value)| {
            let value = if is_sensitive(name, SENSITIVE_RESPONSE_HEADERS, &[]) {
                REDACTED.to_string()
            } else {
                value.clone()
            };
            (name.clone(), value)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn marked_and_default_headers_are_redacted_case_insensitively() {
        let config = json!({
            "url": "https://api.test/items?api_key=secret&page=2",
            "rawUrl": "{{base}}/items?api_key=secret",
            "headers": {"Authorization": "Bearer t", "X-Api-Key": "k", "Accept": "*/*", "cookie": "a=b"},
            "auth": {"username": "u", "password": "p"}
        });
        let sensitive = HistorySensitive {
            header_names: vec!["x-api-key".into()],
            query_names: vec!["api_key".into()],
        };

        let redacted = redact_request(&config, Some(&sensitive));

        assert_eq!(redacted["headers"]["Authorization"], REDACTED);
        assert_eq!(redacted["headers"]["X-Api-Key"], REDACTED);
        assert_eq!(redacted["headers"]["cookie"], REDACTED);
        assert_eq!(redacted["headers"]["Accept"], "*/*");
        assert_eq!(
            redacted["url"],
            "https://api.test/items?api_key=%5Bredacted%5D&page=2"
        );
        assert_eq!(redacted["rawUrl"], "{{base}}/items?api_key=secret");
        assert_eq!(redacted["auth"], REDACTED);
    }

    #[test]
    fn urls_without_marked_parameters_are_left_untouched() {
        assert_eq!(
            redact_url_query("https://api.test/a?x=1", &["y".into()]),
            "https://api.test/a?x=1"
        );
        assert_eq!(redact_url_query("not a url", &["x".into()]), "not a url");
    }

    #[test]
    fn set_cookie_is_redacted_in_responses() {
        let headers = HashMap::from([
            ("Set-Cookie".to_string(), "sid=1".to_string()),
            ("content-type".to_string(), "text/plain".to_string()),
        ]);
        let redacted = redact_response_headers(&headers);
        assert_eq!(redacted["Set-Cookie"], REDACTED);
        assert_eq!(redacted["content-type"], "text/plain");
    }
}
