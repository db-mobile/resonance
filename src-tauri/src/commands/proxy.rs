use super::store_files::MAIN_STORE as STORE_FILE;
use reqwest::Proxy;
pub use resonance_core::proxy::*;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;
const PROXY_KEY: &str = "proxySettings";

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

    super::tls::ensure_crypto_provider();
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
