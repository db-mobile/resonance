use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

use super::proxy::ProxyState;

pub use resonance_core::oauth::{OAuth2Config, OAuth2TokenResponse};

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

        if let Some(scope) = &params.scope
            && !scope.is_empty()
        {
            query.append_pair("scope", scope);
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

        if let Some(audience) = &params.audience
            && !audience.is_empty()
        {
            query.append_pair("audience", audience);
        }

        if let Some(extra) = &params.extra_params {
            for (key, value) in extra {
                query.append_pair(key, value);
            }
        }
    }

    Ok(url.to_string())
}

/// Exchange credentials for an OAuth 2.0 access token.
///
/// Built through [`build_http_client`] so the token endpoint is reached through
/// the configured proxy, as the request whose token this is will be.
#[tauri::command]
pub async fn oauth2_get_token(
    proxy_state: State<'_, ProxyState>,
    config: OAuth2Config,
) -> Result<OAuth2TokenResponse, String> {
    resonance_core::oauth::oauth2_get_token(&proxy_state.snapshot(), config).await
}

/// Generate cryptographically secure random bytes from the operating system's
/// entropy source. Used for the PKCE `code_verifier` and the OAuth CSRF `state`,
/// both of which must be unpredictable.
fn rand_bytes<const N: usize>() -> [u8; N] {
    let mut result = [0u8; N];
    getrandom::fill(&mut result).expect("OS random number generator unavailable");
    result
}

/// Base64 URL-safe encoding without padding (RFC 4648)
fn base64_url_encode(data: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, data)
}
