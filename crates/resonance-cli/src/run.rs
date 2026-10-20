//! `resonance run`: load, select, execute, report, exit.
use resonance_collections::capture::{find_runner, plain_run_input, run_input};
use resonance_collections::variables::{collection_variables, secret_variable_keys};
use resonance_collections::{LoadedCollection, load_collection};
use resonance_core::execution::{Cancellation, execute_run};
use resonance_core::model::{ExecutionContext, RunInput, Variables};
use resonance_core::results::{RunResult, TerminationReason};
use std::collections::HashMap;
use std::io::{IsTerminal, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::cli::RunArgs;
use crate::error::CliError;
use crate::reporter::{ConsoleReporter, Verbosity, has_failures, write_reports};
use crate::{options, select, vars};

pub const EXIT_FAILED: u8 = 1;
pub const EXIT_INTERRUPTED: u8 = 130;

fn verbosity(args: &RunArgs) -> Verbosity {
    if args.quiet {
        Verbosity::Quiet
    } else if args.verbose {
        Verbosity::Verbose
    } else {
        Verbosity::Normal
    }
}

fn colour_enabled(args: &RunArgs) -> bool {
    !args.no_color && std::env::var_os("NO_COLOR").is_none() && std::io::stdout().is_terminal()
}

struct Prepared {
    input: RunInput,
    secrets_unfilled: Vec<String>,
    environment_name: Option<String>,
}

fn build_context(
    args: &RunArgs,
    loaded: &LoadedCollection,
) -> Result<(ExecutionContext, Vec<String>, Option<String>), CliError> {
    let mut layers: Vec<Variables> = Vec::new();
    let mut secret_keys = secret_variable_keys(loaded);
    let mut environment_name = None;
    if let Some(path) = &args.env_file {
        let file = vars::load_env_file(path, args.env.as_deref())?;
        environment_name = Some(file.name);
        secret_keys.extend(file.secret_keys);
        layers.push(file.variables);
    }
    layers.push(vars::prefixed_env(std::env::vars()));
    let mut flags = Variables::new();
    for assignment in &args.vars {
        let (key, value) = vars::parse_assignment(assignment)?;
        flags.insert(key, serde_json::Value::String(value));
    }
    layers.push(flags);
    let environment = vars::merge(layers);

    let mut all = collection_variables(loaded);
    all.extend(environment.clone());
    let unfilled = vars::unfilled_secrets(&secret_keys, &all);

    let context = ExecutionContext {
        environment_id: None,
        environment_name: environment_name.clone(),
        environment,
        collections: HashMap::from([(loaded.meta.id.clone(), collection_variables(loaded))]),
        cookies: Vec::new(),
        certificates: options::certificates(args),
        settings: options::execution_settings(args),
        proxy: options::proxy_settings(args)?,
    };
    Ok((context, unfilled, environment_name))
}

fn prepare(args: &RunArgs, loaded: &LoadedCollection) -> Result<Prepared, CliError> {
    let (context, secrets_unfilled, environment_name) = build_context(args, loaded)?;
    let execution_id = format!("cli-{}", std::process::id());
    let (mut input, saved_filter) = match &args.runner {
        Some(selector) => {
            let runner = find_runner(loaded, selector)?;
            let mut input = run_input(loaded, runner, context, execution_id)?;
            input.options = options::run_options(args, Some(&input.options));
            (input, Some(runner.options.tags.clone()))
        }
        None => {
            let entries = select::resolve(loaded, &args.selectors)?;
            let input = plain_run_input(
                loaded,
                &entries,
                options::run_options(args, None),
                context,
                execution_id,
            );
            (input, None)
        }
    };
    if let Some(filter) = args.tag_filter().or(saved_filter) {
        filter.apply(&mut input);
    }
    if input.requests.is_empty() {
        return Err(CliError::Config(
            "the collection has no requests to run".into(),
        ));
    }
    if let Some(path) = &args.data {
        input.data_file = Some(options::data_file(path)?);
    }
    Ok(Prepared {
        input,
        secrets_unfilled,
        environment_name,
    })
}

fn exit_code(result: &RunResult) -> u8 {
    if result.termination_reason == TerminationReason::StoppedByUser {
        return EXIT_INTERRUPTED;
    }
    if result.succeeded() && !has_failures(result) {
        0
    } else {
        EXIT_FAILED
    }
}

pub async fn run(args: RunArgs, out: &mut dyn Write, err: &mut dyn Write) -> Result<u8, CliError> {
    let loaded = load_collection(&args.collection)?;
    for (old, fresh) in &loaded.reassigned_runner_ids {
        let _ = writeln!(
            err,
            "warning: runner id {old:?} is duplicated; using {fresh} for this run"
        );
    }
    let prepared = prepare(&args, &loaded)?;
    if !prepared.secrets_unfilled.is_empty() {
        let _ = writeln!(
            err,
            "warning: secret variables have no value: {} (pass them with --var or RESONANCE_VAR_<KEY>)",
            prepared.secrets_unfilled.join(", ")
        );
    }
    if let Some(name) = &prepared.environment_name
        && !args.quiet
    {
        let _ = writeln!(out, "Environment: {name}");
    }

    let token = Cancellation::default();
    let interrupted = Arc::new(AtomicBool::new(false));
    {
        let token = token.clone();
        let interrupted = interrupted.clone();
        tokio::spawn(async move {
            if tokio::signal::ctrl_c().await.is_ok() {
                interrupted.store(true, Ordering::SeqCst);
                eprintln!("Interrupted; stopping the run and writing reports");
                token.cancel();
                if tokio::signal::ctrl_c().await.is_ok() {
                    let _ = std::io::stdout().flush();
                    std::process::exit(i32::from(EXIT_INTERRUPTED));
                }
            }
        });
    }

    let verbosity = verbosity(&args);
    let colour = colour_enabled(&args);
    let result = {
        let mut reporter = ConsoleReporter::new(verbosity, colour, out, err);
        let result = execute_run(prepared.input, token, |event| reporter.on_event(&event)).await;
        let written = write_reports(&result, args.junit.as_deref(), args.json.as_deref())?;
        let reports: Vec<(&str, &std::path::Path)> = written
            .iter()
            .map(|(kind, path)| (*kind, path.as_path()))
            .collect();
        reporter.finish(&result, &reports);
        result
    };
    if result.termination_reason == TerminationReason::ExecutionError {
        let message = result
            .execution_error
            .as_ref()
            .map(|e| e.message())
            .or_else(|| result.error.clone())
            .unwrap_or_else(|| "the run could not start".into());
        return Err(CliError::Config(message));
    }
    let code = exit_code(&result);
    if interrupted.load(Ordering::SeqCst) {
        return Ok(EXIT_INTERRUPTED);
    }
    Ok(code)
}
