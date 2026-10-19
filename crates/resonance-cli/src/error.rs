//! Failures that end the program before or around a run. Every one of them
//! is a usage or configuration problem and exits with 2; run outcomes are
//! exit codes 0, 1 and 130, decided in `run`.
use resonance_collections::LoadError;
use std::fmt;
use std::path::PathBuf;

#[derive(Debug)]
pub enum CliError {
    Usage(String),
    Config(String),
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    Load(LoadError),
}

impl CliError {
    pub fn exit_code(&self) -> u8 {
        2
    }
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CliError::Usage(message) | CliError::Config(message) => f.write_str(message),
            CliError::Io { path, source } => write!(f, "{}: {}", path.display(), source),
            CliError::Load(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for CliError {}

impl From<LoadError> for CliError {
    fn from(error: LoadError) -> Self {
        CliError::Load(error)
    }
}
