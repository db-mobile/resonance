use hmac::{Hmac, Mac};
use reqwest::{Client, Method, RequestBuilder, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;
use tokio::net::TcpStream;
use tokio::sync::oneshot;
use tokio::time::timeout as tokio_timeout;
use uuid::Uuid;

use super::proxy::{ProxyAction, ProxyState};

/// Maximum time to spend on the TCP+TLS timing probe before giving up.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Dangerous cert verifier used only when the request has `verify_ssl: false`.
/// Kept in sync with reqwest's `danger_accept_invalid_certs(true)` behavior so
/// the probe does not fail on self-signed certs where the real request succeeds.
use super::tls::NoCertVerifier;

fn build_probe_tls_config(verify_ssl: bool) -> rustls::ClientConfig {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("rustls safe default protocol versions");

    if verify_ssl {
        let mut root_store = rustls::RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        builder
            .with_root_certificates(root_store)
            .with_no_client_auth()
    } else {
        builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoCertVerifier))
            .with_no_client_auth()
    }
}

/// Measure TCP and (for HTTPS) TLS handshake times against `host:port` via a
/// separate short-lived probe connection. Returns `(tcp_ms, tls_ms)`. Any error
/// is logged and reported as `None` — the caller must proceed regardless.
async fn measure_connection_timings(
    host: &str,
    port: u16,
    is_https: bool,
    verify_ssl: bool,
) -> (Option<u64>, Option<u64>) {
    let tcp_start = Instant::now();
    let connect_future = TcpStream::connect((host, port));
    let tcp_stream = match tokio_timeout(PROBE_TIMEOUT, connect_future).await {
        Ok(Ok(stream)) => stream,
        Ok(Err(e)) => {
            tracing::warn!("TCP timing probe failed for {}:{} - {}", host, port, e);
            return (None, None);
        }
        Err(_) => {
            tracing::warn!("TCP timing probe timed out for {}:{}", host, port);
            return (None, None);
        }
    };
    let tcp_ms = tcp_start.elapsed().as_millis() as u64;

    if !is_https {
        return (Some(tcp_ms), None);
    }

    let server_name = match rustls::pki_types::ServerName::try_from(host.to_string()) {
        Ok(name) => name,
        Err(e) => {
            tracing::warn!("Invalid TLS server name {} - {}", host, e);
            return (Some(tcp_ms), None);
        }
    };

    let config = build_probe_tls_config(verify_ssl);
    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));

    let tls_start = Instant::now();
    let tls_future = connector.connect(server_name, tcp_stream);
    let tls_ms = match tokio_timeout(PROBE_TIMEOUT, tls_future).await {
        Ok(Ok(_tls_stream)) => Some(tls_start.elapsed().as_millis() as u64),
        Ok(Err(e)) => {
            tracing::warn!("TLS timing probe failed for {} - {}", host, e);
            None
        }
        Err(_) => {
            tracing::warn!("TLS timing probe timed out for {}", host);
            None
        }
    };

    (Some(tcp_ms), tls_ms)
}

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

// ---------------------------------------------------------------------------
// AWS Signature Version 4
// ---------------------------------------------------------------------------

type HmacSha256 = Hmac<Sha256>;

/// Compute SHA-256 hex digest of arbitrary bytes.
fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// HMAC-SHA256 keyed hash, returns raw bytes.
fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC key length is always valid");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// AWS-compliant URI encoding per RFC 3986.
/// When `encode_slash` is true, '/' is also percent-encoded (used for query
/// params). When false, '/' is left as-is (used for URI paths).
fn aws_uri_encode(input: &str, encode_slash: bool) -> String {
    let mut encoded = String::with_capacity(input.len() * 2);
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-' | b'~' | b'.' => {
                encoded.push(byte as char);
            }
            b'/' => {
                if encode_slash {
                    encoded.push_str("%2F");
                } else {
                    encoded.push('/');
                }
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    encoded
}

