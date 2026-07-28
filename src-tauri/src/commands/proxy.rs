use reqwest::Proxy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::RwLock;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "resonance-store.json";
const PROXY_KEY: &str = "proxySettings";

/// Every field defaults, so a stored payload written by an older version (or a
/// partial one) still hydrates rather than being discarded. The defaults are
/// hand-written because the derived ones (`port: 0`, empty `type`) would be
/// handed straight back to the settings UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProxySettings {
    pub enabled: bool,
    pub use_system_proxy: bool,
    #[serde(rename = "type")]
    pub proxy_type: String,
    pub host: String,
    pub port: u16,
    pub auth: ProxyAuth,
    pub bypass_list: Vec<String>,
    pub timeout: u64,
}

impl Default for ProxySettings {
    fn default() -> Self {
        Self {
            enabled: false,
            use_system_proxy: false,
            proxy_type: "http".to_string(),
            host: String::new(),
            port: 8080,
            auth: ProxyAuth::default(),
            bypass_list: Vec::new(),
            timeout: 10000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProxyAuth {
    pub enabled: bool,
    pub username: String,
    pub password: String,
}

pub struct ProxyState {
    pub settings: RwLock<ProxySettings>,
}

impl Default for ProxyState {
    fn default() -> Self {
        Self {
            settings: RwLock::new(ProxySettings::default()),
        }
    }
}

/// Deserialize stored proxy settings. Returns `None` for anything that is not a
/// settings object at all; every individual field has a default, so a payload
/// from an older store version still parses.
fn parse_settings(value: Value) -> Option<ProxySettings> {
    if !value.is_object() {
        return None;
    }
    serde_json::from_value(value).ok()
}

/// Load persisted proxy settings into [`ProxyState`] at startup. Without this
/// the state stays at its defaults and every request behaves as though no proxy
/// were configured, however the user left the settings UI.
///
/// Reads the store directly rather than going through `store_get`, which
/// synthesises a default for an absent key. State is only overwritten on a
/// successful parse, so unreadable settings leave the defaults intact.
pub fn hydrate_from_store(app: &AppHandle) {
    let Ok(store) = app.store(STORE_FILE) else {
        return;
    };
    let Some(value) = store.get(PROXY_KEY) else {
        return;
    };
    let Some(settings) = parse_settings(value) else {
        tracing::warn!("Stored proxy settings could not be parsed; using defaults");
        return;
    };

    if let Ok(mut current) = app.state::<ProxyState>().settings.write() {
        *current = settings;
    }
}

/// What the HTTP client should do about proxying for a given URL.
///
/// - `Disable`: no proxy — callers MUST explicitly suppress system proxies
///   (e.g. `client_builder.no_proxy()`), otherwise reqwest auto-detects
///   `HTTP(S)_PROXY` env vars and platform settings.
/// - `UseSystem`: leave the client alone so reqwest's default detection runs.
/// - `Manual`: apply this specific proxy.
pub enum ProxyAction {
    Disable,
    UseSystem,
    Manual(Box<Proxy>),
}

/// Scheme of a proxy a caller must dial itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyScheme {
    Http,
    Https,
}

/// A resolved proxy in the structured form transports need to dial it
/// themselves. [`ProxyAction::Manual`] wraps an opaque [`Proxy`] that only
/// reqwest can use, so anything building its own connection needs this instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyEndpoint {
    pub scheme: ProxyScheme,
    pub host: String,
    pub port: u16,
    /// Basic credentials, already split into username and password.
    pub auth: Option<(String, String)>,
}

/// What a non-reqwest transport should do about proxying for a given URL.
///
/// Distinct from [`ProxyAction`] because reqwest resolves system proxies and
/// SOCKS itself, whereas a hand-built transport has to be told explicitly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WsProxyAction {
    /// Connect straight to the target.
    Direct,
    /// Open an HTTP `CONNECT` tunnel through this proxy first.
    Tunnel(ProxyEndpoint),
    /// Configured proxy type this transport cannot honour. Reported to the user
    /// rather than ignored, so a proxied setup never leaks a direct connection.
    Unsupported { proxy_type: String },
}

