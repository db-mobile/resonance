//! The command-line surface.
use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(
    name = "resonance",
    version,
    about = "Run Resonance collections from the command line"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Run requests, a folder or a saved runner of a collection
    Run(Box<RunArgs>),
    /// List the requests and runners of a collection
    List(ListArgs),
}

#[derive(Debug, Args)]
pub struct RunArgs {
    /// Collection directory (the one holding collection.yaml)
    pub collection: PathBuf,
    /// Request file paths, folder paths, request ids or names; none runs the whole collection
    #[arg(conflicts_with = "runner")]
    pub selectors: Vec<String>,
    /// Saved runner to run, by file stem, name or id (runners/<stem>.yaml)
    #[arg(long, value_name = "NAME")]
    pub runner: Option<String>,

    /// Set a variable (repeatable); RESONANCE_VAR_<KEY> environment variables work too
    #[arg(long = "var", value_name = "KEY=VALUE")]
    pub vars: Vec<String>,
    /// Environment export from the desktop app (JSON)
    #[arg(long, value_name = "FILE")]
    pub env_file: Option<PathBuf>,
    /// Environment to pick from --env-file when it holds several
    #[arg(long, value_name = "NAME", requires = "env_file")]
    pub env: Option<String>,

    /// Run the queue this many times
    #[arg(short = 'n', long, value_name = "N", value_parser = clap::value_parser!(u64).range(1..=1000), conflicts_with = "data")]
    pub iterations: Option<u64>,
    /// CSV or JSON data file; one iteration per row (overrides a runner's data file)
    #[arg(short = 'd', long, value_name = "FILE")]
    pub data: Option<PathBuf>,
    /// Pause between requests in milliseconds
    #[arg(long, value_name = "MS")]
    pub delay: Option<u64>,
    /// Stop at the first failed request (default for plain requests: off; for runners: the file's setting)
    #[arg(long, overrides_with = "no_bail")]
    pub bail: bool,
    /// Keep running after a failed request
    #[arg(long, overrides_with = "bail")]
    pub no_bail: bool,
    /// Fail a request before sending when it still contains unresolved {{variables}}
    #[arg(long)]
    pub strict_variables: bool,

    /// Request timeout in milliseconds (0 disables)
    #[arg(long, value_name = "MS")]
    pub timeout: Option<u64>,
    /// Skip TLS certificate verification
    #[arg(short = 'k', long)]
    pub insecure: bool,
    /// Force HTTP/1.1
    #[arg(long, conflicts_with = "http2")]
    pub http1: bool,
    /// Force HTTP/2
    #[arg(long)]
    pub http2: bool,
    /// Do not follow redirects
    #[arg(long)]
    pub no_follow_redirects: bool,
    /// Do not send or store cookies
    #[arg(long)]
    pub no_cookies: bool,
    /// Proxy URL (default: the system proxy from HTTP(S)_PROXY)
    #[arg(long, value_name = "URL", conflicts_with = "no_proxy")]
    pub proxy: Option<String>,
    /// Disable proxies entirely
    #[arg(long)]
    pub no_proxy: bool,
    /// Client certificate (PEM) for --cert-host
    #[arg(long, value_name = "FILE", requires = "key", requires = "cert_host")]
    pub cert: Option<PathBuf>,
    /// Client certificate key (PEM)
    #[arg(long, value_name = "FILE", requires = "cert")]
    pub key: Option<PathBuf>,
    /// Extra CA bundle (PEM) for --cert-host
    #[arg(long, value_name = "FILE", requires = "cert_host")]
    pub cacert: Option<PathBuf>,
    /// Host[:port] the certificate options apply to
    #[arg(long, value_name = "HOST")]
    pub cert_host: Option<String>,

