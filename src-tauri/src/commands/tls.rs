//! Shared TLS building blocks used by the HTTP timing probe, the gRPC
//! channel builder, the MQTT transport, and the WebSocket transports: the
//! danger accept-all certificate verifier, PEM loading/parsing helpers for
//! client identities and CA bundles, and rustls client config builders.

use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use std::sync::Arc;
use tokio_tungstenite::Connector;

use super::api_request::ClientCertConfig;

/// PEM bytes of a client identity: (certificate chain, private key).
pub(crate) type IdentityPems = (Vec<u8>, Vec<u8>);

/// Certificate verifier that accepts any server certificate. Only used when
/// the user has explicitly disabled SSL verification.
#[derive(Debug)]
pub(crate) struct NoCertVerifier;

impl rustls::client::danger::ServerCertVerifier for NoCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        use rustls::SignatureScheme::*;
        vec![
            RSA_PKCS1_SHA1,
            ECDSA_SHA1_Legacy,
            RSA_PKCS1_SHA256,
            ECDSA_NISTP256_SHA256,
            RSA_PKCS1_SHA384,
            ECDSA_NISTP384_SHA384,
            RSA_PKCS1_SHA512,
            ECDSA_NISTP521_SHA512,
            RSA_PSS_SHA256,
            RSA_PSS_SHA384,
            RSA_PSS_SHA512,
            ED25519,
            ED448,
        ]
    }
}

/// Read the client identity PEM files (cert chain + private key) for mTLS.
/// Returns `Ok(None)` when neither path is configured; requires both when
/// either is set. Empty strings count as unset (the frontend certificate
/// store sends `''` for blank fields).
pub(crate) fn load_identity_pems(
    cert_path: &Option<String>,
    key_path: &Option<String>,
) -> Result<Option<IdentityPems>, String> {
    let cert_path = cert_path.as_deref().filter(|p| !p.is_empty());
    let key_path = key_path.as_deref().filter(|p| !p.is_empty());

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
            Ok(Some((cert_pem, key_pem)))
        }
        (Some(_), None) | (None, Some(_)) => {
            Err("Client certificate requires both a certificate and a key file".to_string())
        }
        (None, None) => Ok(None),
    }
}

/// Read a CA bundle PEM file. Returns `Ok(None)` when no path is configured;
/// empty strings count as unset.
pub(crate) fn load_ca_pem(ca_path: &Option<String>) -> Result<Option<Vec<u8>>, String> {
    let Some(ca_path) = ca_path.as_deref().filter(|p| !p.is_empty()) else {
        return Ok(None);
    };
    let ca_pem = std::fs::read(ca_path)
        .map_err(|e| format!("CA certificate could not be read ({}): {}", ca_path, e))?;
    Ok(Some(ca_pem))
}

/// Parse identity PEM bytes into rustls types for use in a hand-built
/// `rustls::ClientConfig` (the skip-verify gRPC path).
pub(crate) fn parse_identity(
    cert_pem: &[u8],
    key_pem: &[u8],
) -> Result<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>), String> {
    let certs: Vec<CertificateDer<'static>> =
        rustls_pemfile::certs(&mut std::io::Cursor::new(cert_pem))
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Client certificate could not be parsed: {}", e))?;
    if certs.is_empty() {
        return Err("Client certificate contains no PEM certificates".to_string());
    }
    let key = rustls_pemfile::private_key(&mut std::io::Cursor::new(key_pem))
        .map_err(|e| format!("Client key could not be parsed: {}", e))?
        .ok_or_else(|| {
            "Client key could not be parsed (expects an unencrypted private key in PKCS#8, RSA, or SEC1 form)"
                .to_string()
        })?;
    Ok((certs, key))
}

/// Build a rustls client config that skips server-certificate verification,
/// optionally presenting a client identity (mTLS still works with
/// verification off, matching reqwest's `danger_accept_invalid_certs` +
/// `identity` semantics). No ALPN is set; protocol-specific wrappers add it.
pub(crate) fn build_danger_tls_config(
    identity: Option<IdentityPems>,
) -> Result<rustls::ClientConfig, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS protocol configuration error: {}", e))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoCertVerifier));

    match identity {
        Some((cert_pem, key_pem)) => {
            let (certs, key) = parse_identity(&cert_pem, &key_pem)?;
            builder
                .with_client_auth_cert(certs, key)
                .map_err(|e| format!("Client certificate could not be loaded: {}", e))
        }
        None => Ok(builder.with_no_client_auth()),
    }
}

