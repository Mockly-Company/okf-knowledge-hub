use std::process::ExitCode;

fn main() -> ExitCode {
    okhub_lib::automation::run_cli_from_env()
}
