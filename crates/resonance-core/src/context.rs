//! Execution settings and desktop-neutral certificate inputs.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthKind {
    #[default]
    None,
    Inherit,
    Bearer,
    Basic,
    ApiKey,
    #[serde(rename = "oauth2")]
    OAuth2,
    Digest,
    Ntlm,
    AwsV4,
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AuthTemplate {
    #[serde(rename = "type")]
    pub kind: AuthKind,
    /// Values stay templatable JSON until variable substitution. OAuth expiry
    /// is numeric, while credentials and grant parameters are strings.
    pub config: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AuthOrigin {
    Request,
    Collection,
    Folder {
        #[serde(rename = "folderId")]
        folder_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CookieExpiry {
    Timestamp(i64),
    Date(String),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Cookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: Option<String>,
    pub expires: Option<CookieExpiry>,
    pub host_only: bool,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExecutionSettings {
    pub request_timeout: Option<u64>,
    /// Legacy alias used when requestTimeout is absent.
    pub timeout: Option<u64>,
    pub http_version: Option<String>,
    pub verify_ssl: Option<bool>,
    pub follow_redirects: Option<bool>,
    pub cookie_jar_enabled: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Certificate {
    pub host: String,
    pub enabled: Option<bool>,
    pub cert_path: Option<String>,
    pub key_path: Option<String>,
    pub ca_path: Option<String>,
}