/// Skip-verify config for gRPC channels: ALPN pinned to h2.
pub(crate) fn build_danger_grpc_tls_config(
    identity: Option<IdentityPems>,
) -> Result<rustls::ClientConfig, String> {
    let mut config = build_danger_tls_config(identity)?;
    config.alpn_protocols = vec![b"h2".to_vec()];
    Ok(config)
}

/// Build a verifying rustls client config: webpki roots plus an optional
/// custom CA bundle appended, and an optional client identity (mTLS).
/// No ALPN is set.
pub(crate) fn build_verifying_tls_config(
    ca_pem: Option<Vec<u8>>,
    identity: Option<IdentityPems>,
) -> Result<rustls::ClientConfig, String> {
    let mut root_store = rustls::RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    if let Some(ca_pem) = ca_pem {
        let certs: Vec<CertificateDer<'static>> =
            rustls_pemfile::certs(&mut std::io::Cursor::new(&ca_pem))
                .collect::<Result<_, _>>()
                .map_err(|e| format!("CA certificate could not be parsed: {}", e))?;
        if certs.is_empty() {
            return Err("CA certificate contains no PEM certificates".to_string());
        }
        for cert in certs {
            root_store.add(cert).map_err(|e| {
                format!(
                    "CA certificate could not be added to the trust store: {}",
                    e
                )
            })?;
        }
    }

    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS protocol configuration error: {}", e))?
        .with_root_certificates(root_store);

    match identity {
        Some((cert_pem, key_pem)) => {
            let (certs, key) = parse_identity(&cert_pem, &key_pem)?;
            builder
                .with_client_auth_cert(certs, key)
                .map_err(|e| format!("Client certificate could not be loaded: {}", e))
        }
        None => Ok(builder.with_no_client_auth()),
    }
}

/// Whether a WebSocket handshake URI needs TLS. `ws://` and `wss://` are the
/// only schemes tungstenite accepts, so this is simply the secure variant.
pub(crate) fn ws_uri_is_secure(uri: &http::Uri) -> bool {
    uri.scheme_str()
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("wss"))
}

