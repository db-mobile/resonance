//! Per-phase timing of the connection a request actually used.
//!
//! reqwest exposes no timing hooks of its own, but it does let a caller replace
//! the DNS resolver ([`reqwest::ClientBuilder::dns_resolver`]) and wrap the
//! connector in a tower layer ([`reqwest::ClientBuilder::connector_layer`]).
//! Timing both gives DNS on its own and the connector call as a whole; the
//! connect phase is the difference, since the resolver runs inside the
//! connector.
//!
//! TCP and TLS cannot be separated here: reqwest nests its TCP connector inside
//! the TLS connector (`HttpsConnector::from((http, tls))`) with nothing in
//! between, so `connect` covers both. Splitting them would mean replacing
//! reqwest's connection layer wholesale.
//!
//! Samples accumulate rather than overwrite. A redirect chain or a digest-auth
//! retry opens more than one connection, and summing keeps the reported phases
//! inside the request's total instead of describing only one leg of it.

use std::error::Error as StdError;
use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use tower::{Layer, Service};

/// Phase durations in fractional milliseconds, as handed to the frontend.
/// `None` means "not measured", which is deliberately distinct from zero: a
/// reused connection performs no connect, and a SOCKS proxy resolves the name
/// remotely so the local resolver never runs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TimingSnapshot {
    pub dns: Option<f64>,
    pub connect: Option<f64>,
    pub connect_count: u32,
}

#[derive(Debug, Default)]
struct Samples {
    dns: Option<Duration>,
    connector: Option<Duration>,
    connect_count: u32,
}

/// Collects phase durations from the resolver and connector layer of a single
/// request. Shared with the client through an [`Arc`], since reqwest clones the
/// connector service per connection.
#[derive(Debug, Default)]
pub struct TimingRecorder {
    samples: Mutex<Samples>,
}

impl TimingRecorder {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn record_dns(&self, elapsed: Duration) {
        let mut samples = self.samples.lock().unwrap();
        samples.dns = Some(samples.dns.unwrap_or_default() + elapsed);
    }

    fn record_connector(&self, elapsed: Duration) {
        let mut samples = self.samples.lock().unwrap();
        samples.connector = Some(samples.connector.unwrap_or_default() + elapsed);
        samples.connect_count += 1;
    }

    /// Read the accumulated phases. The connector call contains the DNS lookup,
    /// so the connect phase is what remains after subtracting it; the
    /// saturating subtraction guards against a resolver that ran outside a
    /// connector call.
    pub fn snapshot(&self) -> TimingSnapshot {
        let samples = self.samples.lock().unwrap();
        let dns = samples.dns;
        let connect = samples
            .connector
            .map(|connector| connector.saturating_sub(dns.unwrap_or_default()));

        TimingSnapshot {
            dns: dns.map(millis),
            connect: connect.map(millis),
            connect_count: samples.connect_count,
        }
    }
}

/// Duration as fractional milliseconds. Sub-millisecond phases are ordinary on
/// localhost, so truncating to whole milliseconds would report them as zero.
fn millis(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

/// DNS resolver that times each lookup into a [`TimingRecorder`].
///
/// Resolution itself is `tokio::net::lookup_host`, matching the getaddrinfo
/// path reqwest uses by default. Port `0` is a placeholder: reqwest replaces it
/// with the port from the URL or the scheme's default.
pub struct TimingResolver {
    recorder: Arc<TimingRecorder>,
}

impl TimingResolver {
    pub fn new(recorder: Arc<TimingRecorder>) -> Arc<Self> {
        Arc::new(Self { recorder })
    }
}

impl Resolve for TimingResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let recorder = Arc::clone(&self.recorder);
        Box::pin(async move {
            let host = name.as_str().to_string();
            let started = Instant::now();
            let result = tokio::net::lookup_host((host.as_str(), 0u16)).await;
            recorder.record_dns(started.elapsed());

            match result {
                // Collected eagerly so the boxed iterator is nameably `Send`.
                Ok(addrs) => {
                    let addrs: Vec<SocketAddr> = addrs.collect();
                    Ok(Box::new(addrs.into_iter()) as Addrs)
                }
                Err(e) => Err(Box::new(e) as Box<dyn StdError + Send + Sync>),
            }
        })
    }
}

/// Wraps reqwest's connector so the whole connect call is timed.
///
/// Both this and [`TimingService`] stay generic over the inner service and its
/// request type: reqwest's `connector_layer` bound mentions types that are not
/// publicly nameable, and staying generic lets the compiler discharge it.
#[derive(Clone)]
pub struct TimingLayer {
    recorder: Arc<TimingRecorder>,
}

impl TimingLayer {
    pub fn new(recorder: Arc<TimingRecorder>) -> Self {
        Self { recorder }
    }
}

impl<S> Layer<S> for TimingLayer {
    type Service = TimingService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        TimingService {
            inner,
            recorder: Arc::clone(&self.recorder),
        }
    }
}

#[derive(Clone)]
pub struct TimingService<S> {
    inner: S,
    recorder: Arc<TimingRecorder>,
}