impl ProxySettings {
    /// Resolve the proxy decision for a transport that dials its own socket.
    ///
    /// Mirrors [`Self::proxy_action`]'s enable and bypass rules so the WebSocket
    /// transports agree with the HTTP path on *whether* to proxy, then resolves
    /// the concrete endpoint that reqwest would otherwise have found on its own.
    pub fn ws_proxy_action(&self, url: &str) -> WsProxyAction {
        if !self.enabled || Self::should_bypass(url, &self.bypass_list) {
            return WsProxyAction::Direct;
        }

        if self.use_system_proxy {
            return match system_proxy_for(url) {
                Some(endpoint) => WsProxyAction::Tunnel(endpoint),
                None => WsProxyAction::Direct,
            };
        }

        let scheme = match self.proxy_type.to_ascii_lowercase().as_str() {
            "http" => ProxyScheme::Http,
            "https" => ProxyScheme::Https,
            other => {
                return WsProxyAction::Unsupported {
                    proxy_type: other.to_string(),
                }
            }
        };

        let auth = if self.auth.enabled && !self.auth.username.is_empty() {
            Some((self.auth.username.clone(), self.auth.password.clone()))
        } else {
            None
        };

        WsProxyAction::Tunnel(ProxyEndpoint {
            scheme,
            host: self.host.clone(),
            port: self.port,
            auth,
        })
    }

    /// Resolve the proxy decision for `url` from a settings snapshot. Lives on
    /// the settings rather than on [`ProxyState`] so callers that only hold a
    /// clone — script `sendRequest`, which runs on a blocking thread with no
    /// access to Tauri state — reach the same decision as the HTTP path.
    pub fn proxy_action(&self, url: &str) -> ProxyAction {
        if !self.enabled {
            return ProxyAction::Disable;
        }

        if Self::should_bypass(url, &self.bypass_list) {
            return ProxyAction::Disable;
        }

        if self.use_system_proxy {
            return ProxyAction::UseSystem;
        }

        let proxy_url = format!("{}://{}:{}", self.proxy_type, self.host, self.port);

        let mut proxy = match Proxy::all(&proxy_url) {
            Ok(p) => p,
            Err(_) => return ProxyAction::Disable,
        };

        if self.auth.enabled && !self.auth.username.is_empty() {
            proxy = proxy.basic_auth(&self.auth.username, &self.auth.password);
        }

        ProxyAction::Manual(Box::new(proxy))
    }

    /// Shared by both resolvers so the bypass rules cannot drift apart.
    fn should_bypass(url: &str, bypass_list: &[String]) -> bool {
        if let Ok(parsed) = url::Url::parse(url) {
            if let Some(host) = parsed.host_str() {
                for pattern in bypass_list {
                    let pattern = pattern.trim();
                    if pattern.is_empty() {
                        continue;
                    }

                    if pattern == host {
                        return true;
                    }

                    if let Some(domain) = pattern.strip_prefix("*.") {
                        if host.ends_with(domain) {
                            return true;
                        }
                    }

                    if pattern.starts_with('.') && host.ends_with(pattern) {
                        return true;
                    }
                }
            }
        }
        false
    }
}

/// Parse a proxy URL from the environment into an endpoint. A bare
/// `host:port` (accepted by most tools) is treated as `http://`.
pub(crate) fn parse_proxy_url(raw: &str) -> Option<ProxyEndpoint> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }

    let normalized = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("http://{}", raw)
    };

    let parsed = url::Url::parse(&normalized).ok()?;
    let scheme = match parsed.scheme() {
        "http" => ProxyScheme::Http,
        "https" => ProxyScheme::Https,
        _ => return None,
    };
    let host = parsed.host_str()?.to_string();
    let port = parsed.port().unwrap_or(match scheme {
        ProxyScheme::Http => 80,
        ProxyScheme::Https => 443,
    });

    let auth = match (parsed.username(), parsed.password()) {
        ("", _) => None,
        (user, password) => Some((
            urlencoding_decode(user),
            urlencoding_decode(password.unwrap_or_default()),
        )),
    };

    Some(ProxyEndpoint {
        scheme,
        host,
        port,
        auth,
    })
}

