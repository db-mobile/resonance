//! Reading and writing Resonance v2 collection directories, and turning what
//! they hold into execution-core inputs. Tauri-free: the desktop adapts these
//! functions behind its IPC commands and a headless caller uses them directly.
pub mod address;
pub mod cache;
pub mod capture;
pub mod fs_secure;
pub mod git;
pub mod ipc;
pub mod layout;
pub mod legacy;
pub mod link;
pub mod load;
pub mod model;
pub mod read;
pub mod runners;
pub mod secrets;
pub mod startup;
pub mod variables;
pub mod write;

pub use load::{LoadError, load_collection};
pub use read::{FolderNode, LoadedCollection, RequestEntry};
