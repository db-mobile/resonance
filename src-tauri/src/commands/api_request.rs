use hmac::{Hmac, Mac};
use reqwest::{Method, RequestBuilder, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;
use tokio::sync::oneshot;
use uuid::Uuid;

use super::http_client::{build_http_client, HttpClientOptions};
use super::proxy::ProxyState;
use super::timing::TimingRecorder;

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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

/// Phase breakdown of a request, all measured on the connection the request
/// actually used.
///
/// Durations are fractional milliseconds: sub-millisecond phases are normal
/// against localhost, and whole milliseconds would report them as zero. `None`
/// means the phase was not measured, which is distinct from a measured zero —
/// a reused connection performs no connect, and a SOCKS proxy resolves names
/// remotely so the local resolver never runs.
///
/// TCP and TLS are reported together as `connect`: reqwest nests its TCP
/// connector inside the TLS connector with no hook between them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestTimings {
    /// Unix milliseconds at which the command was entered.
    pub start_time: u64,
    pub dns: Option<f64>,
    pub connect: Option<f64>,
    /// Server think time: TTFB less the phases that preceded it.
    pub waiting: Option<f64>,
    pub download: f64,
    pub total: f64,
    /// Connections opened. Above one means redirects or an auth retry, and the
    /// phases above are their sum rather than a single connection's.
    pub connect_count: u32,
}