/// Percent-decode a userinfo component. Credentials in a proxy URL are
/// percent-encoded, and the proxy expects the decoded bytes.
fn urlencoding_decode(value: &str) -> String {
    percent_decode(value).unwrap_or_else(|| value.to_string())
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = value.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Resolve the ambient proxy for `url` the way conventional tooling does:
/// scheme-specific variable first, then `ALL_PROXY`, with `NO_PROXY` able to
/// veto. Both upper and lower case spellings are accepted.
fn system_proxy_for(url: &str) -> Option<ProxyEndpoint> {
    let is_secure = url::Url::parse(url)
        .ok()
        .is_some_and(|parsed| matches!(parsed.scheme(), "https" | "wss"));

    if let Some(no_proxy) = env_var("NO_PROXY") {
        let patterns: Vec<String> = no_proxy.split(',').map(|p| p.trim().to_string()).collect();
        if patterns.iter().any(|p| p == "*") || ProxySettings::should_bypass(url, &patterns) {
            return None;
        }
    }

    let scheme_var = if is_secure {
        "HTTPS_PROXY"
    } else {
        "HTTP_PROXY"
    };
    let raw = env_var(scheme_var).or_else(|| env_var("ALL_PROXY"))?;
    parse_proxy_url(&raw)
}

/// Read an environment variable in either case, preferring the conventional
/// upper-case spelling.
fn env_var(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .or_else(|| std::env::var(name.to_lowercase()).ok())
        .filter(|value| !value.trim().is_empty())
}

impl ProxyState {
    pub fn get_proxy_config(&self, url: &str) -> ProxyAction {
        self.settings.read().unwrap().proxy_action(url)
    }

    /// Snapshot of the current settings, for callers that need to resolve a
    /// proxy off the Tauri state thread.
    pub fn snapshot(&self) -> ProxySettings {
        self.settings.read().unwrap().clone()
    }
}

#[tauri::command]
pub async fn proxy_get(state: State<'_, ProxyState>) -> Result<ProxySettings, String> {
    Ok(state.settings.read().unwrap().clone())
}

#[tauri::command]
pub async fn proxy_set(
    state: State<'_, ProxyState>,
    app: AppHandle,
    settings: ProxySettings,
) -> Result<ProxySettings, String> {
    *state.settings.write().unwrap() = settings.clone();

    // Persist to store
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(
        PROXY_KEY.to_string(),
        serde_json::to_value(&settings).unwrap(),
    );
    store.save().map_err(|e| e.to_string())?;
    // The store holds the proxy password among other secrets; the plugin writes
    // it with the process umask, so tighten it as `store_set` does.
    super::store::restrict_store_file(&app);

    Ok(settings)
}

#[tauri::command]
pub async fn proxy_test(state: State<'_, ProxyState>) -> Result<serde_json::Value, String> {
    let settings = state.settings.read().unwrap().clone();

    if !settings.enabled {
        return Ok(serde_json::json!({
            "success": false,
            "message": "Proxy is not enabled"
        }));
    }

    let mut client_builder =
        reqwest::Client::builder().timeout(Duration::from_millis(settings.timeout));

    if settings.use_system_proxy {
        // Let reqwest auto-detect system proxy from env vars / platform APIs.
        // Nothing to attach; a successful request proves connectivity works
        // under the system's default routing (which may or may not use a proxy).
    } else {
        if settings.host.is_empty() || settings.port == 0 {
            return Ok(serde_json::json!({
                "success": false,
                "message": "Proxy host and port are required"
            }));
        }

        let proxy_url = format!(
            "{}://{}:{}",
            settings.proxy_type, settings.host, settings.port
        );

        let mut proxy = match Proxy::all(&proxy_url) {
            Ok(p) => p,
            Err(e) => {
                return Ok(serde_json::json!({
                    "success": false,
                    "message": format!("Invalid proxy configuration: {}", e)
                }));
            }
        };

        if settings.auth.enabled && !settings.auth.username.is_empty() {
            proxy = proxy.basic_auth(&settings.auth.username, &settings.auth.password);
        }

        client_builder = client_builder.proxy(proxy);
    }

    let client = match client_builder.build() {
        Ok(c) => c,
        Err(e) => {
            return Ok(serde_json::json!({
                "success": false,
                "message": format!("Failed to create client: {}", e)
            }));
        }
    };

    let start = std::time::Instant::now();

    match client.get("https://api.ipify.org?format=json").send().await {
        Ok(response) => {
            let response_time = start.elapsed().as_millis();
            if let Ok(data) = response.json::<serde_json::Value>().await {
                Ok(serde_json::json!({
                    "success": true,
                    "message": format!("Proxy connection successful ({}ms)", response_time),
                    "ip": data.get("ip"),
                    "responseTime": response_time
                }))
            } else {
                Ok(serde_json::json!({
                    "success": true,
                    "message": format!("Proxy connection successful ({}ms)", response_time),
                    "responseTime": response_time
                }))
            }
        }
        Err(e) => {
            let error_message = if e.is_connect() {
                "Connection refused. Check proxy host and port.".to_string()
            } else if e.is_timeout() {
                "Connection timed out. Proxy may be unreachable.".to_string()
            } else {
                e.to_string()
            };

            Ok(serde_json::json!({
                "success": false,
                "message": error_message
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_with(settings: ProxySettings) -> ProxyState {
        ProxyState {
            settings: RwLock::new(settings),
        }
    }

    fn enabled_manual() -> ProxySettings {
        ProxySettings {
            enabled: true,
            host: "127.0.0.1".to_string(),
            port: 3128,
            ..ProxySettings::default()
        }
    }

    #[test]
    fn defaults_are_the_settings_ui_defaults_not_the_derived_ones() {
        let settings = ProxySettings::default();
        assert_eq!(settings.proxy_type, "http");
        assert_eq!(settings.port, 8080);
        assert_eq!(settings.timeout, 10000);
        assert!(!settings.enabled);
    }

    #[test]
    fn parses_a_full_settings_payload() {
        let value = serde_json::json!({
            "enabled": true,
            "useSystemProxy": false,
            "type": "socks5",
            "host": "proxy.example.com",
            "port": 1080,
            "auth": { "enabled": true, "username": "u", "password": "p" },
            "bypassList": ["localhost"],
            "timeout": 5000
        });
        let settings = parse_settings(value).expect("expected settings");
        assert!(settings.enabled);
        assert_eq!(settings.proxy_type, "socks5");
        assert_eq!(settings.port, 1080);
        assert_eq!(settings.auth.username, "u");
        assert_eq!(settings.bypass_list, vec!["localhost".to_string()]);
    }

    #[test]
    fn parses_a_legacy_payload_by_falling_back_per_field() {
        // The shape an older build persisted; unknown keys are ignored and the
        // missing ones fall back rather than failing the whole parse.
        let value = serde_json::json!({
            "enabled": false,
            "mode": "manual",
            "manualConfig": { "httpProxy": "", "httpsProxy": "", "noProxy": "" }
        });
        let settings = parse_settings(value).expect("expected settings");
        assert!(!settings.enabled);
        assert_eq!(settings.proxy_type, "http");
        assert_eq!(settings.port, 8080);
    }

    #[test]
    fn rejects_a_non_object_payload() {
        assert!(parse_settings(Value::Null).is_none());
        assert!(parse_settings(serde_json::json!("nope")).is_none());
        assert!(parse_settings(serde_json::json!([1, 2])).is_none());
    }

    #[test]
    fn rejects_a_payload_whose_field_types_are_wrong() {
        let value = serde_json::json!({ "port": "8080" });
        assert!(parse_settings(value).is_none());
    }

    #[test]
    fn disabled_settings_always_disable_the_proxy() {
        let state = state_with(ProxySettings::default());
        assert!(matches!(
            state.get_proxy_config("https://example.com"),
            ProxyAction::Disable
        ));
    }

    #[test]
    fn enabled_settings_produce_a_manual_proxy() {
        let state = state_with(enabled_manual());
        assert!(matches!(
            state.get_proxy_config("https://example.com"),
            ProxyAction::Manual(_)
        ));
    }

    /// A settings snapshot must reach the same decision as the live state, so
    /// script `sendRequest` proxies exactly as the main request path does.
    #[test]
    fn a_snapshot_resolves_the_same_action_as_the_state() {
        let state = state_with(enabled_manual());
        let snapshot = state.snapshot();

        assert!(matches!(
            snapshot.proxy_action("https://example.com"),
            ProxyAction::Manual(_)
        ));
        assert!(matches!(
            ProxySettings::default().proxy_action("https://example.com"),
            ProxyAction::Disable
        ));
    }

    #[test]
    fn ws_tunnels_through_a_manual_http_proxy() {
        let settings = ProxySettings {
            auth: ProxyAuth {
                enabled: true,
                username: "user".to_string(),
                password: "secret".to_string(),
            },
            ..enabled_manual()
        };

        assert_eq!(
            settings.ws_proxy_action("wss://example.com/socket"),
            WsProxyAction::Tunnel(ProxyEndpoint {
                scheme: ProxyScheme::Http,
                host: "127.0.0.1".to_string(),
                port: 3128,
                auth: Some(("user".to_string(), "secret".to_string())),
            })
        );
    }

    /// The WebSocket resolver must agree with the HTTP one about *whether* to
    /// proxy, or a bypassed host would be tunnelled on one path and not the other.
    #[test]
    fn ws_honours_the_same_disable_and_bypass_rules_as_http() {
        assert_eq!(
            ProxySettings::default().ws_proxy_action("wss://example.com"),
            WsProxyAction::Direct
        );

        let settings = ProxySettings {
            bypass_list: vec!["*.internal.test".to_string()],
            ..enabled_manual()
        };
        assert_eq!(
            settings.ws_proxy_action("wss://api.internal.test/socket"),
            WsProxyAction::Direct
        );
        assert!(matches!(
            settings.ws_proxy_action("wss://example.com/socket"),
            WsProxyAction::Tunnel(_)
        ));
    }

    /// A SOCKS proxy must be reported, never silently ignored: falling back to a
    /// direct connection would leak traffic the user asked to have proxied.
    #[test]
    fn ws_reports_socks_rather_than_connecting_direct() {
        for proxy_type in ["socks4", "socks5", "SOCKS5"] {
            let settings = ProxySettings {
                proxy_type: proxy_type.to_string(),
                ..enabled_manual()
            };
            assert_eq!(
                settings.ws_proxy_action("wss://example.com/socket"),
                WsProxyAction::Unsupported {
                    proxy_type: proxy_type.to_ascii_lowercase()
                },
                "{} should be reported as unsupported",
                proxy_type
            );
        }
    }

    #[test]
    fn parses_proxy_urls_from_the_environment() {
        assert_eq!(
            parse_proxy_url("http://proxy.test:3128"),
            Some(ProxyEndpoint {
                scheme: ProxyScheme::Http,
                host: "proxy.test".to_string(),
                port: 3128,
                auth: None,
            })
        );

        // A bare host:port is what most tooling accepts; default to http.
        assert_eq!(
            parse_proxy_url("proxy.test:8080").map(|e| (e.scheme, e.port)),
            Some((ProxyScheme::Http, 8080))
        );

        // Scheme defaults when the port is omitted.
        assert_eq!(
            parse_proxy_url("https://proxy.test").map(|e| e.port),
            Some(443)
        );

        // Credentials are percent-decoded before they reach the proxy.
        assert_eq!(
            parse_proxy_url("http://us%40er:p%40ss@proxy.test:3128").and_then(|e| e.auth),
            Some(("us@er".to_string(), "p@ss".to_string()))
        );

        assert_eq!(parse_proxy_url(""), None);
        assert_eq!(parse_proxy_url("socks5://proxy.test:1080"), None);
    }

    #[test]
    fn a_bypassed_host_disables_the_proxy() {
        let settings = ProxySettings {
            bypass_list: vec!["*.internal.test".to_string(), "localhost".to_string()],
            ..enabled_manual()
        };

        assert!(matches!(
            settings.proxy_action("https://api.internal.test/v1"),
            ProxyAction::Disable
        ));
        assert!(matches!(
            settings.proxy_action("http://localhost:8080"),
            ProxyAction::Disable
        ));
        assert!(matches!(
            settings.proxy_action("https://example.com"),
            ProxyAction::Manual(_)
        ));
    }

    #[test]
    fn system_proxy_takes_precedence_over_manual_host() {
        let state = state_with(ProxySettings {
            use_system_proxy: true,
            ..enabled_manual()
        });
        assert!(matches!(
            state.get_proxy_config("https://example.com"),
            ProxyAction::UseSystem
        ));
    }

    #[test]
    fn bypass_matches_exact_host_and_wildcard_and_dot_prefixes() {
        let state = state_with(ProxySettings {
            bypass_list: vec![
                "localhost".to_string(),
                "*.internal.test".to_string(),
                ".corp.example".to_string(),
                "  ".to_string(),
            ],
            ..enabled_manual()
        });

        for bypassed in [
            "http://localhost:3000/x",
            "https://api.internal.test/x",
            "https://internal.test/x",
            "https://host.corp.example/x",
        ] {
            assert!(
                matches!(state.get_proxy_config(bypassed), ProxyAction::Disable),
                "{} should bypass the proxy",
                bypassed
            );
        }
    }

    #[test]
    fn bypass_does_not_match_an_unrelated_host() {
        let state = state_with(ProxySettings {
            bypass_list: vec!["localhost".to_string(), "*.internal.test".to_string()],
            ..enabled_manual()
        });
        assert!(matches!(
            state.get_proxy_config("https://example.com"),
            ProxyAction::Manual(_)
        ));
    }

    #[test]
    fn an_unparseable_url_does_not_bypass() {
        let state = state_with(ProxySettings {
            bypass_list: vec!["localhost".to_string()],
            ..enabled_manual()
        });
        assert!(matches!(
            state.get_proxy_config("not a url"),
            ProxyAction::Manual(_)
        ));
    }

    #[test]
    fn an_enabled_proxy_with_no_host_disables_rather_than_panicking() {
        let state = state_with(ProxySettings {
            host: String::new(),
            ..enabled_manual()
        });
        assert!(matches!(
            state.get_proxy_config("https://example.com"),
            ProxyAction::Disable
        ));
    }
}
