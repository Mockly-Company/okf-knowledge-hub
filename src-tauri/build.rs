use std::{path::Path, process::Command};

fn git_output(repository: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(["-C", repository.to_str()?])
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn main() {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must live inside the repository");
    let branch = git_output(repository, &["branch", "--show-current"])
        .unwrap_or_else(|| "detached".to_owned());
    let commit = git_output(repository, &["rev-parse", "--short=8", "HEAD"])
        .unwrap_or_else(|| "unknown".to_owned());
    let dirty =
        git_output(repository, &["status", "--porcelain"]).is_some_and(|status| !status.is_empty());

    println!("cargo:rustc-env=OKHUB_BUILD_BRANCH={branch}");
    println!("cargo:rustc-env=OKHUB_BUILD_COMMIT={commit}");
    println!("cargo:rustc-env=OKHUB_BUILD_DIRTY={dirty}");
    tauri_build::build()
}