/// Derive the AWS Signature V4 signing key.
fn aws_derive_signing_key(secret: &str, date: &str, region: &str, service: &str) -> Vec<u8> {
    let k_date = hmac_sha256(format!("AWS4{}", secret).as_bytes(), date.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    hmac_sha256(&k_service, b"aws4_request")
}

/// Build AWS Signature V4 headers for a request.
///
/// Returns a map of headers that must be added to the request:
/// `Authorization`, `x-amz-date`, `x-amz-content-sha256`, and optionally
/// `x-amz-security-token`.
fn build_aws_v4_headers(
    aws: &AwsAuthConfig,
    method: &str,
    url_str: &str,
    existing_headers: &HashMap<String, String>,
    body_bytes: &[u8],
) -> Result<HashMap<String, String>, String> {
    let parsed =
        url::Url::parse(url_str).map_err(|e| format!("Invalid URL for AWS signing: {}", e))?;

    let now = chrono::Utc::now();
    let date_stamp = now.format("%Y%m%d").to_string();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();

    let payload_hash = sha256_hex(body_bytes);

    // -- Collect headers that will be signed ----------------------------------
    let host = parsed.host_str().unwrap_or_default();
    let port = parsed.port();
    let host_header = match port {
        Some(p)
            if (parsed.scheme() == "https" && p != 443)
                || (parsed.scheme() == "http" && p != 80) =>
        {
            format!("{}:{}", host, p)
        }
        _ => host.to_string(),
    };

    let mut headers_to_sign: BTreeMap<String, String> = BTreeMap::new();
    headers_to_sign.insert("host".to_string(), host_header);
    headers_to_sign.insert("x-amz-date".to_string(), amz_date.clone());
    headers_to_sign.insert("x-amz-content-sha256".to_string(), payload_hash.clone());

    if let Some(token) = &aws.session_token {
        if !token.is_empty() {
            headers_to_sign.insert("x-amz-security-token".to_string(), token.clone());
        }
    }

    // Include user-supplied headers that are not already covered
    for (k, v) in existing_headers {
        let lower = k.to_lowercase();
        headers_to_sign
            .entry(lower)
            .or_insert_with(|| v.trim().to_string());
    }

    // -- Step 1: Canonical Request --------------------------------------------
    let canonical_uri = if parsed.path().is_empty() {
        "/".to_string()
    } else {
        parsed.path().to_string()
    };

    // Canonical query string: sorted by key then value
    let mut query_pairs: Vec<(String, String)> = parsed
        .query_pairs()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    query_pairs.sort();
    let canonical_querystring: String = query_pairs
        .iter()
        .map(|(k, v)| format!("{}={}", aws_uri_encode(k, true), aws_uri_encode(v, true)))
        .collect::<Vec<_>>()
        .join("&");

    let canonical_headers: String = headers_to_sign
        .iter()
        .map(|(k, v)| format!("{}:{}", k, v))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";

    let signed_headers: String = headers_to_sign
        .keys()
        .cloned()
        .collect::<Vec<_>>()
        .join(";");

    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        method.to_uppercase(),
        canonical_uri,
        canonical_querystring,
        canonical_headers,
        signed_headers,
        payload_hash
    );

    // -- Step 2: String to Sign -----------------------------------------------
    let credential_scope = format!("{}/{}/{}/aws4_request", date_stamp, aws.region, aws.service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date,
        credential_scope,
        sha256_hex(canonical_request.as_bytes())
    );

    // -- Step 3 & 4: Signing key + signature ----------------------------------
    let signing_key = aws_derive_signing_key(
        &aws.secret_access_key,
        &date_stamp,
        &aws.region,
        &aws.service,
    );
    let signature = hex::encode(hmac_sha256(&signing_key, string_to_sign.as_bytes()));

    // -- Build output headers -------------------------------------------------
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        aws.access_key_id, credential_scope, signed_headers, signature
    );

    let mut out: HashMap<String, String> = HashMap::new();
    out.insert("Authorization".to_string(), authorization);
    out.insert("x-amz-date".to_string(), amz_date);
    out.insert("x-amz-content-sha256".to_string(), payload_hash);
    if let Some(token) = &aws.session_token {
        if !token.is_empty() {
            out.insert("x-amz-security-token".to_string(), token.clone());
        }
    }

    Ok(out)
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
    /// Whether to verify SSL certificates (defaults to true)
    #[serde(default)]
    pub verify_ssl: Option<bool>,
    /// Whether to follow HTTP redirects (defaults to true)
    #[serde(default)]
    pub follow_redirects: Option<bool>,
    /// Body encoding type: "json" (default) | "formdata" | "urlencoded" | "text" | "binary"
    #[serde(default)]
    pub body_type: Option<String>,
    /// AWS Signature V4 authentication configuration
    #[serde(default)]
    pub aws_auth: Option<AwsAuthConfig>,
    /// Client certificate (mTLS) and custom CA configuration, resolved by host
    #[serde(default)]
    pub client_cert: Option<ClientCertConfig>,
}

