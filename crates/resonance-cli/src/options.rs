//! Mapping command-line flags onto the execution core's settings.
use resonance_core::model::{Certificate, DataFile, ExecutionSettings, RunOptions};
use resonance_core::proxy::{ProxyAuth, ProxySettings};
use serde_json::Value;
use std::path::Path;

use crate::cli::RunArgs;
use crate::error::CliError;

/// Manual proxy, no proxy, or (by default) whatever the environment says.
pub fn proxy_settings(args: &RunArgs) -> Result<ProxySettings, CliError> {
    if args.no_proxy {
        return Ok(ProxySettings {
            enabled: false,
            ..ProxySettings::default()
        });
    }
    let Some(raw) = &args.proxy else {
        return Ok(ProxySettings {
            enabled: true,
            use_system_proxy: true,
            ..ProxySettings::default()
        });
    };
    let parsed = url::Url::parse(raw)
        .map_err(|e| CliError::Usage(format!("--proxy {raw:?} is not a URL: {e}")))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| CliError::Usage(format!("--proxy {raw:?} has no host")))?
        .to_string();
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| CliError::Usage(format!("--proxy {raw:?} has no port")))?;
    let username = parsed.username().to_string();
    Ok(ProxySettings {
        enabled: true,
        use_system_proxy: false,
        proxy_type: parsed.scheme().to_string(),
        host,
        port,
        auth: ProxyAuth {
            enabled: !username.is_empty(),
            username,
            password: parsed.password().unwrap_or_default().to_string(),
        },
        ..ProxySettings::default()
    })
}

/// One certificate entry for `--cert-host`, or none.
pub fn certificates(args: &RunArgs) -> Vec<Certificate> {
    let Some(host) = &args.cert_host else {
        return Vec::new();
    };
    let path = |p: &Option<std::path::PathBuf>| p.as_ref().map(|p| p.to_string_lossy().to_string());
    vec![Certificate {
        host: host.clone(),
        enabled: Some(true),
        cert_path: path(&args.cert),
        key_path: path(&args.key),
        ca_path: path(&args.cacert),
    }]
}

pub fn execution_settings(args: &RunArgs) -> ExecutionSettings {
    ExecutionSettings {
        request_timeout: args.timeout,
        timeout: None,
        http_version: if args.http1 {
            Some("http1".into())
        } else if args.http2 {
            Some("http2".into())
        } else {
            None
        },
        verify_ssl: args.insecure.then_some(false),
        follow_redirects: args.no_follow_redirects.then_some(false),
        cookie_jar_enabled: args.no_cookies.then_some(false),
    }
}

/// Run options: a runner file's values (when running one) overridden by the
/// flags; plain runs default to one iteration and keep going after failures.
pub fn run_options(args: &RunArgs, runner: Option<&RunOptions>) -> RunOptions {
    let base = runner.cloned().unwrap_or(RunOptions {
        iterations: Some(Value::from(1)),
        delay_ms: Some(0),
        stop_on_error: false,
        max_executions_per_iteration: None,
        strict_variables: false,
    });
    RunOptions {
        iterations: args.iterations.map(Value::from).or(base.iterations),
        delay_ms: args.delay.or(base.delay_ms),
        stop_on_error: args.bail().unwrap_or(base.stop_on_error),
        max_executions_per_iteration: base.max_executions_per_iteration,
        strict_variables: args.strict_variables,
    }
}

/// A data file named on the command line, read relative to the working directory.
pub fn data_file(path: &Path) -> Result<DataFile, CliError> {
    let content = std::fs::read_to_string(path).map_err(|source| CliError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(DataFile {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        content,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::{Cli, Command};
    use clap::Parser;

    fn args(extra: &[&str]) -> RunArgs {
        let cli = Cli::try_parse_from(
            ["resonance", "run", "col"]
                .iter()
                .copied()
                .chain(extra.iter().copied()),
        )
        .unwrap();
        match cli.command {
            Command::Run(run) => *run,
            Command::List(_) => unreachable!(),
        }
    }

    #[test]
    fn default_proxy_is_the_system_proxy() {
        let proxy = proxy_settings(&args(&[])).unwrap();
        assert!(proxy.enabled && proxy.use_system_proxy);
        let none = proxy_settings(&args(&["--no-proxy"])).unwrap();
        assert!(!none.enabled);
    }

    #[test]
    fn proxy_url_maps_scheme_host_port_and_credentials() {
        let proxy =
            proxy_settings(&args(&["--proxy", "socks5://user:pw@proxy.test:1080"])).unwrap();
        assert_eq!(
            (proxy.proxy_type.as_str(), proxy.host.as_str(), proxy.port),
            ("socks5", "proxy.test", 1080)
        );
        assert!(proxy.auth.enabled);
        assert_eq!(
            (proxy.auth.username.as_str(), proxy.auth.password.as_str()),
            ("user", "pw")
        );
        let plain = proxy_settings(&args(&["--proxy", "http://proxy.test"])).unwrap();
        assert_eq!(plain.port, 80);
        assert!(!plain.auth.enabled);
        assert!(proxy_settings(&args(&["--proxy", "not a url"])).is_err());
    }

    #[test]
    fn settings_map_flags_and_leave_defaults_alone() {
        let settings = execution_settings(&args(&[]));
        assert_eq!(settings.request_timeout, None);
        assert_eq!(settings.verify_ssl, None);
        let settings = execution_settings(&args(&[
            "--timeout",
            "0",
            "-k",
            "--http2",
            "--no-follow-redirects",
            "--no-cookies",
        ]));
        assert_eq!(settings.request_timeout, Some(0));
        assert_eq!(settings.verify_ssl, Some(false));
        assert_eq!(settings.http_version.as_deref(), Some("http2"));
        assert_eq!(settings.follow_redirects, Some(false));
        assert_eq!(settings.cookie_jar_enabled, Some(false));
    }

    #[test]
    fn certificate_flags_build_one_host_entry() {
        assert!(certificates(&args(&[])).is_empty());
        let certs = certificates(&args(&[
            "--cert",
            "c.pem",
            "--key",
            "k.pem",
            "--cert-host",
            "api.test",
        ]));
        assert_eq!(certs.len(), 1);
        assert_eq!(certs[0].host, "api.test");
        assert_eq!(certs[0].cert_path.as_deref(), Some("c.pem"));
        assert_eq!(certs[0].key_path.as_deref(), Some("k.pem"));
        assert!(certs[0].ca_path.is_none());
    }

    #[test]
    fn bail_defaults_false_for_plain_runs_and_to_the_file_for_runners() {
        assert!(!run_options(&args(&[]), None).stop_on_error);
        let runner = RunOptions {
            iterations: Some(Value::from(3)),
            delay_ms: Some(250),
            stop_on_error: true,
            max_executions_per_iteration: Some(Value::from(50)),
            strict_variables: false,
        };
        let options = run_options(&args(&[]), Some(&runner));
        assert!(options.stop_on_error);
        assert_eq!(options.iterations, Some(Value::from(3)));
        assert_eq!(options.delay_ms, Some(250));
        let overridden = run_options(
            &args(&["--no-bail", "-n", "2", "--delay", "5", "--strict-variables"]),
            Some(&runner),
        );
        assert!(!overridden.stop_on_error);
        assert_eq!(overridden.iterations, Some(Value::from(2)));
        assert_eq!(overridden.delay_ms, Some(5));
        assert!(overridden.strict_variables);
        assert_eq!(
            overridden.max_executions_per_iteration,
            Some(Value::from(50))
        );
    }
}
