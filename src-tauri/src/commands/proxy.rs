use reqwest::Proxy;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use std::time::Duration;
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "resonance-store.json";
const PROXY_KEY: &str = "proxySettings";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
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
            settings: RwLock::new(ProxySettings {
                enabled: false,
                use_system_proxy: false,
                proxy_type: "http".to_string(),
                host: String::new(),
                port: 8080,
                auth: ProxyAuth::default(),
                bypass_list: Vec::new(),
                timeout: 10000,
            }),
        }
    }
}

impl ProxyState {
    pub fn get_proxy_config(&self, url: &str) -> Option<Proxy> {
        let settings = self.settings.read().unwrap();

        if !settings.enabled {
            return None;
        }

        if self.should_bypass(url, &settings.bypass_list) {
            return None;
        }

        let proxy_url = format!(
            "{}://{}:{}",
            settings.proxy_type, settings.host, settings.port
        );

        let mut proxy = Proxy::all(&proxy_url).ok()?;

        if settings.auth.enabled && !settings.auth.username.is_empty() {
            proxy = proxy.basic_auth(&settings.auth.username, &settings.auth.password);
        }

        Some(proxy)
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

    let client = match reqwest::Client::builder()
        .proxy(proxy)
        .timeout(Duration::from_millis(settings.timeout))
        .build()
    {
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
