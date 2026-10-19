//! Per-request cancellation handles.
//!
//! Each in-flight request registers under its own id, so cancelling one tab's
//! request can never reach another's, and a request finishing only removes its
//! own entry.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct CancelRegistry {
    senders: Mutex<HashMap<String, (u64, oneshot::Sender<()>)>>,
    next_generation: AtomicU64,
}

/// Removes its registry entry when the request ends, whichever way it ends.
pub struct CancelGuard<'a> {
    registry: &'a CancelRegistry,
    id: Option<String>,
    generation: u64,
    _anonymous: Option<oneshot::Sender<()>>,
}

impl CancelRegistry {
    /// Registers a cancellable request. Without an id the request cannot be
    /// cancelled, but the receiver still never resolves on its own.
    pub fn register(&self, id: Option<String>) -> (oneshot::Receiver<()>, CancelGuard<'_>) {
        let (tx, rx) = oneshot::channel();
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let anonymous = match &id {
            Some(id) => {
                self.senders
                    .lock()
                    .unwrap()
                    .insert(id.clone(), (generation, tx));
                None
            }
            None => Some(tx),
        };
        (
            rx,
            CancelGuard {
                registry: self,
                id,
                generation,
                _anonymous: anonymous,
            },
        )
    }

    /// Signals the request registered under `id`. Returns whether one was found.
    pub fn cancel(&self, id: &str) -> bool {
        let entry = self.senders.lock().unwrap().remove(id);
        match entry {
            Some((_, tx)) => {
                let _ = tx.send(());
                true
            }
            None => false,
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.senders.lock().unwrap().len()
    }
}

impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        if let Some(id) = &self.id {
            let mut senders = self.registry.senders.lock().unwrap();
            if senders.get(id).is_some_and(|(g, _)| *g == self.generation) {
                senders.remove(id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelling_one_request_leaves_the_other_alone() {
        let registry = CancelRegistry::default();
        let (mut rx_a, _guard_a) = registry.register(Some("a".into()));
        let (mut rx_b, _guard_b) = registry.register(Some("b".into()));

        assert!(registry.cancel("a"));

        assert_eq!(rx_a.try_recv(), Ok(()));
        assert!(matches!(
            rx_b.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
    }

    #[test]
    fn a_finished_request_removes_only_its_own_entry() {
        let registry = CancelRegistry::default();
        let (_rx_a, guard_a) = registry.register(Some("a".into()));
        let (_rx_b, _guard_b) = registry.register(Some("b".into()));

        drop(guard_a);

        assert_eq!(registry.len(), 1);
        assert!(!registry.cancel("a"));
        assert!(registry.cancel("b"));
    }

    #[test]
    fn a_stale_guard_does_not_remove_a_reused_id() {
        let registry = CancelRegistry::default();
        let (_rx_old, guard_old) = registry.register(Some("a".into()));
        let (mut rx_new, _guard_new) = registry.register(Some("a".into()));

        drop(guard_old);

        assert!(registry.cancel("a"));
        assert_eq!(rx_new.try_recv(), Ok(()));
    }

    #[test]
    fn cancelling_after_completion_is_a_no_op() {
        let registry = CancelRegistry::default();
        {
            let (_rx, _guard) = registry.register(Some("a".into()));
        }
        assert!(!registry.cancel("a"));
    }

    #[test]
    fn an_anonymous_request_never_resolves_by_itself() {
        let registry = CancelRegistry::default();
        let (mut rx, _guard) = registry.register(None);
        assert!(matches!(
            rx.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        assert_eq!(registry.len(), 0);
    }
}
