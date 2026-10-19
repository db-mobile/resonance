//! Filesystem permission hardening lives in `resonance-collections`; the
//! desktop re-exports it for the store and startup code.
pub use resonance_collections::fs_secure::{restrict_dir, restrict_file};
