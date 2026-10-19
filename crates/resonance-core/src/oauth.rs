use crate::http_client::{HttpClientOptions, build_http_client};
use crate::proxy::ProxySettings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
/// OAuth 2.0 Configuration for token requests
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuth2Config {
    pub grant_type: String,
    pub token_url: String,
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub authorization_code: Option<String>,
    #[serde(default)]
    pub redirect_uri: Option<String>,
    #[serde(default)]
    pub code_verifier: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub audience: Option<String>,
    /// Additional custom parameters to include in the token request
    #[serde(default)]
    pub extra_params: Option<HashMap<String, String>>,
    /// How to send client credentials: "body" (form params) or "header" (Basic auth)
    #[serde(default)]
    pub client_auth_method: Option<String>,
}

/// OAuth 2.0 Token Response
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuth2TokenResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_description: Option<String>,
}

impl OAuth2TokenResponse {
    fn error(error: String, description: Option<String>) -> Self {
        Self {
            error: Some(error),
            error_description: description,
            ..Self::default()
        }
    }
}

pub async fn oauth2_get_token(
    proxy: &ProxySettings,
    config: OAuth2Config,
) -> Result<OAuth2TokenResponse, String> {
    let proxy_action = proxy.proxy_action(&config.token_url);
    let client = build_http_client(
        HttpClientOptions {
            user_agent: format!("resonance/{}", env!("CARGO_PKG_VERSION")),
            timeout: None,
            connect_timeout: None,
            http_version: None,
            verify_ssl: true,
            client_cert: None,
            follow_redirects: true,
            disable_pooling: false,
            single_connection: false,
            timing_recorder: None,
        },
        proxy_action,
    )
    .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut form_params: HashMap<String, String> = HashMap::new();

    // Set grant type
    form_params.insert("grant_type".to_string(), config.grant_type.clone());

    // Add parameters based on grant type
    match config.grant_type.as_str() {
        "authorization_code" => {
            if let Some(code) = &config.authorization_code {
                form_params.insert("code".to_string(), code.clone());
            } else {
                return Ok(OAuth2TokenResponse::error(
                    "invalid_request".to_string(),
                    Some("Authorization code is required".to_string()),
                ));
            }

            if let Some(redirect_uri) = &config.redirect_uri {
                form_params.insert("redirect_uri".to_string(), redirect_uri.clone());
            }

            // PKCE code_verifier
            if let Some(code_verifier) = &config.code_verifier {
                form_params.insert("code_verifier".to_string(), code_verifier.clone());
            }
        }
        "client_credentials" => {
            // Client credentials flow - client_id and client_secret are handled below
        }
        "password" => {
            if let Some(username) = &config.username {
                form_params.insert("username".to_string(), username.clone());
            }
            if let Some(password) = &config.password {
                form_params.insert("password".to_string(), password.clone());
            }
        }
        "refresh_token" => {
            if let Some(refresh_token) = &config.refresh_token {
                form_params.insert("refresh_token".to_string(), refresh_token.clone());
            } else {
                return Ok(OAuth2TokenResponse::error(
                    "invalid_request".to_string(),
                    Some("Refresh token is required".to_string()),
                ));
            }
        }
        _ => {
            return Ok(OAuth2TokenResponse::error(
                "unsupported_grant_type".to_string(),
                Some(format!("Unsupported grant type: {}", config.grant_type)),
            ));
        }
    }

    // Add scope if provided
    if let Some(scope) = &config.scope
        && !scope.is_empty()
    {
        form_params.insert("scope".to_string(), scope.clone());
    }

    // Add audience if provided (common for Auth0, etc.)
    if let Some(audience) = &config.audience
        && !audience.is_empty()
    {
        form_params.insert("audience".to_string(), audience.clone());
    }

    // Add any extra parameters
    if let Some(extra) = &config.extra_params {
        for (key, value) in extra {
            form_params.insert(key.clone(), value.clone());
        }
    }

    // Build the request
    let mut request = client.post(&config.token_url);

    // Handle client authentication
    let client_auth_method = config.client_auth_method.as_deref().unwrap_or("body");

    match client_auth_method {
        "header" | "basic" => {
            // Send client credentials in Authorization header (Basic auth)
            let credentials = format!(
                "{}:{}",
                config.client_id,
                config.client_secret.as_deref().unwrap_or("")
            );
            let encoded = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                credentials.as_bytes(),
            );
            request = request.header("Authorization", format!("Basic {}", encoded));
        }
        _ => {
            // Send client credentials in request body (default)
            form_params.insert("client_id".to_string(), config.client_id.clone());
            if let Some(secret) = &config.client_secret
                && !secret.is_empty()
            {
                form_params.insert("client_secret".to_string(), secret.clone());
            }
        }
    }

    // Send the request
    let response = request
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .form(&form_params)
        .send()
        .await
        .map_err(|e| format!("Token request failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Parse the response
    let token_response: serde_json::Value = serde_json::from_str(&body).unwrap_or_else(|_| {
        serde_json::json!({
            "error": "invalid_response",
            "error_description": body
        })
    });

    let text = |key: &str| {
        token_response
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };

    if status.is_success() {
        Ok(OAuth2TokenResponse {
            success: true,
            access_token: text("access_token"),
            token_type: text("token_type"),
            expires_in: token_response.get("expires_in").and_then(|v| v.as_i64()),
            refresh_token: text("refresh_token"),
            scope: text("scope"),
            id_token: text("id_token"),
            error: None,
            error_description: None,
        })
    } else {
        Ok(OAuth2TokenResponse::error(
            text("error").unwrap_or_else(|| format!("HTTP {}", status.as_u16())),
            text("error_description"),
        ))
    }
}