/// One row of a "formdata" or "urlencoded" body sent as a JSON array.
///
/// Text rows carry `value`; file rows (`type: "file"`, formdata only) carry
/// `file_path` and an optional per-part `content_type`. Disabled rows are
/// filtered out by the frontend and never reach the backend. The legacy flat
/// `{key: value}` object shape is still accepted by the body-building code.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormPart {
    pub key: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(rename = "type", default)]
    pub part_type: Option<String>,
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub content_type: Option<String>,
}

/// Body payload for `body_type: "binary"`: a file sent verbatim as the request
/// body. Only the path travels over IPC; bytes are read here at send time.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryBody {
    pub file_path: String,
    #[serde(default)]
    pub content_type: Option<String>,
}

/// Read a request-body file from disk with a user-facing error message.
/// Called inside `build_request`, so the file is re-read (not replayed) if the
/// request is rebuilt for the digest-auth retry.
fn read_body_file(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("Failed to read file '{}': {}", path, e))
}

/// Build a multipart form from an array of [`FormPart`] rows (text and file parts).
fn build_multipart_form(rows: &[serde_json::Value]) -> Result<reqwest::multipart::Form, String> {
    let mut form = reqwest::multipart::Form::new();
    for row in rows {
        let part: FormPart = serde_json::from_value(row.clone())
            .map_err(|e| format!("Invalid form-data field: {}", e))?;
        if part.part_type.as_deref() == Some("file") {
            let path = part
                .file_path
                .as_deref()
                .filter(|p| !p.is_empty())
                .ok_or_else(|| format!("Form field '{}' has no file selected", part.key))?;
            let bytes = read_body_file(path)?;
            let file_name = std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string());
            let mime = part
                .content_type
                .as_deref()
                .filter(|c| !c.is_empty())
                .unwrap_or("application/octet-stream");
            let file_part = reqwest::multipart::Part::bytes(bytes)
                .file_name(file_name)
                .mime_str(mime)
                .map_err(|e| format!("Invalid content type '{}': {}", mime, e))?;
            form = form.part(part.key, file_part);
        } else {
            form = form.text(part.key, part.value.unwrap_or_default());
        }
    }
    Ok(form)
}

/// Flatten an array of form rows into ordered key/value pairs (urlencoded),
/// preserving duplicates and row order.
fn form_rows_to_pairs(rows: &[serde_json::Value]) -> Vec<(String, String)> {
    rows.iter()
        .filter_map(|row| serde_json::from_value::<FormPart>(row.clone()).ok())
        .map(|p| (p.key, p.value.unwrap_or_default()))
        .collect()
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
pub struct AwsAuthConfig {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
    pub service: String,
    #[serde(default)]
    pub session_token: Option<String>,
}

/// Client certificate (mutual TLS) and custom CA trust configuration.
///
/// All fields are filesystem paths to PEM-encoded files. Only paths are sent
/// from the frontend (the certificate store persists paths, never cert bytes);
/// the backend reads and parses the files here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCertConfig {
    /// PEM certificate chain to present to the server (mTLS).
    #[serde(default)]
    pub cert_path: Option<String>,
    /// PEM PKCS#8 private key (unencrypted) matching `cert_path`.
    #[serde(default)]
    pub key_path: Option<String>,
    /// PEM CA bundle used to verify the server's certificate chain.
    #[serde(default)]
    pub ca_path: Option<String>,
}

