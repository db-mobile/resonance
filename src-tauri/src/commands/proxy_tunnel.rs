//! HTTP `CONNECT` tunnelling for transports reqwest does not build.
//!
//! reqwest applies the user's proxy settings itself, so the HTTP, SSE and OAuth
//! paths get proxying for free. tokio-tungstenite has no proxy support at all,
//! so the WebSocket transports dial the proxy here and hand the resulting
//! tunnelled stream to the handshake.
//!
//! Only `http` and `https` proxies are tunnelled. SOCKS is deliberately not
//! implemented: reqwest ships its own SOCKS client, so the HTTP path supports
//! it, but reproducing the handshake here would mean owning a second wire
//! protocol. A SOCKS proxy therefore surfaces as an explicit error rather than
//! a silent direct connection — see [`super::proxy::WsProxyAction`].

use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

use super::proxy::{ProxyEndpoint, ProxyScheme};
use super::tls::build_verifying_tls_config;

/// Either a plain TCP stream to the proxy or a TLS one, depending on whether
/// the proxy itself speaks HTTPS. Boxed so both arms share a type; tokio
/// forwards `AsyncRead`/`AsyncWrite` through the box.
pub(crate) trait TunnelStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> TunnelStream for T {}

/// Largest `CONNECT` response we will buffer before giving up, so a proxy that
/// streams headers forever cannot exhaust memory.
const MAX_RESPONSE_BYTES: usize = 8 * 1024;

/// Dial `endpoint` and open a tunnel to `target_host:target_port`.
///
/// The returned stream is positioned immediately after the proxy's response
/// headers, ready for the caller to run its own handshake (including TLS for
/// `wss://`) end-to-end with the target.
pub(crate) async fn connect_through_proxy(
    endpoint: &ProxyEndpoint,
    target_host: &str,
    target_port: u16,
) -> Result<Box<dyn TunnelStream>, String> {
    let tcp = TcpStream::connect((endpoint.host.as_str(), endpoint.port))
        .await
        .map_err(|e| {
            format!(
                "Failed to reach proxy {}:{}: {}",
                endpoint.host, endpoint.port, e
            )
        })?;

    let mut stream: Box<dyn TunnelStream> = match endpoint.scheme {
        ProxyScheme::Http => Box::new(tcp),
        ProxyScheme::Https => {
            let config = build_verifying_tls_config(None, None)?;
            let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
            let server_name = rustls::pki_types::ServerName::try_from(endpoint.host.clone())
                .map_err(|e| format!("Invalid proxy host name '{}': {}", endpoint.host, e))?;
            let tls = connector
                .connect(server_name, tcp)
                .await
                .map_err(|e| format!("TLS handshake with proxy failed: {}", e))?;
            Box::new(tls)
        }
    };

    send_connect(&mut stream, endpoint, target_host, target_port).await?;
    read_connect_response(&mut stream).await?;

    Ok(stream)
}

async fn send_connect(
    stream: &mut Box<dyn TunnelStream>,
    endpoint: &ProxyEndpoint,
    target_host: &str,
    target_port: u16,
) -> Result<(), String> {
    let authority = format!("{}:{}", target_host, target_port);
    let mut request = format!(
        "CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\nProxy-Connection: Keep-Alive\r\n"
    );

    if let Some((username, password)) = &endpoint.auth {
        use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
        use base64::Engine;
        let credentials = BASE64_STANDARD.encode(format!("{}:{}", username, password));
        request.push_str(&format!("Proxy-Authorization: Basic {}\r\n", credentials));
    }

    request.push_str("\r\n");

    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("Failed to send CONNECT to proxy: {}", e))
}

