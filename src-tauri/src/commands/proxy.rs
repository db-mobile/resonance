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

impl ProxyState {
    pub fn get_proxy_config(&self, url: &str) -> ProxyAction {
        let settings = self.settings.read().unwrap();

        if !settings.enabled {
            return ProxyAction::Disable;
        }

        if self.should_bypass(url, &settings.bypass_list) {
            return ProxyAction::Disable;
        }

        if settings.use_system_proxy {
            return ProxyAction::UseSystem;
        }

        let proxy_url = format!(
            "{}://{}:{}",
            settings.proxy_type, settings.host, settings.port
        );

        let mut proxy = match Proxy::all(&proxy_url) {
            Ok(p) => p,
            Err(_) => return ProxyAction::Disable,
        };

        if settings.auth.enabled && !settings.auth.username.is_empty() {
            proxy = proxy.basic_auth(&settings.auth.username, &settings.auth.password);
        }

        ProxyAction::Manual(Box::new(proxy))
    }

    fn should_bypass(&self, url: &str, bypass_list: &[String]) -> bool {
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
