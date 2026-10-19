//! Presenting a run: progress on the console while it happens, report files
//! afterwards.
pub mod console;
pub mod files;

pub use console::{ConsoleReporter, Verbosity, has_failures};
pub use files::write_reports;