/// Read until the end of the proxy's response headers and require a 2xx.
///
/// Reads a byte at a time so nothing past the header terminator is consumed —
/// anything after it belongs to the tunnelled conversation and must be left in
/// the stream for the caller's handshake.
async fn read_connect_response(stream: &mut Box<dyn TunnelStream>) -> Result<(), String> {
    let mut buffer: Vec<u8> = Vec::with_capacity(256);
    let mut byte = [0u8; 1];

    loop {
        let read = stream
            .read(&mut byte)
            .await
            .map_err(|e| format!("Failed to read the proxy's CONNECT response: {}", e))?;
        if read == 0 {
            return Err("Proxy closed the connection during CONNECT".to_string());
        }
        buffer.push(byte[0]);

        if buffer.ends_with(b"\r\n\r\n") {
            break;
        }
        if buffer.len() >= MAX_RESPONSE_BYTES {
            return Err("Proxy sent an oversized CONNECT response".to_string());
        }
    }

    let status_line = String::from_utf8_lossy(&buffer);
    let status_line = status_line.lines().next().unwrap_or_default();
    let status = parse_status_code(status_line)
        .ok_or_else(|| format!("Proxy sent an unreadable CONNECT response: {}", status_line))?;

    if !(200..300).contains(&status) {
        return Err(format!("Proxy refused CONNECT: {}", status_line.trim()));
    }

    Ok(())
}

