//! Compact, run-local collection snapshots. Projection never writes files or
//! includes the full collection tree in a selected request's payload.

use resonance_core::scripts::ScriptData;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

use crate::{
    ipc::{self, EndpointData},
    read::{FolderNode, LoadedCollection, folder_display_name},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetRef {
    pub collection_id: String,
    pub endpoint_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSnapshot {
    pub collection_id: String,
    pub collection: Option<CollectionMetadata>,
    pub variables: Vec<Value>,
    pub targets: Vec<TargetSnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionMetadata {
    pub id: String,
    pub base_url: String,
    pub default_headers: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSnapshot {
    pub endpoint_id: String,
    pub endpoint: Option<Value>,
    pub persisted: EndpointData,
    pub inherited_auth: Vec<Value>,
    pub scripts: ScriptData,
}

impl CollectionSnapshot {
    pub fn missing(id: &str, endpoint_ids: &[String]) -> Self {
        Self {
            collection_id: id.into(),
            collection: None,
            variables: Vec::new(),
            targets: endpoint_ids
                .iter()
                .map(|id| target(id, None, EndpointData::default(), Vec::new()))
                .collect(),
        }
    }
}

/// Calls the loader once per collection and preserves first-seen reference
/// order. Duplicate queue visits are expanded later, after template capture.
pub fn capture_collections(
    refs: &[TargetRef],
    mut load: impl FnMut(&str, &[String]) -> CollectionSnapshot,
) -> Vec<CollectionSnapshot> {
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    let mut indexes = HashMap::new();
    let mut seen = HashSet::new();
    for reference in refs {
        if !seen.insert((&reference.collection_id, &reference.endpoint_id)) {
            continue;
        }
        let index = *indexes.entry(&reference.collection_id).or_insert_with(|| {
            groups.push((reference.collection_id.clone(), Vec::new()));
            groups.len() - 1
        });
        groups[index].1.push(reference.endpoint_id.clone());
    }
    groups
        .into_iter()
        .map(|(id, endpoints)| load(&id, &endpoints))
        .collect()
}

fn target(
    id: &str,
    endpoint: Option<Value>,
    mut persisted: EndpointData,
    inherited_auth: Vec<Value>,
) -> TargetSnapshot {
    let scripts = persisted
        .scripts
        .take()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_else(|| ScriptData {
            pre_request_script: String::new(),
            test_script: String::new(),
        });
    TargetSnapshot {
        endpoint_id: id.into(),
        endpoint,
        persisted,
        inherited_auth,
        scripts,
    }
}

fn auth(source: Value, config: Option<&Value>, default: &str) -> Value {
    json!({ "source": source, "authConfig": config.filter(|v| !v.is_null()).cloned()
        .unwrap_or_else(|| json!({"type": default, "config": {}})) })
}

pub fn from_loaded(id: &str, loaded: &LoadedCollection, ids: &[String]) -> CollectionSnapshot {
    let wanted: HashSet<&str> = ids.iter().map(String::as_str).collect();
    let mut found = HashMap::new();
    let collection_auth = auth(
        json!({"kind":"collection"}),
        loaded.meta.auth.as_ref(),
        "none",
    );
    visit(
        &loaded.root,
        &wanted,
        &mut Vec::new(),
        &mut Vec::new(),
        &mut found,
    );
    CollectionSnapshot {
        collection_id: id.into(),
        collection: Some(CollectionMetadata {
            id: loaded.meta.id.clone(),
            base_url: loaded.meta.base_url.clone(),
            default_headers: loaded
                .meta
                .default_headers
                .clone()
                .unwrap_or_else(|| json!({})),
        }),
        variables: loaded.variables.clone(),
        targets: ids
            .iter()
            .map(|endpoint_id| {
                let (endpoint, persisted, mut parents) =
                    found.remove(endpoint_id).unwrap_or_default();
                parents.push(collection_auth.clone());
                target(endpoint_id, endpoint, persisted, parents)
            })
            .collect(),
    }
}

type Selected = (Option<Value>, EndpointData, Vec<Value>);

fn visit(
    node: &FolderNode,
    wanted: &HashSet<&str>,
    parents: &mut Vec<Value>,
    path: &mut Vec<String>,
    found: &mut HashMap<String, Selected>,
) {
    for entry in &node.requests {
        if wanted.contains(entry.doc.id.as_str()) && !found.contains_key(&entry.doc.id) {
            let owner = parents
                .last()
                .and_then(|p| p["source"]["folderId"].as_str());
            found.insert(
                entry.doc.id.clone(),
                (
                    Some(ipc::request_to_endpoint(&entry.doc, owner, path)),
                    ipc::request_to_endpoint_data(&entry.doc),
                    parents.iter().rev().cloned().collect(),
                ),
            );
        }
    }
    for folder in &node.folders {
        parents.push(auth(
            json!({"kind":"folder", "folderId":ipc::folder_id(folder)}),
            folder.meta.as_ref().and_then(|m| m.auth.as_ref()),
            "inherit",
        ));
        path.push(folder_display_name(folder));
        visit(folder, wanted, parents, path, found);
        path.pop();
        parents.pop();
    }
}