/// Build the rustls connector for a `wss://` handshake. Skip-verify, custom CA
/// trust, and the client identity all flow through the shared builders above,
/// so the WebSocket transports honour the same certificate settings as HTTP,
/// gRPC, and MQTT. No ALPN is set, matching what tokio-tungstenite's own
/// default connector offers.
pub(crate) fn build_ws_connector(
    verify_ssl: bool,
    client_cert: Option<&ClientCertConfig>,
) -> Result<Connector, String> {
    let (cert_path, key_path, ca_path) = match client_cert {
        Some(cert) => (&cert.cert_path, &cert.key_path, &cert.ca_path),
        None => (&None, &None, &None),
    };

    let identity = load_identity_pems(cert_path, key_path)?;

    let config = if verify_ssl {
        let ca_pem = load_ca_pem(ca_path)?;
        build_verifying_tls_config(ca_pem, identity)?
    } else {
        build_danger_tls_config(identity)?
    };

    Ok(Connector::Rustls(Arc::new(config)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_requires_both_cert_and_key() {
        let err = load_identity_pems(&Some("/tmp/cert.pem".to_string()), &None).unwrap_err();
        assert!(err.contains("both a certificate and a key file"));

        let err = load_identity_pems(&None, &Some("/tmp/key.pem".to_string())).unwrap_err();
        assert!(err.contains("both a certificate and a key file"));
    }

    #[test]
    fn empty_paths_count_as_unset() {
        assert!(
            load_identity_pems(&Some(String::new()), &Some(String::new()))
                .unwrap()
                .is_none()
        );
        assert!(load_ca_pem(&Some(String::new())).unwrap().is_none());
        assert!(load_ca_pem(&None).unwrap().is_none());
    }

    #[test]
    fn missing_files_produce_descriptive_errors() {
        let err = load_identity_pems(
            &Some("/nonexistent/cert.pem".to_string()),
            &Some("/nonexistent/key.pem".to_string()),
        )
        .unwrap_err();
        assert!(err.contains("Client certificate could not be read (/nonexistent/cert.pem)"));

        let err = load_ca_pem(&Some("/nonexistent/ca.pem".to_string())).unwrap_err();
        assert!(err.contains("CA certificate could not be read (/nonexistent/ca.pem)"));
    }

    #[test]
    fn danger_config_builds_without_client_auth() {
        let config = build_danger_grpc_tls_config(None).unwrap();
        assert_eq!(config.alpn_protocols, vec![b"h2".to_vec()]);
    }

    #[test]
    fn danger_config_has_no_alpn() {
        let config = build_danger_tls_config(None).unwrap();
        assert!(config.alpn_protocols.is_empty());
    }

    #[test]
    fn verifying_config_builds_with_defaults() {
        let config = build_verifying_tls_config(None, None).unwrap();
        assert!(config.alpn_protocols.is_empty());
    }

    #[test]
    fn verifying_config_rejects_garbage_ca() {
        let err = build_verifying_tls_config(Some(b"not a pem".to_vec()), None).unwrap_err();
        assert!(err.contains("contains no PEM certificates"));
    }

    /// `Connector` has no `Debug`, so the usual `unwrap_err` is unavailable.
    fn ws_connector_error(cert: &ClientCertConfig) -> String {
        match build_ws_connector(true, Some(cert)) {
            Ok(_) => panic!("expected the connector build to fail"),
            Err(error) => error,
        }
    }

    #[test]
    fn ws_connector_builds_for_both_verification_modes() {
        for verify_ssl in [true, false] {
            assert!(
                matches!(
                    build_ws_connector(verify_ssl, None),
                    Ok(Connector::Rustls(_))
                ),
                "verify_ssl {} should build a rustls connector",
                verify_ssl
            );
        }
    }

    #[test]
    fn ws_connector_surfaces_identity_errors() {
        let cert = ClientCertConfig {
            cert_path: Some("/certs/client.crt".to_string()),
            key_path: None,
            ca_path: None,
        };
        let err = ws_connector_error(&cert);
        assert!(err.contains("both a certificate and a key file"));
    }

    #[test]
    fn ws_connector_surfaces_ca_errors() {
        let cert = ClientCertConfig {
            cert_path: None,
            key_path: None,
            ca_path: Some("/nonexistent/ca.pem".to_string()),
        };
        let err = ws_connector_error(&cert);
        assert!(err.contains("CA certificate could not be read"));
    }

    /// Paths to a private-CA test fixture: the CA certificate a client would
    /// register as its custom CA bundle, plus the `localhost` leaf certificate
    /// and key the server presents. A leaf signed by a CA — rather than a bare
    /// self-signed certificate — is what a real private-CA deployment looks
    /// like, and webpki rejects a `CA:TRUE` certificate used as a server leaf.
    struct CertFixture {
        dir: std::path::PathBuf,
        ca_cert: std::path::PathBuf,
        server_cert: std::path::PathBuf,
        server_key: std::path::PathBuf,
    }

    /// Build the fixture with `openssl`. Returns `None` when `openssl` is
    /// unavailable, matching the convention in `http_client.rs`.
    fn private_ca_fixture() -> Option<CertFixture> {
        use std::process::Command;

        let openssl_ok = Command::new("openssl")
            .arg("version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !openssl_ok {
            return None;
        }

        let run = |args: &[&str]| {
            let output = Command::new("openssl")
                .args(args)
                .output()
                .expect("run openssl");
            assert!(
                output.status.success(),
                "openssl {:?} failed: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
        };

        let dir = std::env::temp_dir().join(format!("resonance-wss-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = |name: &str| dir.join(name).to_string_lossy().into_owned();
        let (ca_cert, ca_key) = (path("ca.pem"), path("ca.key"));
        let (server_cert, server_key, csr) =
            (path("server.pem"), path("server.key"), path("server.csr"));

        let ext_file = dir.join("server.ext");
        std::fs::write(
            &ext_file,
            "basicConstraints=CA:FALSE\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n",
        )
        .unwrap();

        run(&[
            "req",
            "-x509",
            "-newkey",
            "ec",
            "-pkeyopt",
            "ec_paramgen_curve:prime256v1",
            "-nodes",
            "-keyout",
            &ca_key,
            "-out",
            &ca_cert,
            "-days",
            "1",
            "-subj",
            "/CN=resonance-test-ca",
        ]);
        run(&[
            "req",
            "-newkey",
            "ec",
            "-pkeyopt",
            "ec_paramgen_curve:prime256v1",
            "-nodes",
            "-keyout",
            &server_key,
            "-out",
            &csr,
            "-subj",
            "/CN=localhost",
        ]);
        run(&[
            "x509",
            "-req",
            "-in",
            &csr,
            "-CA",
            &ca_cert,
            "-CAkey",
            &ca_key,
            "-CAcreateserial",
            "-out",
            &server_cert,
            "-days",
            "1",
            "-extfile",
            ext_file.to_str().unwrap(),
        ]);

        Some(CertFixture {
            ca_cert: ca_cert.into(),
            server_cert: server_cert.into(),
            server_key: server_key.into(),
            dir,
        })
    }

    /// Start a `wss://` echo server on an ephemeral port using the given
    /// self-signed material. Returns the port; the server accepts connections
    /// until the test ends.
    async fn spawn_wss_server(cert_path: &std::path::Path, key_path: &std::path::Path) -> u16 {
        let certs: Vec<CertificateDer<'static>> =
            rustls_pemfile::certs(&mut std::io::Cursor::new(std::fs::read(cert_path).unwrap()))
                .collect::<Result<_, _>>()
                .unwrap();
        let key = rustls_pemfile::private_key(&mut std::io::Cursor::new(
            std::fs::read(key_path).unwrap(),
        ))
        .unwrap()
        .unwrap();

        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let config = rustls::ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(certs, key)
            .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let acceptor = acceptor.clone();
                tokio::spawn(async move {
                    if let Ok(tls_stream) = acceptor.accept(stream).await {
                        let _ = tokio_tungstenite::accept_async(tls_stream).await;
                    }
                });
            }
        });

        port
    }

    /// End-to-end proof that the connector actually drives a `wss://` handshake:
    /// against a privately-signed server, verification-on must fail, skip-verify
    /// must connect, and registering the signing CA must connect with
    /// verification left on. This is the behaviour the WebSocket and
    /// GraphQL-subscription transports were missing entirely.
    #[tokio::test]
    async fn ws_connector_drives_a_real_untrusted_handshake() {
        let Some(fixture) = private_ca_fixture() else {
            eprintln!("skipping ws_connector_drives_a_real_untrusted_handshake: no openssl");
            return;
        };
        let port = spawn_wss_server(&fixture.server_cert, &fixture.server_key).await;
        let url = format!("wss://localhost:{}/", port);

        let verifying = build_ws_connector(true, None).unwrap();
        let result =
            tokio_tungstenite::connect_async_tls_with_config(&url, None, false, Some(verifying))
                .await;
        assert!(
            result.is_err(),
            "a privately-signed cert must be rejected when verification is on"
        );

        let skipping = build_ws_connector(false, None).unwrap();
        let result =
            tokio_tungstenite::connect_async_tls_with_config(&url, None, false, Some(skipping))
                .await;
        assert!(
            result.is_ok(),
            "skip-verify must connect to an untrusted server: {:?}",
            result.err().map(|e| e.to_string())
        );

        let trusting_ca = build_ws_connector(
            true,
            Some(&ClientCertConfig {
                cert_path: None,
                key_path: None,
                ca_path: Some(fixture.ca_cert.to_string_lossy().into()),
            }),
        )
        .unwrap();
        let result =
            tokio_tungstenite::connect_async_tls_with_config(&url, None, false, Some(trusting_ca))
                .await;
        assert!(
            result.is_ok(),
            "registering the signing CA must verify: {:?}",
            result.err().map(|e| e.to_string())
        );

        let _ = std::fs::remove_dir_all(&fixture.dir);
    }

    #[test]
    fn ws_uri_scheme_detection() {
        let secure: http::Uri = "wss://example.com/graphql".parse().unwrap();
        let plain: http::Uri = "ws://example.com/graphql".parse().unwrap();
        assert!(ws_uri_is_secure(&secure));
        assert!(!ws_uri_is_secure(&plain));
    }

    /// With verification off the CA bundle is irrelevant, so an unreadable CA
    /// path must not block the connection the user explicitly asked for.
    #[test]
    fn ws_connector_ignores_ca_when_verification_is_off() {
        let cert = ClientCertConfig {
            cert_path: None,
            key_path: None,
            ca_path: Some("/nonexistent/ca.pem".to_string()),
        };
        assert!(matches!(
            build_ws_connector(false, Some(&cert)),
            Ok(Connector::Rustls(_))
        ));
    }
}
