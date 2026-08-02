//! The v2 collection documents as they sit on disk.
//!
//! One YAML file per request, folders mirrored as directories. Every optional
//! field is skipped when empty so a request file carries only what the user
//! actually set, and each document keeps an `extra` catch-all so a field
//! written by a newer build survives a round trip through an older one instead
//! of being silently dropped on the next save.
//!
//! Nothing reads or writes these yet: the reader, writer and v1 conversion
//! land in later steps. Until then the types are exercised only by their own
//! round-trip tests, so dead code is expected here.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The format every v2 document declares in its first key. Bumped only for a
/// change old readers cannot cope with.
pub(crate) const FORMAT_VERSION: u32 = 2;

/// Reads just the version off a document, so a reader can dispatch before
/// committing to a full parse.
#[derive(Debug, Deserialize)]
pub(crate) struct FormatProbe {
    #[serde(rename = "resonanceFormat")]
    pub format: Option<u32>,
}

/// Returns the version a document declares, defaulting to the current one.
///
/// A missing key is treated as current rather than an error: hand-written
/// files are a supported workflow and should not have to know the number.
///
/// @param source - Raw YAML document text
/// @returns The declared format version
pub(crate) fn probe_format(source: &str) -> Result<u32, String> {
    let probe: FormatProbe = serde_yaml_ng::from_str(source)
        .map_err(|e| format!("Failed to read document version: {}", e))?;
    Ok(probe.format.unwrap_or(FORMAT_VERSION))
}

fn default_format() -> u32 {
    FORMAT_VERSION
}

fn is_zero(value: &i64) -> bool {
    *value == 0
}

/// `collection.yaml` — the collection's own metadata. Holds no request tree;
/// the directory structure is the tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CollectionDoc {
    #[serde(rename = "resonanceFormat", default = "default_format")]
    pub format: u32,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_headers: Option<Value>,
    /// `{type, config}`, secrets blanked before write.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<Value>,
    /// File name of the imported spec beside this document, e.g. `openapi.yaml`.
    /// The spec itself is never inlined here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open_api_spec: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

/// `_folder.yaml` — a folder's metadata. Optional: a directory with no such
/// file is still a folder, named after the directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderDoc {
    #[serde(rename = "resonanceFormat", default = "default_format")]
    pub format: u32,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub seq: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<Value>,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

/// Key/value rows for a request, each bucket omitted when empty. Rows stay
/// opaque so a key the backend does not know about is not dropped.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Params {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub path: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub query: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<Value>,
}

impl Params {
    pub fn is_empty(&self) -> bool {
        self.path.is_empty() && self.query.is_empty() && self.headers.is_empty()
    }
}

/// Pre-request and test scripts, written as literal block scalars.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Scripts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_request: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test: Option<String>,
}

impl Scripts {
    pub fn is_empty(&self) -> bool {
        self.pre_request.is_none() && self.test.is_none()
    }
}

/// OpenAPI-derived reference material. Large and rarely hand-edited, so it
/// sits last in a request file, never between two fields a human touches.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Spec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_body: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub responses: Option<Value>,
}

impl Spec {
    pub fn is_empty(&self) -> bool {
        self.parameters.is_none() && self.request_body.is_none() && self.responses.is_none()
    }
}

/// A request body, collapsing the three separate v1 fields (`modifiedBody`,
/// `formBodyData`, `graphqlData`) into one value tagged by mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub(crate) enum Body {
    Known(BodyKind),
    /// A mode written by a newer build; carried through untouched.
    Other(Value),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub(crate) enum BodyKind {
    Json {
        #[serde(default)]
        content: String,
    },
    Text {
        #[serde(default)]
        content: String,
    },
    #[serde(rename = "formdata")]
    FormData {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        fields: Vec<Value>,
    },
    #[serde(rename = "urlencoded")]
    UrlEncoded {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        fields: Vec<Value>,
    },
    Binary {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        file_path: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        content_type: String,
    },
    Graphql {
        #[serde(default)]
        query: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        variables: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        operation_name: Option<String>,
    },
}

/// One request, as one file. Fields run identity, then addressing, then the
/// state the user edits, then reference material.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RequestDoc {
    #[serde(rename = "resonanceFormat", default = "default_format")]
    pub format: u32,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub seq: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// The HTTP verb an SSE request carries alongside its protocol method.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The absolute URL, for protocols whose endpoint is a URL rather than a
    /// path under the collection's base.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<Value>,
    #[serde(default, skip_serializing_if = "Params::is_empty")]
    pub params: Params,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Body>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grpc: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mqtt: Option<Value>,
    #[serde(default, skip_serializing_if = "Scripts::is_empty")]
    pub scripts: Scripts,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_schema: Option<Value>,
    #[serde(default, skip_serializing_if = "Spec::is_empty")]
    pub spec: Spec,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

