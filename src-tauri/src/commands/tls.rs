//! Shared TLS building blocks used by the HTTP timing probe, the gRPC
//! channel builder, and the MQTT transport: the danger accept-all
//! certificate verifier, PEM loading/parsing helpers for client identities
//! and CA bundles, and rustls client config builders.

use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use std::sync::Arc;

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
}