impl ClientCertConfig {
    /// Whether any certificate material is configured. Used to skip the TLS
    /// timing probe (which uses the default trust roots and no client auth and
    /// would otherwise fail/mislead against mTLS or private-CA endpoints).
    fn is_active(&self) -> bool {
        self.cert_path.as_deref().is_some_and(|p| !p.is_empty())
            || self.ca_path.as_deref().is_some_and(|p| !p.is_empty())
    }
}

/// Apply a [`ClientCertConfig`] to a reqwest [`ClientBuilder`]: load the client
/// identity (cert chain + key) for mTLS and add any custom CA roots. Returns a
/// descriptive error so the UI can surface load/parse failures instead of an
/// opaque TLS handshake error.
fn apply_client_cert(
    mut builder: reqwest::ClientBuilder,
    cert: &ClientCertConfig,
) -> Result<reqwest::ClientBuilder, String> {
    // Client identity (mTLS): requires both a cert chain and a private key.
    let cert_path = cert.cert_path.as_deref().filter(|p| !p.is_empty());
    let key_path = cert.key_path.as_deref().filter(|p| !p.is_empty());
    match (cert_path, key_path) {
        (Some(cert_path), Some(key_path)) => {
            let cert_pem = std::fs::read(cert_path).map_err(|e| {
                format!(
                    "Client certificate could not be read ({}): {}",
                    cert_path, e
                )
            })?;
            let key_pem = std::fs::read(key_path)
                .map_err(|e| format!("Client key could not be read ({}): {}", key_path, e))?;
            let mut pem = cert_pem;
            pem.push(b'\n');
            pem.extend_from_slice(&key_pem);
            let identity = reqwest::Identity::from_pem(&pem).map_err(|e| {
                format!(
                    "Client certificate could not be loaded (expects a PEM cert chain plus an unencrypted private key in PKCS#8, RSA, or SEC1 form): {}",
                    e
                )
            })?;
            builder = builder.identity(identity);
        }
        (Some(_), None) | (None, Some(_)) => {
            return Err(
                "Client certificate requires both a certificate and a key file".to_string(),
            );
        }
        (None, None) => {}
    }

    // Custom CA trust: add each CA in the bundle to the default roots.
    if let Some(ca_path) = cert.ca_path.as_deref().filter(|p| !p.is_empty()) {
        let ca_pem = std::fs::read(ca_path)
            .map_err(|e| format!("CA certificate could not be read ({}): {}", ca_path, e))?;
        let cas = reqwest::Certificate::from_pem_bundle(&ca_pem)
            .map_err(|e| format!("CA certificate could not be parsed ({}): {}", ca_path, e))?;
        for ca in cas {
            builder = builder.add_root_certificate(ca);
        }
    }

    Ok(builder)
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
    /// All Set-Cookie header values preserved as a list (the headers map collapses duplicates)
    pub set_cookies: Vec<String>,
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
            set_cookies: vec![],
            message: Some("URL is empty. Please enter a valid URL.".to_string()),
            ttfb: None,
            size: None,
            timings,
            cancelled: None,
        });
    }

    // Parse URL and measure DNS + TCP + TLS timings via a short-lived probe
    // connection. The probe uses a separate TCP (and optional TLS) handshake
    // ahead of the real reqwest call, since reqwest/hyper does not expose
    // per-stage connection timings. Probe results are best-effort: any failure
    // is logged and the affected field stays at 0.
    // Probe is skipped when a proxy is active — measuring through a CONNECT
    // tunnel would require reimplementing proxy auth, which is out of scope.
    let parsed_url = url::Url::parse(&request_options.url).ok();
    let is_https = request_options.url.starts_with("https://");
    // Resolve the proxy decision once: used below to skip the timing probe and
    // again when building the reqwest client.
    let proxy_action = proxy_state.get_proxy_config(&request_options.url);
    // Skip the timing probe through a proxy (would require CONNECT-tunnel auth)
    // and when client-cert/custom-CA material is configured (the probe uses the
    // default trust roots and no client auth, so it would fail or mislead).
    let client_cert_active = request_options
        .client_cert
        .as_ref()
        .is_some_and(ClientCertConfig::is_active);
    let skip_probe = !matches!(proxy_action, ProxyAction::Disable) || client_cert_active;

    if let Some(ref url) = parsed_url {
        if let Some(host) = url.host_str() {
            let port = url
                .port_or_known_default()
                .unwrap_or(if is_https { 443 } else { 80 });
            let lookup_addr = format!("{}:{}", host, port);

            let dns_start = Instant::now();
            let _ = tokio::net::lookup_host(&lookup_addr).await;
            timings.dns_lookup = dns_start.elapsed().as_millis() as u64;

            if !skip_probe {
                let verify_ssl = request_options.verify_ssl != Some(false);
                let (tcp_ms, tls_ms) =
                    measure_connection_timings(host, port, is_https, verify_ssl).await;
                timings.tcp_connection = tcp_ms.unwrap_or(0);
                timings.tls_handshake = tls_ms.unwrap_or(0);
            }
        }
    }

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

    // Disable SSL verification if requested (e.g. for self-signed certs in dev)
    if request_options.verify_ssl == Some(false) {
        client_builder = client_builder.danger_accept_invalid_certs(true);
    }

    // Apply client certificate (mTLS) and/or custom CA trust resolved for this host.
    if let Some(client_cert) = &request_options.client_cert {
        match apply_client_cert(client_builder, client_cert) {
            Ok(b) => client_builder = b,
            Err(message) => {
                return Ok(ApiResponse {
                    success: false,
                    data: None,
                    status: None,
                    status_text: None,
                    headers: HashMap::new(),
                    set_cookies: vec![],
                    message: Some(message),
                    ttfb: None,
                    size: None,
                    timings,
                    cancelled: None,
                });
            }
        }
    }

    // Disable redirect following if requested
    if request_options.follow_redirects == Some(false) {
        client_builder = client_builder.redirect(reqwest::redirect::Policy::none());
    }

    // Apply proxy decision resolved earlier. `Disable` must call `no_proxy()`
    // explicitly — otherwise reqwest would still honour HTTP(S)_PROXY env vars
    // and platform settings by default.
    match proxy_action {
        ProxyAction::Disable => {
            client_builder = client_builder.no_proxy();
        }
        ProxyAction::UseSystem => {
            // reqwest auto-detects system proxy; nothing to configure.
        }
        ProxyAction::Manual(proxy) => {
            client_builder = client_builder.proxy(*proxy);
        }
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
                set_cookies: vec![],
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

    // Extract body_type before the closure to avoid borrow issues
    let body_type = request_options
        .body_type
        .as_deref()
        .unwrap_or("json")
        .to_string();

    // Detect whether the user already supplied a Content-Type header
    let user_has_content_type = request_options
        .headers
        .as_ref()
        .map(|h| h.keys().any(|k| k.to_lowercase() == "content-type"))
        .unwrap_or(false);

    // Compute AWS Signature V4 headers if configured.
    // This must happen before building the request because the signature covers
    // the method, URL, headers, and body hash.
    let aws_headers: Option<HashMap<String, String>> = if let Some(aws) = &request_options.aws_auth
    {
        // For "binary" the signature must cover the actual file bytes. For
        // "formdata" the multipart boundary is generated per send, so a correct
        // signature is not possible here (pre-existing limitation); other body
        // types keep the historical JSON serialization.
        let body_bytes = match &request_options.body {
            Some(b) if request_options.body_type.as_deref() == Some("binary") => {
                let binary: BinaryBody = serde_json::from_value(b.clone())
                    .map_err(|e| format!("Invalid binary body: {}", e))?;
                read_body_file(&binary.file_path)?
            }
            Some(b) => serde_json::to_vec(b).unwrap_or_default(),
            None => Vec::new(),
        };
        let existing = request_options.headers.clone().unwrap_or_default();
        Some(build_aws_v4_headers(
            aws,
            &request_options.method,
            &request_options.url,
            &existing,
            &body_bytes,
        )?)
    } else {
        None
    };

    // Helper to build a request. Returns Result so body-file read errors
    // surface as clean command errors; called again for the digest-auth retry,
    // which re-reads any file-backed body from disk.
    let build_request = |auth_header: Option<String>| -> Result<RequestBuilder, String> {
        let mut rb = client.request(method.clone(), &request_options.url);
        if let Some(headers) = &request_options.headers {
            for (key, value) in headers {
                // Skip Content-Type for form modes — reqwest sets it automatically
                if (body_type == "formdata" || body_type == "urlencoded")
                    && key.to_lowercase() == "content-type"
                {
                    continue;
                }
                rb = rb.header(key, value);
            }
        }
        // Apply AWS Signature V4 headers (Authorization, x-amz-date, etc.)
        if let Some(ref aws_hdrs) = aws_headers {
            for (key, value) in aws_hdrs {
                rb = rb.header(key, value);
            }
        }
        match body_type.as_str() {
            "urlencoded" => {
                if let Some(body) = &request_options.body {
                    if let Some(rows) = body.as_array() {
                        let pairs = form_rows_to_pairs(rows);
                        rb = rb.form(&pairs);
                    } else if let Some(obj) = body.as_object() {
                        // Legacy flat-object shape from older persisted data
                        let pairs: Vec<(String, String)> = obj
                            .iter()
                            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                            .collect();
                        rb = rb.form(&pairs);
                    }
                }
            }
            "formdata" => {
                if let Some(body) = &request_options.body {
                    if let Some(rows) = body.as_array() {
                        rb = rb.multipart(build_multipart_form(rows)?);
                    } else if let Some(obj) = body.as_object() {
                        // Legacy flat-object shape from older persisted data
                        let mut form = reqwest::multipart::Form::new();
                        for (k, v) in obj {
                            form = form.text(k.clone(), v.as_str().unwrap_or("").to_string());
                        }
                        rb = rb.multipart(form);
                    }
                }
            }
            "binary" => {
                if let Some(body) = &request_options.body {
                    let binary: BinaryBody = serde_json::from_value(body.clone())
                        .map_err(|e| format!("Invalid binary body: {}", e))?;
                    let bytes = read_body_file(&binary.file_path)?;
                    rb = rb.body(bytes);
                    if !user_has_content_type {
                        rb = rb.header(
                            "Content-Type",
                            binary
                                .content_type
                                .as_deref()
                                .filter(|c| !c.is_empty())
                                .unwrap_or("application/octet-stream"),
                        );
                    }
                }
            }
            "text" => {
                if let Some(body) = &request_options.body {
                    let raw = body.as_str().unwrap_or("").to_string();
                    rb = rb.body(raw);
                    if !user_has_content_type {
                        rb = rb.header("Content-Type", "text/plain");
                    }
                }
            }
            _ => {
                if let Some(body) = &request_options.body {
                    rb = rb.json(body);
                }
            }
        }
        if let Some(auth) = auth_header {
            rb = rb.header("Authorization", auth);
        }
        Ok(rb)
    };

    // Execute request with cancellation support
    let request_future = build_request(None)?.send();

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
                                                let retry_result = build_request(Some(auth_header))?.send().await;
                                                return process_response(retry_result, &mut timings, start_time, &state).await;
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

                    process_response(Ok(response), &mut timings, start_time, &state).await
                }
                Err(e) => {
                    process_response(Err(e), &mut timings, start_time, &state).await
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
                set_cookies: vec![],
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

            // Extract Set-Cookie headers before collapsing into a HashMap (HashMap drops duplicates)
            let set_cookies: Vec<String> = response
                .headers()
                .get_all("set-cookie")
                .iter()
                .filter_map(|v| v.to_str().ok())
                .map(|s| s.to_string())
                .collect();

            let headers: HashMap<String, String> = response
                .headers()
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                .collect();

            let bytes = response.bytes().await.map_err(|e| e.to_string())?;
            let size = bytes.len();

            timings.download = start_time.elapsed().as_millis() as u64 - timings.first_byte;
            timings.total = start_time.elapsed().as_millis() as u64;

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
                set_cookies,
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
                set_cookies: vec![],
                message: Some(message),
                ttfb: None,
                size: None,
                timings: timings.clone(),
                cancelled: None,
            })
        }
    }
}