impl<S, Req> Service<Req> for TimingService<S>
where
    S: Service<Req>,
    S::Future: Send + 'static,
    S::Response: Send + 'static,
    S::Error: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<S::Response, S::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Req) -> Self::Future {
        let recorder = Arc::clone(&self.recorder);
        let future = self.inner.call(req);

        Box::pin(async move {
            let started = Instant::now();
            let result = future.await;
            // A failed connect has no phase worth reporting; the error is what
            // the user sees instead.
            if result.is_ok() {
                recorder.record_connector(started.elapsed());
            }
            result
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unmeasured_phases_are_none_rather_than_zero() {
        let recorder = TimingRecorder::new();
        let snapshot = recorder.snapshot();

        assert_eq!(snapshot.dns, None);
        assert_eq!(snapshot.connect, None);
        assert_eq!(snapshot.connect_count, 0);
    }

    #[test]
    fn connect_is_the_connector_call_minus_dns() {
        let recorder = TimingRecorder::new();
        recorder.record_dns(Duration::from_millis(20));
        recorder.record_connector(Duration::from_millis(50));

        let snapshot = recorder.snapshot();
        assert_eq!(snapshot.dns, Some(20.0));
        assert_eq!(snapshot.connect, Some(30.0));
        assert_eq!(snapshot.connect_count, 1);
    }

    #[test]
    fn a_reused_connection_reports_no_connect_phase() {
        let recorder = TimingRecorder::new();
        recorder.record_dns(Duration::from_millis(5));

        let snapshot = recorder.snapshot();
        assert_eq!(snapshot.dns, Some(5.0));
        assert_eq!(snapshot.connect, None);
        assert_eq!(snapshot.connect_count, 0);
    }

    #[test]
    fn samples_accumulate_across_connections() {
        let recorder = TimingRecorder::new();
        recorder.record_dns(Duration::from_millis(10));
        recorder.record_connector(Duration::from_millis(40));
        recorder.record_dns(Duration::from_millis(2));
        recorder.record_connector(Duration::from_millis(30));

        let snapshot = recorder.snapshot();
        assert_eq!(snapshot.dns, Some(12.0));
        assert_eq!(snapshot.connect, Some(58.0));
        assert_eq!(snapshot.connect_count, 2);
    }

    #[test]
    fn connect_clamps_instead_of_underflowing() {
        let recorder = TimingRecorder::new();
        recorder.record_dns(Duration::from_millis(80));
        recorder.record_connector(Duration::from_millis(10));

        assert_eq!(recorder.snapshot().connect, Some(0.0));
    }

    #[test]
    fn sub_millisecond_phases_survive_as_fractions() {
        let recorder = TimingRecorder::new();
        recorder.record_connector(Duration::from_micros(250));

        let connect = recorder.snapshot().connect.unwrap();
        assert!(connect > 0.0, "sub-millisecond connect collapsed to zero");
        assert!((connect - 0.25).abs() < f64::EPSILON);
    }

    /// Minimal keep-alive HTTP/1.1 server. Answers every request with the same
    /// short body and holds the connection open, so a test can tell a fresh
    /// connect apart from a reused one.
    async fn spawn_echo_server() -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 1024];
                    while let Ok(read) = socket.read(&mut buf).await {
                        if read == 0 {
                            break;
                        }
                        let response = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi";
                        if socket.write_all(response.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                });
            }
        });

        port
    }

    fn instrumented_client(recorder: &Arc<TimingRecorder>) -> reqwest::Client {
        reqwest::Client::builder()
            .dns_resolver(TimingResolver::new(Arc::clone(recorder)))
            .connector_layer(TimingLayer::new(Arc::clone(recorder)))
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn a_real_request_records_dns_and_connect() {
        let port = spawn_echo_server().await;
        let recorder = TimingRecorder::new();
        let client = instrumented_client(&recorder);

        // `localhost` rather than an IP literal: hyper skips the resolver for
        // addresses that need no lookup, and the resolver is under test here.
        let url = format!("http://localhost:{}/", port);
        let response = client.get(&url).send().await.unwrap();
        assert_eq!(response.status(), 200);
        response.bytes().await.unwrap();

        let snapshot = recorder.snapshot();
        assert!(snapshot.dns.is_some(), "DNS was never measured");
        assert!(snapshot.connect.is_some(), "connect was never measured");
        assert_eq!(snapshot.connect_count, 1);
    }

    #[tokio::test]
    async fn a_reused_connection_adds_no_connect_sample() {
        let port = spawn_echo_server().await;
        let recorder = TimingRecorder::new();
        let client = instrumented_client(&recorder);
        let url = format!("http://localhost:{}/", port);

        for _ in 0..2 {
            let response = client.get(&url).send().await.unwrap();
            response.bytes().await.unwrap();
        }

        assert_eq!(
            recorder.snapshot().connect_count,
            1,
            "the pooled connection should not have been re-established"
        );
    }

    #[tokio::test]
    async fn a_failed_connect_records_no_phase() {
        let recorder = TimingRecorder::new();
        let client = instrumented_client(&recorder);

        // Port 1 on loopback refuses connections without a listener bound.
        let result = client.get("http://localhost:1/").send().await;
        assert!(result.is_err(), "connect to a closed port should fail");

        let snapshot = recorder.snapshot();
        assert_eq!(snapshot.connect, None);
        assert_eq!(snapshot.connect_count, 0);
    }
}