    /// Write a JUnit XML report
    #[arg(long, value_name = "FILE")]
    pub junit: Option<PathBuf>,
    /// Write a JSON report
    #[arg(long, value_name = "FILE")]
    pub json: Option<PathBuf>,
    /// Print only failures and the summary
    #[arg(short, long, conflicts_with = "verbose")]
    pub quiet: bool,
    /// Print script logs, requests and responses (credentials redacted)
    #[arg(short, long)]
    pub verbose: bool,
    /// Disable colours (NO_COLOR and non-terminal output do too)
    #[arg(long)]
    pub no_color: bool,
}

impl RunArgs {
    /// `--bail`/`--no-bail`, the later one winning; `None` keeps the default.
    pub fn bail(&self) -> Option<bool> {
        if self.bail {
            Some(true)
        } else if self.no_bail {
            Some(false)
        } else {
            None
        }
    }
}

#[derive(Debug, Args)]
pub struct ListArgs {
    /// Collection directory (the one holding collection.yaml)
    pub collection: PathBuf,
    /// Print JSON instead of a table
    #[arg(long)]
    pub json: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(std::iter::once("resonance").chain(args.iter().copied()))
    }

    fn run_args(args: &[&str]) -> RunArgs {
        match parse(args).unwrap().command {
            Command::Run(run) => *run,
            Command::List(_) => panic!("expected run"),
        }
    }

    #[test]
    fn runner_conflicts_with_selectors() {
        assert!(parse(&["run", "col", "pets", "--runner", "smoke"]).is_err());
        assert_eq!(
            run_args(&["run", "col", "--runner", "smoke"])
                .runner
                .as_deref(),
            Some("smoke")
        );
        assert_eq!(
            run_args(&["run", "col", "pets", "a.yaml"]).selectors,
            vec!["pets", "a.yaml"]
        );
    }

    #[test]
    fn iterations_conflicts_with_data_file_and_is_range_checked() {
        assert!(parse(&["run", "col", "-n", "2", "--data", "rows.csv"]).is_err());
        assert!(parse(&["run", "col", "-n", "0"]).is_err());
        assert!(parse(&["run", "col", "-n", "1001"]).is_err());
        assert_eq!(run_args(&["run", "col", "-n", "3"]).iterations, Some(3));
    }

    #[test]
    fn bail_and_no_bail_last_wins() {
        assert_eq!(run_args(&["run", "col"]).bail(), None);
        assert_eq!(run_args(&["run", "col", "--bail"]).bail(), Some(true));
        assert_eq!(
            run_args(&["run", "col", "--bail", "--no-bail"]).bail(),
            Some(false)
        );
        assert_eq!(
            run_args(&["run", "col", "--no-bail", "--bail"]).bail(),
            Some(true)
        );
    }

    #[test]
    fn exclusive_flags_are_rejected_together() {
        assert!(parse(&["run", "col", "-q", "-v"]).is_err());
        assert!(parse(&["run", "col", "--proxy", "http://p", "--no-proxy"]).is_err());
        assert!(parse(&["run", "col", "--http1", "--http2"]).is_err());
        assert!(parse(&["run", "col", "--env", "staging"]).is_err());
    }

    #[test]
    fn certificate_flags_require_a_host_and_a_key() {
        assert!(parse(&["run", "col", "--cert", "c.pem"]).is_err());
        assert!(parse(&["run", "col", "--cert", "c.pem", "--key", "k.pem"]).is_err());
        assert!(parse(&["run", "col", "--cacert", "ca.pem"]).is_err());
        let args = run_args(&[
            "run",
            "col",
            "--cert",
            "c.pem",
            "--key",
            "k.pem",
            "--cert-host",
            "api.test:8443",
        ]);
        assert_eq!(args.cert_host.as_deref(), Some("api.test:8443"));
        assert!(
            run_args(&[
                "run",
                "col",
                "--cacert",
                "ca.pem",
                "--cert-host",
                "api.test"
            ])
            .cacert
            .is_some()
        );
    }

    #[test]
    fn list_takes_a_json_switch() {
        match parse(&["list", "col", "--json"]).unwrap().command {
            Command::List(list) => assert!(list.json),
            Command::Run(_) => panic!("expected list"),
        }
    }
}