/// Open a file dialog to select a file for a request body (multipart file part
/// or raw binary body). Returns the chosen path, or `None` if cancelled.
/// Mirrors [`grpc_select_proto_file`](super::grpc_proto::grpc_select_proto_file)
/// but without an extension filter.
#[tauri::command]
pub async fn pick_upload_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};

    let (tx, rx) = oneshot::channel();

    app.dialog().file().pick_file(move |file_path| {
        let result = file_path.map(|fp| match fp {
            FilePath::Path(p) => p.to_string_lossy().to_string(),
            FilePath::Url(u) => u.path().to_string(),
        });
        let _ = tx.send(result);
    });

    rx.await.map_err(|e| format!("Dialog error: {}", e))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_cert_config_deserializes_camel_case() {
        let json = serde_json::json!({
            "certPath": "/certs/client.crt",
            "keyPath": "/certs/client.key",
            "caPath": "/certs/ca.pem",
        });
        let cfg: ClientCertConfig = serde_json::from_value(json).unwrap();
        assert_eq!(cfg.cert_path.as_deref(), Some("/certs/client.crt"));
        assert_eq!(cfg.key_path.as_deref(), Some("/certs/client.key"));
        assert_eq!(cfg.ca_path.as_deref(), Some("/certs/ca.pem"));
    }

    #[test]
    fn is_active_reflects_cert_or_ca_presence() {
        let empty = ClientCertConfig {
            cert_path: None,
            key_path: None,
            ca_path: Some(String::new()),
        };
        assert!(!empty.is_active());

        let with_cert = ClientCertConfig {
            cert_path: Some("/certs/client.crt".into()),
            key_path: Some("/certs/client.key".into()),
            ca_path: None,
        };
        assert!(with_cert.is_active());

        let ca_only = ClientCertConfig {
            cert_path: None,
            key_path: None,
            ca_path: Some("/certs/ca.pem".into()),
        };
        assert!(ca_only.is_active());
    }

    #[test]
    fn form_part_deserializes_camel_case_rows() {
        let json = serde_json::json!({
            "key": "avatar",
            "type": "file",
            "filePath": "/tmp/pic.png",
            "contentType": "image/png"
        });
        let part: FormPart = serde_json::from_value(json).unwrap();
        assert_eq!(part.key, "avatar");
        assert_eq!(part.part_type.as_deref(), Some("file"));
        assert_eq!(part.file_path.as_deref(), Some("/tmp/pic.png"));
        assert_eq!(part.content_type.as_deref(), Some("image/png"));
        assert!(part.value.is_none());
    }

    #[test]
    fn form_part_defaults_optional_fields() {
        let json = serde_json::json!({ "key": "title", "value": "hello" });
        let part: FormPart = serde_json::from_value(json).unwrap();
        assert_eq!(part.value.as_deref(), Some("hello"));
        assert!(part.part_type.is_none());
        assert!(part.file_path.is_none());
        assert!(part.content_type.is_none());
    }

    #[test]
    fn binary_body_deserializes_camel_case() {
        let json =
            serde_json::json!({ "filePath": "/tmp/a.bin", "contentType": "application/pdf" });
        let body: BinaryBody = serde_json::from_value(json).unwrap();
        assert_eq!(body.file_path, "/tmp/a.bin");
        assert_eq!(body.content_type.as_deref(), Some("application/pdf"));

        let minimal: BinaryBody =
            serde_json::from_value(serde_json::json!({ "filePath": "/f" })).unwrap();
        assert!(minimal.content_type.is_none());
    }

    #[test]
    fn build_multipart_form_mixes_text_and_file_parts() {
        let dir = std::env::temp_dir().join(format!("resonance-upload-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("payload.txt");
        std::fs::write(&file_path, b"file-bytes").unwrap();

        let rows = vec![
            serde_json::json!({ "key": "title", "value": "hello", "type": "text" }),
            serde_json::json!({
                "key": "doc",
                "type": "file",
                "filePath": file_path.to_str().unwrap(),
                "contentType": "text/plain"
            }),
        ];
        let form = build_multipart_form(&rows).unwrap();
        assert!(!form.boundary().is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn build_multipart_form_reports_missing_file() {
        let rows = vec![serde_json::json!({
            "key": "doc",
            "type": "file",
            "filePath": "/nonexistent/upload.bin"
        })];
        let err = build_multipart_form(&rows).unwrap_err();
        assert!(err.contains("Failed to read file '/nonexistent/upload.bin'"));
    }

    #[test]
    fn build_multipart_form_requires_path_for_file_parts() {
        let rows = vec![serde_json::json!({ "key": "doc", "type": "file" })];
        let err = build_multipart_form(&rows).unwrap_err();
        assert!(err.contains("has no file selected"));
    }

    #[test]
    fn form_rows_to_pairs_preserves_order_and_duplicates() {
        let rows = vec![
            serde_json::json!({ "key": "a", "value": "1" }),
            serde_json::json!({ "key": "a", "value": "2" }),
            serde_json::json!({ "key": "b", "value": "3" }),
        ];
        let pairs = form_rows_to_pairs(&rows);
        assert_eq!(
            pairs,
            vec![
                ("a".to_string(), "1".to_string()),
                ("a".to_string(), "2".to_string()),
                ("b".to_string(), "3".to_string()),
            ]
        );
    }

    #[test]
    fn apply_client_cert_requires_both_cert_and_key() {
        let cfg = ClientCertConfig {
            cert_path: Some("/certs/client.crt".into()),
            key_path: None,
            ca_path: None,
        };
        let err = apply_client_cert(Client::builder(), &cfg).unwrap_err();
        assert!(err.contains("both a certificate and a key"));
    }

    #[test]
    fn apply_client_cert_reports_missing_file() {
        let cfg = ClientCertConfig {
            cert_path: Some("/nonexistent/client.crt".into()),
            key_path: Some("/nonexistent/client.key".into()),
            ca_path: None,
        };
        let err = apply_client_cert(Client::builder(), &cfg).unwrap_err();
        assert!(err.contains("could not be read"));
    }

    #[test]
    fn apply_client_cert_noop_when_empty() {
        let cfg = ClientCertConfig {
            cert_path: None,
            key_path: None,
            ca_path: None,
        };
        // Should succeed and leave the builder usable.
        let builder = apply_client_cert(Client::builder(), &cfg).unwrap();
        assert!(builder.build().is_ok());
    }

    /// End-to-end check that the production loader parses real PEM material:
    /// generate a self-signed cert + unencrypted PKCS#8 key with `openssl`, then
    /// assert the client identity and a custom CA both load and build a client.
    /// Skipped automatically when `openssl` is unavailable.
    #[test]
    fn apply_client_cert_loads_real_pem_material() {
        use std::process::Command;

        let openssl_ok = Command::new("openssl")
            .arg("version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !openssl_ok {
            eprintln!("skipping apply_client_cert_loads_real_pem_material: openssl not available");
            return;
        }

        let dir = std::env::temp_dir().join(format!("resonance-mtls-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let cert_path = dir.join("cert.pem");
        let key_path = dir.join("key.pem");

        // Self-signed cert with an unencrypted PKCS#8 EC key (-nodes).
        let status = Command::new("openssl")
            .args([
                "req",
                "-x509",
                "-newkey",
                "ec",
                "-pkeyopt",
                "ec_paramgen_curve:prime256v1",
                "-nodes",
                "-keyout",
                key_path.to_str().unwrap(),
                "-out",
                cert_path.to_str().unwrap(),
                "-days",
                "1",
                "-subj",
                "/CN=resonance-mtls-test",
            ])
            .output()
            .expect("run openssl");
        assert!(
            status.status.success(),
            "openssl failed: {}",
            String::from_utf8_lossy(&status.stderr)
        );

        // Client identity (cert chain + key) loads and builds.
        let identity_cfg = ClientCertConfig {
            cert_path: Some(cert_path.to_string_lossy().into()),
            key_path: Some(key_path.to_string_lossy().into()),
            ca_path: None,
        };
        let builder = apply_client_cert(Client::builder(), &identity_cfg)
            .expect("client identity should load from real PEM");
        assert!(builder.build().is_ok());

        // The same self-signed cert is a valid single-entry CA bundle.
        let ca_cfg = ClientCertConfig {
            cert_path: None,
            key_path: None,
            ca_path: Some(cert_path.to_string_lossy().into()),
        };
        let builder = apply_client_cert(Client::builder(), &ca_cfg)
            .expect("custom CA should load from real PEM");
        assert!(builder.build().is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
