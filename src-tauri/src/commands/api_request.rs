use reqwest::{Client, Method, RequestBuilder, Response};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;
use tokio::sync::oneshot;
use uuid::Uuid;

use super::proxy::ProxyState;

/// Digest authentication challenge parsed from WWW-Authenticate header
#[derive(Debug, Clone)]
struct DigestChallenge {
    realm: String,
    nonce: String,
    qop: Option<String>,
    algorithm: String,
    opaque: Option<String>,
}

impl DigestChallenge {
    /// Parse WWW-Authenticate header to extract digest challenge parameters
    fn parse(www_authenticate: &str) -> Option<Self> {
        if !www_authenticate.contains("Digest") {
            return None;
        }

        let mut realm = String::new();
        let mut nonce = String::new();
        let mut qop = None;
        let mut algorithm = "MD5".to_string();
        let mut opaque = None;

        // Parse key=value pairs from the header
        let re = regex::Regex::new(r#"(\w+)=["']?([^"',]+)["']?"#).ok()?;
        for cap in re.captures_iter(www_authenticate) {
            let key = cap.get(1)?.as_str();
            let value = cap.get(2)?.as_str();
            match key {
                "realm" => realm = value.to_string(),
                "nonce" => nonce = value.to_string(),
                "qop" => qop = Some(value.to_string()),
                "algorithm" => algorithm = value.to_uppercase(),
                "opaque" => opaque = Some(value.to_string()),
                _ => {}
            }
        }

        if nonce.is_empty() {
            return None;
        }

        Some(DigestChallenge {
            realm,
            nonce,
            qop,
            algorithm,
            opaque,
        })
    }
}

/// Compute MD5 hash of a string
fn md5_hash(data: &str) -> String {
    let digest = md5::compute(data.as_bytes());
    hex::encode(digest.0)
}

/// Generate a random client nonce
fn generate_cnonce() -> String {
    Uuid::new_v4().to_string().replace("-", "")
}

/// Extract URI path from a full URL
fn extract_uri(url: &str) -> String {
    if let Ok(parsed) = url::Url::parse(url) {
        let path = parsed.path();
        let query = parsed
            .query()
            .map(|q| format!("?{}", q))
            .unwrap_or_default();
        format!("{}{}", path, query)
    } else {
        "/".to_string()
    }
}

/// Build the Authorization header for digest authentication
fn build_digest_auth_header(
    username: &str,
    password: &str,
    method: &str,
    uri: &str,
    challenge: &DigestChallenge,
) -> Result<String, String> {
    let cnonce = generate_cnonce();
    let nc = "00000001";

    // Calculate HA1
    let ha1 = if challenge.algorithm == "MD5-SESS" {
        let ha1_base = md5_hash(&format!("{}:{}:{}", username, challenge.realm, password));
        md5_hash(&format!("{}:{}:{}", ha1_base, challenge.nonce, cnonce))
    } else if challenge.algorithm == "MD5" {
        md5_hash(&format!("{}:{}:{}", username, challenge.realm, password))
    } else {
        return Err(format!("Unsupported algorithm: {}", challenge.algorithm));
    };

    // Calculate HA2
    let ha2 = md5_hash(&format!("{}:{}", method, uri));

    // Calculate response
    let response = if let Some(qop) = &challenge.qop {
        if qop.contains("auth") {
            md5_hash(&format!(
                "{}:{}:{}:{}:auth:{}",
                ha1, challenge.nonce, nc, cnonce, ha2
            ))
        } else {
            md5_hash(&format!("{}:{}:{}", ha1, challenge.nonce, ha2))
        }
    } else {
        md5_hash(&format!("{}:{}:{}", ha1, challenge.nonce, ha2))
    };

    // Build the header
    let mut header = format!(
        r#"Digest username="{}", realm="{}", nonce="{}", uri="{}", response="{}""#,
        username, challenge.realm, challenge.nonce, uri, response
    );

    header.push_str(&format!(", algorithm={}", challenge.algorithm));

    if let Some(opaque) = &challenge.opaque {
        header.push_str(&format!(r#", opaque="{}""#, opaque));
    }

    if challenge.qop.is_some() {
        header.push_str(&format!(r#", qop=auth, nc={}, cnonce="{}""#, nc, cnonce));
    }

    Ok(header)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestOptions {
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<serde_json::Value>,
    pub auth: Option<AuthConfig>,
    #[serde(default)]
    pub http_version: Option<String>,
    /// Request timeout in milliseconds (defaults to 30000)
    #[serde(default)]
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfig {
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub auth_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestTimings {
    pub start_time: u64,
    pub dns_lookup: u64,
    pub tcp_connection: u64,
    pub tls_handshake: u64,
    pub first_byte: u64,
    pub download: u64,
    pub total: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub status: Option<u16>,
    pub status_text: Option<String>,
    pub headers: HashMap<String, String>,
    pub message: Option<String>,
    pub ttfb: Option<u64>,
    pub size: Option<usize>,
    pub timings: RequestTimings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancelled: Option<bool>,
}

pub struct RequestState {
    pub cancel_tx: Mutex<Option<oneshot::Sender<()>>>,
}

impl Default for RequestState {
    fn default() -> Self {
        Self {
            cancel_tx: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub async fn send_api_request(
    state: State<'_, RequestState>,
    proxy_state: State<'_, ProxyState>,
    request_options: RequestOptions,
) -> Result<ApiResponse, String> {
    // Create cancellation channel
    let (cancel_tx, cancel_rx) = oneshot::channel();
    *state.cancel_tx.lock().unwrap() = Some(cancel_tx);

    let start_time = Instant::now();
    let start_timestamp = chrono::Utc::now().timestamp_millis() as u64;

    let mut timings = RequestTimings {
        start_time: start_timestamp,
        dns_lookup: 0,
        tcp_connection: 0,
        tls_handshake: 0,
        first_byte: 0,
        download: 0,
        total: 0,
    };

    // Validate URL
    if request_options.url.is_empty() {
        return Ok(ApiResponse {
            success: false,
            data: None,
            status: None,
            status_text: None,
            headers: HashMap::new(),
            message: Some("URL is empty. Please enter a valid URL.".to_string()),
            ttfb: None,
            size: None,
            timings,
            cancelled: None,
        });
    }

    // Perform DNS lookup separately to measure timing
    let dns_start = Instant::now();
    let dns_duration = if let Ok(url) = url::Url::parse(&request_options.url) {
        if let Some(host) = url.host_str() {
            let port = url.port_or_known_default().unwrap_or(80);
            let lookup_addr = format!("{}:{}", host, port);
            let result = tokio::net::lookup_host(lookup_addr).await;
            match result {
                Ok(_) => dns_start.elapsed().as_millis() as u64,
                Err(_) => 0,
            }
        } else {
            0
        }
    } else {
        0
    };
    timings.dns_lookup = dns_duration;

    // Track connection timing and determine if HTTPS
    let connect_start = Instant::now();
    let is_https = request_options.url.starts_with("https://");

    // Build client with optional proxy and HTTP version
    // Use timeout from request options: None means no timeout, Some(0) also means no timeout
    let mut client_builder =
        Client::builder().user_agent(format!("resonance/{}", env!("CARGO_PKG_VERSION")));

    // Only set timeout if provided and > 0
    if let Some(timeout_ms) = request_options.timeout {
        if timeout_ms > 0 {
            client_builder = client_builder.timeout(Duration::from_millis(timeout_ms));
        }
    }

    // Configure HTTP version based on settings
    // Note: With rustls-tls + http2 feature, ALPN will negotiate HTTP/2 by default for HTTPS
    match request_options.http_version.as_deref() {
        Some("http1") => {
            // Force HTTP/1.1 only - disable HTTP/2 completely
            client_builder = client_builder.http1_only();
        }
        Some("http2") => {
            // Force HTTP/2 with prior knowledge (no ALPN negotiation)
            client_builder = client_builder.http2_prior_knowledge();
        }
        _ => {
            // "auto" or unset - let ALPN negotiate
        }
    }

    // Apply proxy settings if configured
    if let Some(proxy) = proxy_state.get_proxy_config(&request_options.url) {
        client_builder = client_builder.proxy(proxy);
    }

    let client = match client_builder.build() {
        Ok(c) => c,
        Err(e) => {
            return Ok(ApiResponse {
                success: false,
                data: None,
                status: None,
                status_text: None,
                headers: HashMap::new(),
                message: Some(format!("Client build error: {}", e)),
                ttfb: None,
                size: None,
                timings,
                cancelled: None,
            });
        }
    };

    // Parse method
    let method = request_options
        .method
        .parse::<Method>()
        .map_err(|e| format!("Invalid HTTP method: {}", e))?;

    // Helper to build a request
    let build_request = |auth_header: Option<String>| -> RequestBuilder {
        let mut rb = client.request(method.clone(), &request_options.url);
        if let Some(headers) = &request_options.headers {
            for (key, value) in headers {
                rb = rb.header(key, value);
            }
        }
        if let Some(body) = &request_options.body {
            rb = rb.json(body);
        }
        if let Some(auth) = auth_header {
            rb = rb.header("Authorization", auth);
        }
        rb
    };

    // Execute request with cancellation support
    let request_future = build_request(None).send();

    tokio::select! {
        result = request_future => {
            match result {
                Ok(response) => {
                    // Check for 401 with Digest challenge - retry with auth if credentials provided
                    if response.status().as_u16() == 401 {
                        if let Some(auth_config) = &request_options.auth {
                            if let Some(www_auth) = response.headers().get("www-authenticate") {
                                if let Ok(www_auth_str) = www_auth.to_str() {
                                    if let Some(challenge) = DigestChallenge::parse(www_auth_str) {
                                        let uri = extract_uri(&request_options.url);

                                        match build_digest_auth_header(
                                            &auth_config.username,
                                            &auth_config.password,
                                            request_options.method.to_uppercase().as_str(),
                                            &uri,
                                            &challenge,
                                        ) {
                                            Ok(auth_header) => {
                                                // Retry with digest auth
                                                let retry_result = build_request(Some(auth_header)).send().await;
                                                return process_response(retry_result, &mut timings, start_time, connect_start, is_https, &state).await;
                                            }
                                            Err(e) => {
                                                let _ = e;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    process_response(Ok(response), &mut timings, start_time, connect_start, is_https, &state).await
                }
                Err(e) => {
                    process_response(Err(e), &mut timings, start_time, connect_start, is_https, &state).await
                }
            }
        }
        _ = cancel_rx => {
            timings.total = start_time.elapsed().as_millis() as u64;
            *state.cancel_tx.lock().unwrap() = None;

            Ok(ApiResponse {
                success: false,
                data: None,
                status: None,
                status_text: Some("Cancelled".to_string()),
                headers: HashMap::new(),
                message: Some("Request was cancelled".to_string()),
                ttfb: None,
                size: None,
                timings,
                cancelled: Some(true),
            })
        }
    }
}

/// Process response and build ApiResponse
async fn process_response(
    result: Result<Response, reqwest::Error>,
    timings: &mut RequestTimings,
    start_time: Instant,
    connect_start: Instant,
    is_https: bool,
    state: &State<'_, RequestState>,
) -> Result<ApiResponse, String> {
    match result {
        Ok(response) => {
            timings.first_byte = start_time.elapsed().as_millis() as u64;

            let status = response.status().as_u16();
            let status_text = response
                .status()
                .canonical_reason()
                .unwrap_or("Unknown")
                .to_string();

            let headers: HashMap<String, String> = response
                .headers()
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                .collect();

            let bytes = response.bytes().await.map_err(|e| e.to_string())?;
            let size = bytes.len();

            timings.download = start_time.elapsed().as_millis() as u64 - timings.first_byte;
            timings.total = start_time.elapsed().as_millis() as u64;

            // Estimate TCP and TLS timing from connection phase
            // Connection time = time from connect_start to first_byte minus server processing
            let connection_overhead = connect_start.elapsed().as_millis() as u64;
            if connection_overhead > 0 && timings.first_byte > 0 {
                // For HTTPS, split connection time between TCP and TLS (roughly 40/60 split typical)
                // For HTTP, all connection time is TCP
                if is_https {
                    // Estimate: TCP handshake is typically faster than TLS
                    let estimated_tcp = (connection_overhead as f64 * 0.35) as u64;
                    let estimated_tls = connection_overhead.saturating_sub(estimated_tcp);
                    if timings.tcp_connection == 0 {
                        timings.tcp_connection = estimated_tcp;
                    }
                    if timings.tls_handshake == 0 {
                        timings.tls_handshake = estimated_tls;
                    }
                } else if timings.tcp_connection == 0 {
                    timings.tcp_connection = connection_overhead;
                }
            }

            // Try to parse as JSON first, fall back to raw text
            let data: Option<serde_json::Value> = serde_json::from_slice(&bytes).ok();

            // If JSON parsing failed, store raw body as string in data field
            let data = if data.is_some() {
                data
            } else {
                match String::from_utf8(bytes.to_vec()) {
                    Ok(s) => Some(serde_json::Value::String(s)),
                    Err(_) => {
                        // Try lossy conversion as fallback
                        let lossy = String::from_utf8_lossy(&bytes).to_string();
                        Some(serde_json::Value::String(lossy))
                    }
                }
            };

            *state.cancel_tx.lock().unwrap() = None;

            Ok(ApiResponse {
                success: (200..300).contains(&status),
                data,
                status: Some(status),
                status_text: Some(status_text),
                headers,
                message: None,
                ttfb: Some(timings.first_byte),
                size: Some(size),
                timings: timings.clone(),
                cancelled: None,
            })
        }
        Err(e) => {
            timings.total = start_time.elapsed().as_millis() as u64;
            *state.cancel_tx.lock().unwrap() = None;

            // Provide specific error messages for common error types
            let message = if e.is_timeout() {
                "Request timed out. Try increasing the timeout in settings.".to_string()
            } else if e.is_connect() {
                "Connection failed. Check the URL and your network connection.".to_string()
            } else if e.is_request() {
                format!("Request error: {}", e)
            } else if e.is_redirect() {
                "Too many redirects.".to_string()
            } else if e.is_body() {
                "Error reading request body.".to_string()
            } else if e.is_decode() {
                "Error decoding response.".to_string()
            } else {
                format!("Request failed: {}", e)
            };

            Ok(ApiResponse {
                success: false,
                data: None,
                status: e.status().map(|s| s.as_u16()),
                status_text: None,
                headers: HashMap::new(),
                message: Some(message),
                ttfb: None,
                size: None,
                timings: timings.clone(),
                cancelled: None,
            })
        }
    }
}

#[tauri::command]
pub async fn cancel_api_request(
    state: State<'_, RequestState>,
) -> Result<serde_json::Value, String> {
    let mut cancel_tx = state.cancel_tx.lock().unwrap();
    if let Some(tx) = cancel_tx.take() {
        let _ = tx.send(());
        Ok(serde_json::json!({ "success": true, "message": "Request cancelled" }))
    } else {
        Ok(serde_json::json!({ "success": false, "message": "No active request to cancel" }))
    }
}
