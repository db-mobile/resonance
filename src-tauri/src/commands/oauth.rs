use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// PKCE (Proof Key for Code Exchange) parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PkceParams {
    pub code_verifier: String,
    pub code_challenge: String,
    pub code_challenge_method: String,
}

/// Authorization URL parameters for building the auth URL
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationUrlParams {
    pub authorization_url: String,
    pub client_id: String,
    pub redirect_uri: String,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub code_challenge: Option<String>,
    #[serde(default)]
    pub code_challenge_method: Option<String>,
    #[serde(default)]
    pub audience: Option<String>,
    #[serde(default)]
    pub extra_params: Option<HashMap<String, String>>,
}

/// State for storing PKCE verifiers during authorization flow
pub struct OAuth2State {
    /// Maps state parameter to code_verifier for PKCE
    pub pkce_verifiers: Mutex<HashMap<String, String>>,
}

impl Default for OAuth2State {
    fn default() -> Self {
        Self {
            pkce_verifiers: Mutex::new(HashMap::new()),
        }
    }
}

/// Generate PKCE code verifier and challenge
/// Returns (code_verifier, code_challenge, code_challenge_method)
#[tauri::command]
pub fn oauth2_generate_pkce() -> PkceParams {
    // Generate a random 32-byte code verifier (will be 43 chars base64url encoded)
    let verifier_bytes: [u8; 32] = rand_bytes();
    let code_verifier = base64_url_encode(&verifier_bytes);

    // Generate code challenge using S256 method
    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let challenge_bytes = hasher.finalize();
    let code_challenge = base64_url_encode(&challenge_bytes);

    PkceParams {
        code_verifier,
        code_challenge,
        code_challenge_method: "S256".to_string(),
    }
}

/// Generate a random state parameter for CSRF protection
#[tauri::command]
pub fn oauth2_generate_state() -> String {
    let state_bytes: [u8; 16] = rand_bytes();
    base64_url_encode(&state_bytes)
}

/// Store PKCE verifier for later use during token exchange
#[tauri::command]
pub fn oauth2_store_pkce_verifier(
    state: State<'_, OAuth2State>,
    state_param: String,
    code_verifier: String,
) -> Result<(), String> {
    let mut verifiers = state
        .pkce_verifiers
        .lock()
        .map_err(|e| format!("Failed to lock state: {}", e))?;
    verifiers.insert(state_param, code_verifier);
    Ok(())
}

/// Retrieve and remove stored PKCE verifier
#[tauri::command]
pub fn oauth2_get_pkce_verifier(
    state: State<'_, OAuth2State>,
    state_param: String,
) -> Result<Option<String>, String> {
    let mut verifiers = state
        .pkce_verifiers
        .lock()
        .map_err(|e| format!("Failed to lock state: {}", e))?;
    Ok(verifiers.remove(&state_param))
}

/// Build the authorization URL for the authorization code flow
#[tauri::command]
pub fn oauth2_build_authorization_url(params: AuthorizationUrlParams) -> Result<String, String> {
    let mut url = url::Url::parse(&params.authorization_url)
        .map_err(|e| format!("Invalid authorization URL: {}", e))?;

    {
        let mut query = url.query_pairs_mut();
        query.append_pair("response_type", "code");
        query.append_pair("client_id", &params.client_id);
        query.append_pair("redirect_uri", &params.redirect_uri);

        if let Some(scope) = &params.scope {
            if !scope.is_empty() {
                query.append_pair("scope", scope);
            }
        }

        if let Some(state) = &params.state {
            query.append_pair("state", state);
        }

        if let Some(code_challenge) = &params.code_challenge {
            query.append_pair("code_challenge", code_challenge);
            if let Some(method) = &params.code_challenge_method {
                query.append_pair("code_challenge_method", method);
            }
        }

        if let Some(audience) = &params.audience {
            if !audience.is_empty() {
                query.append_pair("audience", audience);
            }
        }

        if let Some(extra) = &params.extra_params {
            for (key, value) in extra {
                query.append_pair(key, value);
            }
        }
    }

    Ok(url.to_string())
}

/// Exchange credentials for an OAuth 2.0 access token
#[tauri::command]
pub async fn oauth2_get_token(config: OAuth2Config) -> Result<OAuth2TokenResponse, String> {
    let client = Client::builder()
        .user_agent(format!("resonance/{}", env!("CARGO_PKG_VERSION")))
        .build()
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
                return Ok(OAuth2TokenResponse {
                    success: false,
                    access_token: None,
                    token_type: None,
                    expires_in: None,
                    refresh_token: None,
                    scope: None,
                    id_token: None,
                    error: Some("invalid_request".to_string()),
                    error_description: Some("Authorization code is required".to_string()),
                });
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
                return Ok(OAuth2TokenResponse {
                    success: false,
                    access_token: None,
                    token_type: None,
                    expires_in: None,
                    refresh_token: None,
                    scope: None,
                    id_token: None,
                    error: Some("invalid_request".to_string()),
                    error_description: Some("Refresh token is required".to_string()),
                });
            }
        }
        _ => {
            return Ok(OAuth2TokenResponse {
                success: false,
                access_token: None,
                token_type: None,
                expires_in: None,
                refresh_token: None,
                scope: None,
                id_token: None,
                error: Some("unsupported_grant_type".to_string()),
                error_description: Some(format!("Unsupported grant type: {}", config.grant_type)),
            });
        }
    }

    // Add scope if provided
    if let Some(scope) = &config.scope {
        if !scope.is_empty() {
            form_params.insert("scope".to_string(), scope.clone());
        }
    }

    // Add audience if provided (common for Auth0, etc.)
    if let Some(audience) = &config.audience {
        if !audience.is_empty() {
            form_params.insert("audience".to_string(), audience.clone());
        }
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
            if let Some(secret) = &config.client_secret {
                if !secret.is_empty() {
                    form_params.insert("client_secret".to_string(), secret.clone());
                }
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

    if status.is_success() {
        Ok(OAuth2TokenResponse {
            success: true,
            access_token: token_response
                .get("access_token")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            token_type: token_response
                .get("token_type")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            expires_in: token_response.get("expires_in").and_then(|v| v.as_i64()),
            refresh_token: token_response
                .get("refresh_token")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            scope: token_response
                .get("scope")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            id_token: token_response
                .get("id_token")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            error: None,
            error_description: None,
        })
    } else {
        Ok(OAuth2TokenResponse {
            success: false,
            access_token: None,
            token_type: None,
            expires_in: None,
            refresh_token: None,
            scope: None,
            id_token: None,
            error: token_response
                .get("error")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| Some(format!("HTTP {}", status.as_u16()))),
            error_description: token_response
                .get("error_description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        })
    }
}

/// Generate random bytes using a simple PRNG (for non-cryptographic use)
/// In production, you might want to use a proper crypto RNG
fn rand_bytes<const N: usize>() -> [u8; N] {
    use std::time::{SystemTime, UNIX_EPOCH};

    let mut result = [0u8; N];
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;

    // Simple xorshift64 PRNG
    let mut state = seed ^ 0x5DEECE66D;
    for byte in result.iter_mut() {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        *byte = state as u8;
    }

    result
}

/// Base64 URL-safe encoding without padding (RFC 4648)
fn base64_url_encode(data: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, data)
}