impl RequestTimings {
    /// A breakdown for a request that never got far enough to measure phases.
    fn unmeasured(start_time: u64) -> Self {
        Self {
            start_time,
            dns: None,
            connect: None,
            waiting: None,
            download: 0.0,
            total: 0.0,
            connect_count: 0,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    /// True when the response body was not valid UTF-8 and is carried in
    /// `body_base64` instead of `data` (so binary downloads survive intact).
    #[serde(default)]
    pub is_binary: bool,
    /// Base64-encoded raw body, present only when `is_binary` is true.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_base64: Option<String>,
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

/// Extract the `charset` parameter from a Content-Type header value.
fn charset_from_content_type(content_type: &str) -> Option<&str> {
    content_type.split(';').skip(1).find_map(|param| {
        let (name, value) = param.split_once('=')?;
        if !name.trim().eq_ignore_ascii_case("charset") {
            return None;
        }
        Some(value.trim().trim_matches('"'))
    })
}

/// True when a Content-Type describes a body meant to be read as text.
fn content_type_is_textual(content_type: &str) -> bool {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    mime.starts_with("text/")
        || mime.ends_with("+json")
        || mime.ends_with("+xml")
        || mime.ends_with("+yaml")
        || matches!(
            mime.as_str(),
            "application/json"
                | "application/xml"
                | "application/javascript"
                | "application/ecmascript"
                | "application/x-javascript"
                | "application/graphql"
                | "application/yaml"
                | "application/x-yaml"
                | "application/x-ndjson"
                | "application/x-www-form-urlencoded"
        )
}

/// Decode a body that is not valid UTF-8 using the charset the server declared.
///
/// Servers still serve legacy encodings (`text/html; charset=ISO-8859-1`), whose
/// high bytes are not valid UTF-8; decoding them per the declared label is what
/// browsers do. Textual bodies with no usable charset fall back to windows-1252,
/// the legacy default, since every byte maps to a character there. Anything else
/// stays binary.
fn decode_with_declared_charset(bytes: &[u8], content_type: Option<&str>) -> Option<String> {
    let content_type = content_type?;
    let textual = content_type_is_textual(content_type);
    let encoding = match charset_from_content_type(content_type)
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
    {
        Some(encoding) => encoding,
        None if textual => encoding_rs::WINDOWS_1252,
        None => return None,
    };

    let (text, _, had_errors) = encoding.decode(bytes);
    if had_errors && !textual {
        return None;
    }
    Some(text.into_owned())
}

/// Decode a raw response body into the fields carried by [`ApiResponse`].
///
/// A body that parses as JSON becomes a JSON value; other valid UTF-8 becomes a
/// string; a body in the legacy charset declared by `content_type` is decoded to
/// a string through that charset. Anything left is preserved base64-encoded in
/// the third element (with `is_binary` true and `data` `None`) instead of being
/// lossily mangled, so binary downloads survive intact and can be saved
/// byte-for-byte.
fn decode_response_body(
    bytes: &[u8],
    content_type: Option<&str>,
) -> (Option<serde_json::Value>, bool, Option<String>) {
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) {
        return (Some(value), false, None);
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return (
            Some(serde_json::Value::String(text.to_string())),
            false,
            None,
        );
    }
    if let Some(text) = decode_with_declared_charset(bytes, content_type) {
        return (Some(serde_json::Value::String(text)), false, None);
    }

    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use base64::Engine;
    (None, true, Some(BASE64_STANDARD.encode(bytes)))
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

    let start_timestamp = chrono::Utc::now().timestamp_millis() as u64;
    let mut timings = RequestTimings::unmeasured(start_timestamp);

    // Validate URL
    if request_options.url.is_empty() {
        return Ok(ApiResponse {
            success: false,
            data: None,
            is_binary: false,
            body_base64: None,
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

    let proxy_action = proxy_state.get_proxy_config(&request_options.url);

    // Collects DNS and connect timings from the connection this request opens.
    // Proxied and mTLS requests need no special handling: the connector layer
    // times whatever connection reqwest actually establishes.
    let recorder = TimingRecorder::new();

    // Timeout from request options: None means no timeout, Some(0) also means no timeout.
    let timeout = request_options
        .timeout
        .filter(|ms| *ms > 0)
        .map(Duration::from_millis);

    let client_options = HttpClientOptions {
        user_agent: format!("resonance/{}", env!("CARGO_PKG_VERSION")),
        timeout,
        connect_timeout: None,
        http_version: request_options.http_version.clone(),
        verify_ssl: request_options.verify_ssl != Some(false),
        client_cert: request_options.client_cert.clone(),
        follow_redirects: request_options.follow_redirects != Some(false),
        disable_pooling: false,
        timing_recorder: Some(Arc::clone(&recorder)),
    };

    let client = match build_http_client(client_options, proxy_action) {
        Ok(client) => client,
        Err(message) => {
            return Ok(ApiResponse {
                success: false,
                data: None,
                is_binary: false,
                body_base64: None,
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

    // A file-backed body is read once, here, and the same bytes are used for
    // both the AWS signature and the request itself. Reading it a second time
    // when building the request would leave a window in which the file changes
    // between signing and sending, producing a signature that does not match
    // the payload.
    let binary_body_bytes: Option<Vec<u8>> = match &request_options.body {
        Some(b) if body_type == "binary" => {
            let binary: BinaryBody = serde_json::from_value(b.clone())
                .map_err(|e| format!("Invalid binary body: {}", e))?;
            Some(read_body_file(&binary.file_path)?)
        }
        _ => None,
    };

    // Compute AWS Signature V4 headers if configured.
    // This must happen before building the request because the signature covers
    // the method, URL, headers, and body hash.
    let aws_headers: Option<HashMap<String, String>> = if let Some(aws) = &request_options.aws_auth
    {
        // For "binary" the signature covers the actual file bytes. For
        // "formdata" the multipart boundary is generated per send, so a correct
        // signature is not possible here (pre-existing limitation); other body
        // types keep the historical JSON serialization.
        let body_bytes = match (&binary_body_bytes, &request_options.body) {
            (Some(bytes), _) => bytes.clone(),
            (None, Some(b)) => serde_json::to_vec(b).unwrap_or_default(),
            (None, None) => Vec::new(),
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

    // Helper to build a request. Returns Result so body-decode errors surface
    // as clean command errors; called again for the digest-auth retry, which
    // reuses the bytes read before signing rather than re-reading the file.
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
                    let bytes = binary_body_bytes.clone().unwrap_or_default();
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

    // The clock starts here rather than at command entry so the total covers
    // the request alone. Client assembly and body preparation are not phases
    // the breakdown can attribute, and counting them would leave the waterfall
    // segments summing to less than the total.
    let start_time = Instant::now();

    // Execute request with cancellation support
    let request_future = build_request(None)?.send();

    tokio::select! {
        result = request_future => {
            match result {
                Ok(response) => {
                    // Check for 401 with Digest challenge - retry with auth if credentials provided.
                    // A challenge we cannot answer (an unsupported algorithm, say) is reported on
                    // the 401 we return, so the user sees why the credentials were never sent
                    // rather than a bare 401.
                    let mut digest_error: Option<String> = None;
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
                                                return process_response(retry_result, &mut timings, start_time, &recorder, &state).await;
                                            }
                                            Err(e) => {
                                                digest_error = Some(e);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    let mut api_response =
                        process_response(Ok(response), &mut timings, start_time, &recorder, &state).await?;
                    if let Some(e) = digest_error {
                        api_response.message =
                            Some(format!("Digest authentication failed: {}", e));
                    }
                    Ok(api_response)
                }
                Err(e) => {
                    process_response(Err(e), &mut timings, start_time, &recorder, &state).await
                }
            }
        }
        _ = cancel_rx => {
            timings.total = elapsed_millis(start_time);
            let snapshot = recorder.snapshot();
            timings.dns = snapshot.dns;
            timings.connect = snapshot.connect;
            timings.connect_count = snapshot.connect_count;
            *state.cancel_tx.lock().unwrap() = None;

            Ok(ApiResponse {
                success: false,
                data: None,
                is_binary: false,
                body_base64: None,
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

/// Elapsed time as fractional milliseconds, so sub-millisecond phases against
/// a local server are not truncated away.
fn elapsed_millis(since: Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}

/// Apply the phases collected on the request's own connection, splitting TTFB
/// into what the connection cost and what the server spent thinking.
fn apply_connection_phases(timings: &mut RequestTimings, recorder: &TimingRecorder, ttfb_ms: f64) {
    let snapshot = recorder.snapshot();
    let measured = snapshot.dns.unwrap_or(0.0) + snapshot.connect.unwrap_or(0.0);

    timings.dns = snapshot.dns;
    timings.connect = snapshot.connect;
    timings.connect_count = snapshot.connect_count;
    timings.waiting = Some((ttfb_ms - measured).max(0.0));
}

/// Process response and build ApiResponse
async fn process_response(
    result: Result<Response, reqwest::Error>,
    timings: &mut RequestTimings,
    start_time: Instant,
    recorder: &TimingRecorder,
    state: &State<'_, RequestState>,
) -> Result<ApiResponse, String> {
    match result {
        Ok(response) => {
            let ttfb_ms = elapsed_millis(start_time);
            apply_connection_phases(timings, recorder, ttfb_ms);

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

            timings.total = elapsed_millis(start_time);
            timings.download = (timings.total - ttfb_ms).max(0.0);

            let (data, is_binary, body_base64) =
                decode_response_body(&bytes, headers.get("content-type").map(String::as_str));

            *state.cancel_tx.lock().unwrap() = None;

            Ok(ApiResponse {
                success: (200..300).contains(&status),
                data,
                is_binary,
                body_base64,
                status: Some(status),
                status_text: Some(status_text),
                headers,
                set_cookies,
                message: None,
                ttfb: Some(ttfb_ms.round() as u64),
                size: Some(size),
                timings: timings.clone(),
                cancelled: None,
            })
        }
        Err(e) => {
            timings.total = elapsed_millis(start_time);
            // Whatever phases completed before the failure are still real, but
            // there is no first byte to derive a waiting phase from.
            let snapshot = recorder.snapshot();
            timings.dns = snapshot.dns;
            timings.connect = snapshot.connect;
            timings.connect_count = snapshot.connect_count;
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
                is_binary: false,
                body_base64: None,
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

/// Save a response body to a file the user picks in a native save dialog. The
/// body is passed base64-encoded so binary responses round-trip byte-for-byte.
/// Returns `{ success, cancelled?, filePath? }`.
#[tauri::command]
pub async fn save_response_body(
    app: tauri::AppHandle,
    default_file_name: String,
    base64_data: String,
) -> Result<serde_json::Value, String> {
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use base64::Engine;
    use tauri_plugin_dialog::{DialogExt, FilePath};

    let bytes = BASE64_STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("Invalid response data: {}", e))?;

    let (tx, rx) = oneshot::channel::<Option<FilePath>>();

    app.dialog()
        .file()
        .set_file_name(default_file_name)
        .save_file(move |file_path| {
            let _ = tx.send(file_path);
        });

    let file_path = rx.await.map_err(|e| format!("Dialog error: {}", e))?;

    let Some(path) = file_path else {
        return Ok(serde_json::json!({ "success": false, "cancelled": true }));
    };

    let file_path = path.as_path().ok_or("Invalid file path")?;
    std::fs::write(file_path, &bytes).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(serde_json::json!({
        "success": true,
        "filePath": file_path.to_string_lossy()
    }))
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

    fn digest_challenge(algorithm: &str) -> DigestChallenge {
        DigestChallenge {
            realm: "test-realm".to_string(),
            nonce: "abc123".to_string(),
            qop: Some("auth".to_string()),
            opaque: None,
            algorithm: algorithm.to_string(),
        }
    }

    #[test]
    fn digest_header_is_built_for_md5() {
        let header =
            build_digest_auth_header("user", "pass", "GET", "/api", &digest_challenge("MD5"))
                .expect("MD5 is supported");

        assert!(header.starts_with("Digest "));
        assert!(header.contains(r#"username="user""#));
        assert!(header.contains(r#"realm="test-realm""#));
        assert!(header.contains(r#"uri="/api""#));
        assert!(header.contains("algorithm=MD5"));
        assert!(header.contains("qop=auth"));
        assert!(!header.contains("pass"));
    }

    /// An unanswerable challenge must report why rather than be discarded — the
    /// caller turns this into the message on the returned 401.
    #[test]
    fn digest_header_rejects_an_unsupported_algorithm() {
        let err =
            build_digest_auth_header("user", "pass", "GET", "/api", &digest_challenge("SHA-256"))
                .expect_err("SHA-256 is not implemented");

        assert!(err.contains("Unsupported algorithm"), "got: {}", err);
        assert!(err.contains("SHA-256"), "got: {}", err);
    }

    fn aws_config() -> AwsAuthConfig {
        AwsAuthConfig {
            access_key_id: "AKIDEXAMPLE".to_string(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY".to_string(),
            region: "us-east-1".to_string(),
            service: "s3".to_string(),
            session_token: None,
        }
    }

    /// The signature commits to the payload, so the bytes handed to the signer
    /// must be the bytes that get sent. Signing two different bodies must not
    /// produce the same Authorization header.
    #[test]
    fn aws_signature_covers_the_body_bytes() {
        let headers = HashMap::new();
        let a = build_aws_v4_headers(
            &aws_config(),
            "PUT",
            "https://example.s3.amazonaws.com/key",
            &headers,
            b"first payload",
        )
        .expect("signing succeeds");
        let b = build_aws_v4_headers(
            &aws_config(),
            "PUT",
            "https://example.s3.amazonaws.com/key",
            &headers,
            b"second payload",
        )
        .expect("signing succeeds");

        assert_eq!(
            a.get("x-amz-content-sha256"),
            Some(&sha256_hex(b"first payload"))
        );
        assert_eq!(
            b.get("x-amz-content-sha256"),
            Some(&sha256_hex(b"second payload"))
        );
        assert_ne!(a.get("Authorization"), b.get("Authorization"));
    }

    #[test]
    fn aws_session_token_is_emitted_only_when_present() {
        let headers = HashMap::new();
        let without = build_aws_v4_headers(
            &aws_config(),
            "GET",
            "https://example.s3.amazonaws.com/key",
            &headers,
            b"",
        )
        .expect("signing succeeds");
        assert!(!without.contains_key("x-amz-security-token"));

        let with = build_aws_v4_headers(
            &AwsAuthConfig {
                session_token: Some("token-value".to_string()),
                ..aws_config()
            },
            "GET",
            "https://example.s3.amazonaws.com/key",
            &headers,
            b"",
        )
        .expect("signing succeeds");
        assert_eq!(
            with.get("x-amz-security-token"),
            Some(&"token-value".to_string())
        );
    }

    #[test]
    fn decode_response_body_parses_json() {
        let (data, is_binary, base64) = decode_response_body(br#"{"a":1}"#, None);
        assert_eq!(data, Some(serde_json::json!({ "a": 1 })));
        assert!(!is_binary);
        assert!(base64.is_none());
    }

    #[test]
    fn decode_response_body_keeps_plain_utf8_as_string() {
        let (data, is_binary, base64) = decode_response_body(b"hello, world", None);
        assert_eq!(
            data,
            Some(serde_json::Value::String("hello, world".to_string()))
        );
        assert!(!is_binary);
        assert!(base64.is_none());
    }

    #[test]
    fn decode_response_body_preserves_non_utf8_as_base64() {
        use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
        use base64::Engine;

        let raw = [0x89u8, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01];
        let (data, is_binary, base64) =
            decode_response_body(&raw, Some("application/octet-stream"));

        assert!(data.is_none());
        assert!(is_binary);
        let encoded = base64.expect("binary body should carry base64");
        let decoded = BASE64_STANDARD.decode(encoded.as_bytes()).unwrap();
        assert_eq!(decoded, raw, "base64 must round-trip the exact bytes");
    }

    #[test]
    fn decode_response_body_decodes_declared_latin1_html_as_text() {
        let raw = [b'G', b'r', b'u', 0xdf, b'e'];
        let (data, is_binary, base64) =
            decode_response_body(&raw, Some("text/html; charset=ISO-8859-1"));

        assert_eq!(data, Some(serde_json::Value::String("Gruße".to_string())));
        assert!(!is_binary, "declared legacy charsets are text, not binary");
        assert!(base64.is_none());
    }

    #[test]
    fn decode_response_body_decodes_textual_body_without_charset() {
        let raw = [b'c', b'a', b'f', 0xe9];
        let (data, is_binary, _) = decode_response_body(&raw, Some("text/plain"));

        assert_eq!(data, Some(serde_json::Value::String("café".to_string())));
        assert!(!is_binary);
    }

    #[test]
    fn decode_response_body_keeps_image_with_text_charset_binary() {
        let raw = [0x89u8, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01];
        let (_, is_binary, base64) = decode_response_body(&raw, Some("image/png"));

        assert!(is_binary);
        assert!(base64.is_some());
    }

    #[test]
    fn charset_from_content_type_reads_quoted_and_bare_labels() {
        assert_eq!(
            charset_from_content_type("text/html; charset=ISO-8859-1"),
            Some("ISO-8859-1")
        );
        assert_eq!(
            charset_from_content_type("text/html;charset=\"utf-8\""),
            Some("utf-8")
        );
        assert_eq!(charset_from_content_type("text/html"), None);
    }

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
}
