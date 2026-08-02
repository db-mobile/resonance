//! Redaction of literal auth credentials before they reach a collection file.

use serde_json::Value;

/// Secret credential fields per auth type. Kept in sync with the frontend list in
/// `src/modules/auth/authSecrets.js`.
pub(crate) fn secret_auth_fields(auth_type: &str) -> &'static [&'static str] {
    match auth_type {
        "bearer" => &["token"],
        "basic" => &["password"],
        "api-key" => &["keyValue"],
        "oauth2" => &["clientSecret", "password", "token", "refreshToken"],
        "digest" => &["password"],
        "aws-v4" => &["secretAccessKey", "sessionToken"],
        _ => &[],
    }
}

/// A `{{ ... }}` reference resolves from a variable at request time and carries no
/// secret itself, so it is safe to leave on disk.
pub(crate) fn is_template_ref(value: &str) -> bool {
    match value.find("{{") {
        Some(start) => value[start..].contains("}}"),
        None => false,
    }
}

/// Defense in depth: blank literal credential fields so they never reach the
/// git-friendly collection files even if the frontend fails to redact them. Template
/// references and empty values are preserved. The real values are kept in the
/// frontend SecretStore and rehydrated on read.
pub(crate) fn redact_auth_secrets(auth_config: &mut Value) {
    let auth_type = match auth_config.get("type").and_then(|t| t.as_str()) {
        Some(t) => t.to_string(),
        None => return,
    };
    let fields = secret_auth_fields(&auth_type);
    if fields.is_empty() {
        return;
    }
    if let Some(config) = auth_config
        .get_mut("config")
        .and_then(|c| c.as_object_mut())
    {
        for field in fields {
            if let Some(Value::String(s)) = config.get(*field) {
                if !s.is_empty() && !is_template_ref(s) {
                    config.insert((*field).to_string(), Value::String(String::new()));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn blanks_a_literal_bearer_token() {
        let mut auth = json!({"type": "bearer", "config": {"token": "sk-live-abc"}});
        redact_auth_secrets(&mut auth);
        assert_eq!(auth["config"]["token"], "");
    }

    #[test]
    fn preserves_a_template_reference() {
        let mut auth = json!({"type": "bearer", "config": {"token": "{{apiToken}}"}});
        redact_auth_secrets(&mut auth);
        assert_eq!(auth["config"]["token"], "{{apiToken}}");
    }

    #[test]
    fn leaves_non_secret_fields_alone() {
        let mut auth = json!({
            "type": "basic",
            "config": {"username": "ada", "password": "hunter2"}
        });
        redact_auth_secrets(&mut auth);
        assert_eq!(auth["config"]["username"], "ada");
        assert_eq!(auth["config"]["password"], "");
    }

    #[test]
    fn blanks_every_secret_field_of_a_multi_secret_type() {
        let mut auth = json!({
            "type": "oauth2",
            "config": {
                "clientId": "public-id",
                "clientSecret": "shh",
                "password": "pw",
                "token": "tok",
                "refreshToken": "refresh"
            }
        });
        redact_auth_secrets(&mut auth);

        assert_eq!(auth["config"]["clientId"], "public-id");
        for field in ["clientSecret", "password", "token", "refreshToken"] {
            assert_eq!(auth["config"][field], "", "{} should be blanked", field);
        }
    }

    #[test]
    fn ignores_an_unknown_auth_type() {
        let mut auth = json!({"type": "mystery", "config": {"token": "keep-me"}});
        redact_auth_secrets(&mut auth);
        assert_eq!(auth["config"]["token"], "keep-me");
    }

    #[test]
    fn tolerates_a_missing_type_or_config() {
        let mut no_type = json!({"config": {"token": "x"}});
        redact_auth_secrets(&mut no_type);
        assert_eq!(no_type["config"]["token"], "x");

        let mut no_config = json!({"type": "bearer"});
        redact_auth_secrets(&mut no_config);
        assert_eq!(no_config["type"], "bearer");
    }

    #[test]
    fn an_empty_value_stays_empty() {
        let mut auth = json!({"type": "bearer", "config": {"token": ""}});
        redact_auth_secrets(&mut auth);
        assert_eq!(auth["config"]["token"], "");
    }

    #[test]
    fn template_detection_requires_both_delimiters() {
        assert!(is_template_ref("{{token}}"));
        assert!(is_template_ref("Bearer {{token}}"));
        assert!(!is_template_ref("{{token"));
        assert!(!is_template_ref("token}}"));
        assert!(!is_template_ref("plain"));
    }

    #[test]
    fn every_auth_type_the_frontend_knows_has_a_field_list() {
        for auth_type in ["bearer", "basic", "api-key", "oauth2", "digest", "aws-v4"] {
            assert!(
                !secret_auth_fields(auth_type).is_empty(),
                "{} lost its secret field list",
                auth_type
            );
        }
        assert!(secret_auth_fields("none").is_empty());
        assert!(secret_auth_fields("inherit").is_empty());
    }
}
