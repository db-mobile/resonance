//! Assembly of configured reqwest clients.
//!
//! This is deliberately separate from [`crate::commands::tls`]: `tls.rs` holds
//! rustls primitives (identity/CA loading, `ClientConfig` builders) for the
//! protocols that speak rustls directly — gRPC, MQTT, and the HTTP timing probe
//! — whereas this module assembles reqwest clients, which take the same
//! material through reqwest's own `identity`/`add_root_certificate` API.
//!
//! Both HTTP requests and SSE streams build their client here so the two stay
//! in step on TLS verification, client certificates, and proxying.

use reqwest::Client;
use std::time::Duration;

use super::api_request::ClientCertConfig;
use super::proxy::ProxyAction;

/// Everything that varies between the clients this app builds. There is
/// deliberately no `Default`: each call site spells out every field, so a new
/// option can never be silently inherited by a caller it does not suit (a
/// request timeout applied to a long-lived SSE stream, say).
pub struct HttpClientOptions {
    pub user_agent: String,
    /// Total request timeout. `None` leaves the client without one — required
    /// for streaming responses.
    pub timeout: Option<Duration>,
    /// `"http1"`, `"http2"`, or `None`/anything else to let ALPN negotiate.
    pub http_version: Option<String>,
    pub verify_ssl: bool,
    pub client_cert: Option<ClientCertConfig>,
    pub follow_redirects: bool,
    /// Evict pooled connections immediately. Streaming callers set this so a
    /// reconnect opens a fresh connection rather than reusing a stale one.
    pub disable_pooling: bool,
}

/// Build a client from `opts`, applying the caller's already-resolved proxy
/// decision. Errors are user-facing strings: certificate problems surface
/// verbatim from [`apply_client_cert`], and only a genuine builder failure gets
/// the `Client build error:` prefix.
pub fn build_http_client(
    opts: HttpClientOptions,
    proxy_action: ProxyAction,
) -> Result<Client, String> {
    let mut builder = Client::builder().user_agent(opts.user_agent);

    if let Some(timeout) = opts.timeout {
        builder = builder.timeout(timeout);
    }

    if opts.disable_pooling {
        builder = builder.pool_idle_timeout(Duration::from_secs(0));
    }

    // With rustls-tls + http2, ALPN negotiates HTTP/2 by default for HTTPS.
    match opts.http_version.as_deref() {
        // Force HTTP/1.1 only - disable HTTP/2 completely
        Some("http1") => builder = builder.http1_only(),
        // Force HTTP/2 with prior knowledge (no ALPN negotiation)
        Some("http2") => builder = builder.http2_prior_knowledge(),
        // "auto" or unset - let ALPN negotiate
        _ => {}
    }

    // Disable SSL verification if requested (e.g. for self-signed certs in dev)
    if !opts.verify_ssl {
        builder = builder.danger_accept_invalid_certs(true);
    }

    // Apply client certificate (mTLS) and/or custom CA trust resolved for this host.
    if let Some(client_cert) = &opts.client_cert {
        builder = apply_client_cert(builder, client_cert)?;
    }

    if !opts.follow_redirects {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    }

    // `Disable` must call `no_proxy()` explicitly — otherwise reqwest would
    // still honour HTTP(S)_PROXY env vars and platform settings by default.
    match proxy_action {
        ProxyAction::Disable => {
            builder = builder.no_proxy();
        }
        ProxyAction::UseSystem => {
            // reqwest auto-detects system proxy; nothing to configure.
        }
        ProxyAction::Manual(proxy) => {
            builder = builder.proxy(*proxy);
        }
    }

    builder
        .build()
        .map_err(|e| format!("Client build error: {}", e))
}

/// Apply a [`ClientCertConfig`] to a reqwest [`reqwest::ClientBuilder`]: load
/// the client identity (cert chain + key) for mTLS and add any custom CA roots.
/// Returns a descriptive error so the UI can surface load/parse failures
/// instead of an opaque TLS handshake error.
pub fn apply_client_cert(
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

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn base_options() -> HttpClientOptions {
        HttpClientOptions {
            user_agent: "resonance-test".to_string(),
            timeout: None,
            http_version: None,
            verify_ssl: true,
            client_cert: None,
            follow_redirects: true,
            disable_pooling: false,
        }
    }

    #[test]
    fn builds_a_client_from_default_options() {
        assert!(build_http_client(base_options(), ProxyAction::Disable).is_ok());
    }

    #[test]
    fn builds_a_client_with_verification_disabled_and_pooling_off() {
        let opts = HttpClientOptions {
            verify_ssl: false,
            disable_pooling: true,
            timeout: Some(Duration::from_millis(5000)),
            follow_redirects: false,
            ..base_options()
        };
        assert!(build_http_client(opts, ProxyAction::UseSystem).is_ok());
    }

    #[test]
    fn builds_a_client_for_each_http_version() {
        for version in ["http1", "http2", "auto"] {
            let opts = HttpClientOptions {
                http_version: Some(version.to_string()),
                ..base_options()
            };
            assert!(
                build_http_client(opts, ProxyAction::Disable).is_ok(),
                "http_version {} should build",
                version
            );
        }
    }

    #[test]
    fn surfaces_a_certificate_error_without_the_build_prefix() {
        let opts = HttpClientOptions {
            client_cert: Some(ClientCertConfig {
                cert_path: Some("/certs/client.crt".into()),
                key_path: None,
                ca_path: None,
            }),
            ..base_options()
        };
        let err = build_http_client(opts, ProxyAction::Disable).unwrap_err();
        assert!(err.contains("both a certificate and a key"));
        assert!(!err.contains("Client build error"));
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
