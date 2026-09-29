//! Per-tab registry shared by the streaming transports (SSE, WebSocket, gRPC
//! streaming, MQTT).
//!
//! Every entry is stamped with a generation when it is inserted. A background
//! task holds on to its own generation and may only remove the entry — or
//! report a terminal event for the tab — while that generation is still the
//! current one. That is what stops a superseded connection, still unwinding
//! after a reconnect on the same tab, from deleting its successor or closing
//! the successor's UI.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{Mutex, MutexGuard};

/// A registered session and the generation that owns it.
pub(crate) struct Session<T> {
    pub generation: u64,
    pub value: T,
}

pub(crate) type SessionMap<T> = HashMap<String, Session<T>>;

/// Cheap to clone: clones share the same map and generation counter, so a
/// task can carry one to clean up after itself.
pub(crate) struct TabSessions<T> {
    entries: Arc<Mutex<SessionMap<T>>>,
    next_generation: Arc<AtomicU64>,
}

impl<T> Default for TabSessions<T> {
    fn default() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
            next_generation: Arc::new(AtomicU64::new(1)),
        }
    }
}

impl<T> Clone for TabSessions<T> {
    fn clone(&self) -> Self {
        Self {
            entries: Arc::clone(&self.entries),
            next_generation: Arc::clone(&self.next_generation),
        }
    }
}

impl<T> TabSessions<T> {
    /// A generation no other session has used, for the entry about to be inserted.
    pub fn next_generation(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::Relaxed)
    }

    /// Locks the map. Hold the guard across spawn + insert when the spawned
    /// task might finish before the entry exists.
    pub async fn lock(&self) -> MutexGuard<'_, SessionMap<T>> {
        self.entries.lock().await
    }

    /// Removes the tab's entry only if `generation` still owns it, returning
    /// the removed value. `None` means the caller was superseded or already
    /// removed, and must stay silent.
    pub async fn remove_if_current(&self, tab_id: &str, generation: u64) -> Option<T> {
        let mut entries = self.entries.lock().await;
        if entries.get(tab_id)?.generation != generation {
            return None;
        }
        entries.remove(tab_id).map(|session| session.value)
    }
}

/// The `{ success: true }` reply every streaming command returns.
#[derive(Debug, Serialize)]
pub struct CommandAck {
    pub success: bool,
}

impl CommandAck {
    pub fn ok() -> Self {
        Self { success: true }
    }
}

/// Rejects a blank tab id, which would otherwise share one registry slot
/// across every tab that sent it.
pub(crate) fn require_tab_id(tab_id: &str) -> Result<(), String> {
    if tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn insert(
        sessions: &TabSessions<&'static str>,
        tab_id: &str,
        value: &'static str,
    ) -> u64 {
        let generation = sessions.next_generation();
        sessions
            .lock()
            .await
            .insert(tab_id.to_string(), Session { generation, value });
        generation
    }

    #[tokio::test]
    async fn the_current_generation_removes_its_own_entry() {
        let sessions = TabSessions::default();
        let generation = insert(&sessions, "tab-1", "first").await;

        assert_eq!(
            sessions.remove_if_current("tab-1", generation).await,
            Some("first")
        );
        assert!(sessions.lock().await.is_empty());
    }

    #[tokio::test]
    async fn a_superseded_generation_cannot_remove_its_successor() {
        let sessions = TabSessions::default();
        let old = insert(&sessions, "tab-1", "old").await;
        let new = insert(&sessions, "tab-1", "new").await;

        assert_eq!(sessions.remove_if_current("tab-1", old).await, None);
        assert_eq!(sessions.lock().await["tab-1"].generation, new);
        assert_eq!(sessions.remove_if_current("tab-1", new).await, Some("new"));
    }

    #[tokio::test]
    async fn removal_is_scoped_to_the_tab() {
        let sessions = TabSessions::default();
        let one = insert(&sessions, "tab-1", "a").await;
        insert(&sessions, "tab-2", "b").await;

        assert_eq!(sessions.remove_if_current("tab-2", one).await, None);
        assert_eq!(sessions.lock().await.len(), 2);
    }

    #[tokio::test]
    async fn clones_share_one_registry_and_counter() {
        let sessions = TabSessions::default();
        let clone = sessions.clone();
        let generation = insert(&clone, "tab-1", "a").await;

        assert_ne!(sessions.next_generation(), generation);
        assert_eq!(
            sessions.remove_if_current("tab-1", generation).await,
            Some("a")
        );
    }

    #[test]
    fn a_blank_tab_id_is_rejected() {
        assert!(require_tab_id("tab-1").is_ok());
        assert_eq!(require_tab_id("  ").unwrap_err(), "Tab ID is required");
    }

    #[test]
    fn the_ack_keeps_its_wire_shape() {
        assert_eq!(
            serde_json::to_value(CommandAck::ok()).unwrap(),
            serde_json::json!({ "success": true })
        );
    }
}
