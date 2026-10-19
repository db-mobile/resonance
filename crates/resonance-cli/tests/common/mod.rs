//! Shared scaffolding: a temporary v2 collection, an echo server and a way
//! to run the built binary against both.
#![allow(dead_code)]
use axum::Router;
use axum::body::Bytes;
use axum::extract::Request;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::any;
use serde_json::json;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use tempfile::TempDir;
use tokio::task::JoinHandle;

pub struct Collection {
    pub dir: TempDir,
}

impl Collection {
    pub fn new(name: &str) -> Self {
        let dir = TempDir::new().unwrap();
        let collection = Self { dir };
        collection.write(
            "collection.yaml",
            &format!("resonanceFormat: 2\nid: col_1\nname: {name}\nbaseUrl: '{{{{baseUrl}}}}'\n"),
        );
        collection
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn write(&self, relative: &str, contents: &str) -> PathBuf {
        let path = self.dir.path().join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, contents).unwrap();
        path
    }

    /// A GET request whose test script asserts the echoed status.
    pub fn request(
        &self,
        file: &str,
        id: &str,
        name: &str,
        seq: i64,
        path: &str,
        expected_status: u16,
    ) {
        self.write(
            file,
            &format!(
                "resonanceFormat: 2\nid: {id}\nname: {name}\nseq: {seq}\nmethod: GET\npath: {path}\nscripts:\n  test: |\n    pm.test('status is {expected_status}', function () {{ pm.response.to.have.status({expected_status}); }});\n"
            ),
        );
    }
}

async fn echo(headers: HeaderMap, request: Request) -> impl IntoResponse {
    let uri = request.uri().clone();
    let method = request.method().to_string();
    let query: std::collections::HashMap<String, String> = uri
        .query()
        .map(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .into_owned()
                .collect()
        })
        .unwrap_or_default();
    if uri.path().starts_with("/slow") {
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    }
    let status = query
        .get("status")
        .and_then(|s| s.parse::<u16>().ok())
        .or_else(|| {
            uri.path()
                .strip_prefix("/status/")
                .and_then(|s| s.parse().ok())
        })
        .unwrap_or(200);
    let body = axum::body::to_bytes(request.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|_| Bytes::new());
    let headers: serde_json::Map<String, serde_json::Value> = headers
        .iter()
        .filter(|(k, _)| !matches!(k.as_str(), "authorization" | "cookie"))
        .map(|(k, v)| (k.to_string(), json!(v.to_str().unwrap_or(""))))
        .collect();
    (
        StatusCode::from_u16(status).unwrap_or(StatusCode::OK),
        [("set-cookie", "sid=abc; Path=/"), ("content-type", "application/json")],
        json!({"path": uri.path(), "method": method, "headers": headers, "body": String::from_utf8_lossy(&body)}).to_string(),
    )
}

pub struct Server {
    pub addr: SocketAddr,
    handle: JoinHandle<()>,
}

impl Server {
    pub async fn start() -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            axum::serve(listener, Router::new().fallback(any(echo)))
                .await
                .unwrap();
        });
        Self { addr, handle }
    }

    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

pub struct Cli {
    pub output: Output,
}

impl Cli {
    pub fn stdout(&self) -> String {
        String::from_utf8_lossy(&self.output.stdout).to_string()
    }
    pub fn stderr(&self) -> String {
        String::from_utf8_lossy(&self.output.stderr).to_string()
    }
    pub fn code(&self) -> i32 {
        self.output.status.code().unwrap_or(-1)
    }
}

pub fn command() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_resonance"));
    command.env_remove("NO_COLOR");
    command.env("NO_PROXY", "*");
    command
}

/// Runs `resonance run <collection> <args>` with `baseUrl` pointing at the server.
pub fn run(collection: &Collection, server: &Server, args: &[&str]) -> Cli {
    run_with(collection, server, args, &[])
}

pub fn run_with(
    collection: &Collection,
    server: &Server,
    args: &[&str],
    envs: &[(&str, &str)],
) -> Cli {
    let mut command = command();
    command
        .arg("run")
        .arg(collection.path())
        .arg("--var")
        .arg(format!("baseUrl={}", server.base_url()))
        .args(args)
        .envs(envs.iter().copied());
    Cli {
        output: command.output().unwrap(),
    }
}