impl RequestDoc {
    /// Builds the minimum viable request document.
    /// @param id - Stable request id, referenced by keychain scopes and store keys
    /// @param name - Display name, also the basis for the file name
    /// @returns A request document with everything else unset
    pub fn new(id: String, name: String) -> Self {
        Self {
            format: FORMAT_VERSION,
            id,
            name,
            seq: 0,
            protocol: None,
            method: None,
            http_method: None,
            path: None,
            description: None,
            url: None,
            auth: None,
            params: Params::default(),
            body: None,
            grpc: None,
            mqtt: None,
            scripts: Scripts::default(),
            response_schema: None,
            spec: Spec::default(),
            extra: Map::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn to_yaml<T: Serialize>(value: &T) -> String {
        serde_yaml_ng::to_string(value).unwrap()
    }

    fn request_with_everything() -> RequestDoc {
        let mut doc = RequestDoc::new("req_1".into(), "Create Pet".into());
        doc.seq = 20;
        doc.protocol = Some("http".into());
        doc.method = Some("POST".into());
        doc.path = Some("/pets".into());
        doc.description = Some("Adds a pet".into());
        doc.url = Some("https://api.example.com/pets".into());
        doc.auth = Some(json!({"type": "bearer", "config": {"token": ""}}));
        doc.params.query = vec![json!({"key": "limit", "value": "20"})];
        doc.params.headers = vec![json!({"key": "Accept", "value": "*/*"})];
        doc.body = Some(Body::Known(BodyKind::Json {
            content: "{\n  \"name\": \"Rex\"\n}\n".into(),
        }));
        doc.grpc = Some(json!({"target": "localhost:50051"}));
        doc.scripts.test = Some("expect(response.status).toBe(201);\n".into());
        doc.response_schema = Some(json!({"type": "object"}));
        doc.spec.responses = Some(json!({"200": {"description": "ok"}}));
        doc
    }

    #[test]
    fn a_fully_populated_request_round_trips() {
        let doc = request_with_everything();
        let parsed: RequestDoc = serde_yaml_ng::from_str(&to_yaml(&doc)).unwrap();

        assert_eq!(to_yaml(&parsed), to_yaml(&doc));
    }

    #[test]
    fn a_minimal_request_writes_only_identity() {
        let yaml = to_yaml(&RequestDoc::new("req_1".into(), "Health".into()));

        assert_eq!(yaml, "resonanceFormat: 2\nid: req_1\nname: Health\n");
    }

    #[test]
    fn no_field_is_written_as_null_or_empty() {
        let yaml = to_yaml(&RequestDoc::new("req_1".into(), "Health".into()));

        assert!(
            !yaml.contains("null"),
            "unset fields must be omitted:\n{}",
            yaml
        );
        assert!(
            !yaml.contains("{}"),
            "empty maps must be omitted:\n{}",
            yaml
        );
        assert!(
            !yaml.contains("[]"),
            "empty lists must be omitted:\n{}",
            yaml
        );
    }

    #[test]
    fn the_format_version_is_the_first_key() {
        let yaml = to_yaml(&request_with_everything());
        assert!(
            yaml.starts_with("resonanceFormat: 2\n"),
            "version must lead the document:\n{}",
            yaml
        );
    }

    /// The reason this format is YAML: a body has to read as literal text in a
    /// diff, not as an escaped one-line string.
    #[test]
    fn a_multiline_body_is_written_as_a_block_scalar() {
        let mut doc = RequestDoc::new("req_1".into(), "Create".into());
        doc.body = Some(Body::Known(BodyKind::Json {
            content: "{\n  \"email\": \"a@b.c\"\n}\n".into(),
        }));

        let yaml = to_yaml(&doc);

        assert!(
            yaml.contains("content: |"),
            "expected a block scalar:\n{}",
            yaml
        );
        assert!(!yaml.contains("\\n"), "body must not be escaped:\n{}", yaml);
    }

    #[test]
    fn a_multiline_script_is_written_as_a_block_scalar() {
        let mut doc = RequestDoc::new("req_1".into(), "Create".into());
        doc.scripts.test = Some("expect(a).toBe(1);\nexpect(b).toBe(2);\n".into());

        let yaml = to_yaml(&doc);

        assert!(
            yaml.contains("test: |"),
            "expected a block scalar:\n{}",
            yaml
        );
        assert!(
            !yaml.contains("\\n"),
            "script must not be escaped:\n{}",
            yaml
        );
    }

    #[test]
    fn a_multiline_graphql_query_is_written_as_a_block_scalar() {
        let mut doc = RequestDoc::new("req_1".into(), "Get User".into());
        doc.body = Some(Body::Known(BodyKind::Graphql {
            query: "query GetUser($id: ID!) {\n  user(id: $id) { name }\n}\n".into(),
            variables: String::new(),
            operation_name: None,
        }));

        let yaml = to_yaml(&doc);
        assert!(
            yaml.contains("query: |"),
            "expected a block scalar:\n{}",
            yaml
        );
    }

    /// libyaml refuses block style when a line carries trailing whitespace and
    /// falls back to a quoted scalar. Pinned so the escaped output is known
    /// behaviour rather than mistaken for a regression later.
    #[test]
    fn trailing_whitespace_forces_a_quoted_scalar() {
        let mut doc = RequestDoc::new("req_1".into(), "Create".into());
        doc.scripts.test = Some("line one   \nline two\n".into());

        let yaml = to_yaml(&doc);
        assert!(
            !yaml.contains("test: |"),
            "expected the quoted fallback:\n{}",
            yaml
        );
    }

    #[test]
    fn every_body_mode_round_trips() {
        let bodies = vec![
            BodyKind::Json {
                content: "{}".into(),
            },
            BodyKind::Text {
                content: "plain".into(),
            },
            BodyKind::FormData {
                fields: vec![json!({"key": "a", "value": "b"})],
            },
            BodyKind::UrlEncoded {
                fields: vec![json!({"key": "a", "value": "b"})],
            },
            BodyKind::Binary {
                file_path: "/tmp/x.bin".into(),
                content_type: "application/octet-stream".into(),
            },
            BodyKind::Graphql {
                query: "{ me }".into(),
                variables: "{}".into(),
                operation_name: Some("Me".into()),
            },
        ];

        for body in bodies {
            let mut doc = RequestDoc::new("req_1".into(), "R".into());
            doc.body = Some(Body::Known(body));

            let yaml = to_yaml(&doc);
            let parsed: RequestDoc = serde_yaml_ng::from_str(&yaml).unwrap();
            assert_eq!(to_yaml(&parsed), yaml, "round trip failed for:\n{}", yaml);
        }
    }

    #[test]
    fn a_body_mode_from_a_newer_build_survives_a_round_trip() {
        let yaml = "resonanceFormat: 2\nid: req_1\nname: R\nbody:\n  mode: protobuf\n  descriptor: pets.desc\n";

        let parsed: RequestDoc = serde_yaml_ng::from_str(yaml).unwrap();
        assert!(matches!(parsed.body, Some(Body::Other(_))));

        let written = to_yaml(&parsed);
        assert!(written.contains("mode: protobuf"), "{}", written);
        assert!(written.contains("descriptor: pets.desc"), "{}", written);
    }

    #[test]
    fn an_unknown_top_level_field_survives_a_round_trip() {
        let yaml = "resonanceFormat: 2\nid: req_1\nname: R\nfutureField: kept\n";

        let parsed: RequestDoc = serde_yaml_ng::from_str(yaml).unwrap();
        assert_eq!(parsed.extra.get("futureField").unwrap(), "kept");
        assert!(to_yaml(&parsed).contains("futureField: kept"));
    }

    #[test]
    fn unknown_keys_inside_a_param_row_survive() {
        let mut doc = RequestDoc::new("req_1".into(), "R".into());
        doc.params.query = vec![json!({"key": "a", "value": "b", "enabled": false})];

        let parsed: RequestDoc = serde_yaml_ng::from_str(&to_yaml(&doc)).unwrap();
        assert_eq!(parsed.params.query[0]["enabled"], false);
    }

    #[test]
    fn spec_response_keys_keep_their_document_order() {
        let mut doc = RequestDoc::new("req_1".into(), "R".into());
        doc.spec.responses = Some(json!({
            "200": {"description": "ok"},
            "404": {"description": "missing"},
            "500": {"description": "boom"}
        }));

        let yaml = to_yaml(&doc);
        let ok = yaml.find("'200'").unwrap();
        let missing = yaml.find("'404'").unwrap();
        let boom = yaml.find("'500'").unwrap();

        assert!(
            ok < missing && missing < boom,
            "order was not preserved:\n{}",
            yaml
        );
    }

    #[test]
    fn a_collection_document_round_trips() {
        let doc = CollectionDoc {
            format: FORMAT_VERSION,
            id: "collection_1".into(),
            name: "Petstore".into(),
            base_url: "https://api.example.com".into(),
            description: None,
            default_headers: Some(json!({"Accept": "application/json"})),
            auth: Some(json!({"type": "bearer", "config": {"token": ""}})),
            open_api_spec: Some("openapi.yaml".into()),
            extra: Map::new(),
        };

        let parsed: CollectionDoc = serde_yaml_ng::from_str(&to_yaml(&doc)).unwrap();
        assert_eq!(to_yaml(&parsed), to_yaml(&doc));
    }

    #[test]
    fn a_collection_document_never_carries_an_absolute_path() {
        let doc = CollectionDoc {
            format: FORMAT_VERSION,
            id: "collection_1".into(),
            name: "Petstore".into(),
            base_url: String::new(),
            description: None,
            default_headers: None,
            auth: None,
            open_api_spec: None,
            extra: Map::new(),
        };

        let yaml = to_yaml(&doc);
        assert!(!yaml.contains("storagePath"), "{}", yaml);
    }

    #[test]
    fn a_folder_document_round_trips() {
        let doc = FolderDoc {
            format: FORMAT_VERSION,
            id: "folder_pets".into(),
            name: "pets".into(),
            seq: 10,
            auth: Some(json!({"type": "inherit", "config": {}})),
            extra: Map::new(),
        };

        let parsed: FolderDoc = serde_yaml_ng::from_str(&to_yaml(&doc)).unwrap();
        assert_eq!(to_yaml(&parsed), to_yaml(&doc));
    }

    #[test]
    fn a_document_without_a_version_reads_as_the_current_one() {
        assert_eq!(
            probe_format("id: req_1\nname: R\n").unwrap(),
            FORMAT_VERSION
        );

        let parsed: RequestDoc = serde_yaml_ng::from_str("id: req_1\nname: R\n").unwrap();
        assert_eq!(parsed.format, FORMAT_VERSION);
    }

    #[test]
    fn a_newer_version_is_reported_by_the_probe() {
        assert_eq!(probe_format("resonanceFormat: 99\nid: r\n").unwrap(), 99);
    }

    #[test]
    fn the_probe_rejects_malformed_yaml() {
        assert!(probe_format("resonanceFormat: [unclosed\n").is_err());
    }

    #[test]
    fn serializing_twice_yields_identical_bytes() {
        let doc = request_with_everything();
        assert_eq!(to_yaml(&doc), to_yaml(&doc));
    }
    /// The golden file. This is what a request looks like on disk, and the
    /// reason the format changed: bodies and scripts read as literal text, the
    /// `*/*` header is quoted rather than parsed as a YAML alias, and nothing
    /// is written that the user did not set.
    #[test]
    fn a_realistic_request_matches_the_documented_layout() {
        let mut doc = RequestDoc::new("req_1730000000_a1b2c3d".into(), "Create Pet".into());
        doc.seq = 20;
        doc.protocol = Some("http".into());
        doc.method = Some("POST".into());
        doc.path = Some("/pets".into());
        doc.auth = Some(json!({
            "type": "api-key",
            "config": {"keyName": "X-Api-Key", "keyValue": "", "location": "header"}
        }));
        doc.params.headers = vec![
            json!({"key": "Content-Type", "value": "application/json"}),
            json!({"key": "Accept", "value": "*/*"}),
        ];
        doc.body = Some(Body::Known(BodyKind::Json {
            content: "{\n  \"email\": \"a@b.c\",\n  \"name\": \"Ada\"\n}\n".into(),
        }));
        doc.scripts.test = Some(
            "expect(response.status).toBe(201);\nexpect(response.json().id).toBeDefined();\n"
                .into(),
        );
        doc.spec.request_body = Some(json!({"schema": {"$ref": "#/components/schemas/NewPet"}}));

        let expected = r#"resonanceFormat: 2
id: req_1730000000_a1b2c3d
name: Create Pet
seq: 20
protocol: http
method: POST
path: /pets
auth:
  type: api-key
  config:
    keyName: X-Api-Key
    keyValue: ''
    location: header
params:
  headers:
  - key: Content-Type
    value: application/json
  - key: Accept
    value: '*/*'
body:
  mode: json
  content: |
    {
      "email": "a@b.c",
      "name": "Ada"
    }
scripts:
  test: |
    expect(response.status).toBe(201);
    expect(response.json().id).toBeDefined();
spec:
  requestBody:
    schema:
      $ref: '#/components/schemas/NewPet'
"#;

        assert_eq!(to_yaml(&doc), expected);
    }
}