/// Pull the numeric status out of an HTTP status line
/// (`HTTP/1.1 200 Connection established`).
fn parse_status_code(status_line: &str) -> Option<u16> {
    let mut parts = status_line.split_whitespace();
    let version = parts.next()?;
    if !version.starts_with("HTTP/") {
        return None;
    }
    parts.next()?.parse::<u16>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[test]
    fn parses_a_conventional_status_line() {
        assert_eq!(
            parse_status_code("HTTP/1.1 200 Connection established"),
            Some(200)
        );
        assert_eq!(
            parse_status_code("HTTP/1.0 407 Proxy Auth Required"),
            Some(407)
        );
    }

    #[test]
    fn rejects_a_status_line_that_is_not_http() {
        assert_eq!(parse_status_code("garbage"), None);
        assert_eq!(parse_status_code(""), None);
        assert_eq!(parse_status_code("HTTP/1.1 not-a-number"), None);
    }

    /// Spawn a fake proxy that replies with `response` and then echoes whatever
    /// the client sends through the tunnel. Returns its address and a handle
    /// yielding the bytes it received before the response was written.
    async fn spawn_fake_proxy(
        response: &'static [u8],
    ) -> (ProxyEndpoint, tokio::task::JoinHandle<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut byte = [0u8; 1];
            while socket.read(&mut byte).await.unwrap() == 1 {
                request.push(byte[0]);
                if request.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            socket.write_all(response).await.unwrap();
            socket.flush().await.unwrap();
            // Hold the socket open so the client can read the trailing body.
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            request
        });

        let endpoint = ProxyEndpoint {
            scheme: ProxyScheme::Http,
            host: addr.ip().to_string(),
            port: addr.port(),
            auth: None,
        };
        (endpoint, handle)
    }

    #[tokio::test]
    async fn a_successful_connect_yields_a_usable_tunnel() {
        let (endpoint, handle) =
            spawn_fake_proxy(b"HTTP/1.1 200 Connection established\r\n\r\nPAYLOAD").await;

        let mut stream = connect_through_proxy(&endpoint, "example.com", 443)
            .await
            .expect("the tunnel should open");

        // Everything after the header terminator must survive for the caller.
        let mut rest = [0u8; 7];
        stream.read_exact(&mut rest).await.unwrap();
        assert_eq!(&rest, b"PAYLOAD");

        let request = String::from_utf8(handle.await.unwrap()).unwrap();
        assert!(
            request.starts_with("CONNECT example.com:443 HTTP/1.1\r\n"),
            "got: {}",
            request
        );
        assert!(
            request.contains("Host: example.com:443\r\n"),
            "got: {}",
            request
        );
        assert!(!request.contains("Proxy-Authorization"), "got: {}", request);
    }

    #[tokio::test]
    async fn credentials_are_sent_as_proxy_authorization() {
        let (mut endpoint, handle) =
            spawn_fake_proxy(b"HTTP/1.1 200 Connection established\r\n\r\n").await;
        endpoint.auth = Some(("user".to_string(), "pa:ss".to_string()));

        connect_through_proxy(&endpoint, "example.com", 443)
            .await
            .expect("the tunnel should open");

        let request = String::from_utf8(handle.await.unwrap()).unwrap();
        // base64("user:pa:ss") — the colon in the password must not be escaped
        // or split; only the first colon separates the pair.
        assert!(
            request.contains("Proxy-Authorization: Basic dXNlcjpwYTpzcw==\r\n"),
            "got: {}",
            request
        );
    }

    #[tokio::test]
    async fn a_refused_connect_reports_the_proxy_status() {
        let (endpoint, _handle) =
            spawn_fake_proxy(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n").await;

        let error = connect_through_proxy(&endpoint, "example.com", 443)
            .await
            .map(|_| ())
            .expect_err("a 407 must not be treated as an open tunnel");

        assert!(error.contains("Proxy refused CONNECT"), "got: {}", error);
        assert!(error.contains("407"), "got: {}", error);
    }

    /// End-to-end: a real `ws://` handshake and message exchange driven through
    /// a real `CONNECT` tunnel. This is what the unit tests above cannot prove —
    /// that the stream is left in exactly the right position for tungstenite to
    /// take over, with no bytes consumed or replayed.
    #[tokio::test]
    async fn a_tunnel_carries_a_real_websocket_session() {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::protocol::Message;

        // A genuine WebSocket server.
        let ws_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_addr = ws_listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (socket, _) = ws_listener.accept().await.unwrap();
            let mut server = tokio_tungstenite::accept_async(socket).await.unwrap();
            while let Some(Ok(message)) = server.next().await {
                if let Message::Text(text) = message {
                    server
                        .send(Message::Text(format!("echo:{}", text)))
                        .await
                        .unwrap();
                }
            }
        });

        // A proxy that honours CONNECT and then splices the two sockets.
        let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_addr = proxy_listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut client, _) = proxy_listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut byte = [0u8; 1];
            while client.read(&mut byte).await.unwrap() == 1 {
                request.push(byte[0]);
                if request.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            assert!(String::from_utf8_lossy(&request)
                .starts_with(&format!("CONNECT 127.0.0.1:{} HTTP/1.1", ws_addr.port())));

            let mut upstream = TcpStream::connect(ws_addr).await.unwrap();
            client
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
            tokio::io::copy_bidirectional(&mut client, &mut upstream)
                .await
                .ok();
        });

        let endpoint = ProxyEndpoint {
            scheme: ProxyScheme::Http,
            host: proxy_addr.ip().to_string(),
            port: proxy_addr.port(),
            auth: None,
        };

        let tunnel = connect_through_proxy(&endpoint, "127.0.0.1", ws_addr.port())
            .await
            .expect("the tunnel should open");

        let url = format!("ws://127.0.0.1:{}/", ws_addr.port());
        let (mut socket, _) =
            tokio_tungstenite::client_async_tls_with_config(url, tunnel, None, None)
                .await
                .expect("the handshake should complete through the tunnel");

        socket
            .send(Message::Text("hello".to_string()))
            .await
            .unwrap();
        let reply = socket.next().await.unwrap().unwrap();
        assert_eq!(reply, Message::Text("echo:hello".to_string()));
    }

    #[tokio::test]
    async fn an_unreachable_proxy_names_the_proxy() {
        // Port 1 on loopback is reserved and never listening.
        let endpoint = ProxyEndpoint {
            scheme: ProxyScheme::Http,
            host: "127.0.0.1".to_string(),
            port: 1,
            auth: None,
        };

        let error = connect_through_proxy(&endpoint, "example.com", 443)
            .await
            .map(|_| ())
            .expect_err("connecting to a closed port must fail");

        assert!(
            error.contains("Failed to reach proxy 127.0.0.1:1"),
            "got: {}",
            error
        );
    }
}
