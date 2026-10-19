//! `resonance`: run committed collections and runners from a checkout.
mod cli;
mod error;
mod list;
mod options;
mod reporter;
mod run;
mod select;
mod vars;

use clap::Parser;
use std::io::Write;
use std::process::ExitCode;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> ExitCode {
    let parsed = cli::Cli::parse();
    let mut stdout = std::io::stdout();
    let mut stderr = std::io::stderr();
    let outcome = match parsed.command {
        cli::Command::Run(args) => run::run(*args, &mut stdout, &mut stderr).await,
        cli::Command::List(args) => list::list(args, &mut stdout).map(|()| 0),
    };
    let _ = stdout.flush();
    match outcome {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            let _ = writeln!(stderr, "error: {error}");
            ExitCode::from(error.exit_code())
        }
    }
}
