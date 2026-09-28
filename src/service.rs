//! `walleterm tunnel` and `walleterm demo`. The Bun sidecar still runs both services;
//! this module only validates options and starts it with a clean environment.

use std::ffi::OsString;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;

fn usage(command: &str) -> &'static str {
    if command == "tunnel" { "walleterm tunnel [--port 8787]" } else { "walleterm demo [--port 8788]" }
}

/// Go `flag` rules for the single `--port` option: `-port` or `--port`, then `=N` or a separate `N`.
pub fn parse_port(command: &str, args: &[&str]) -> Option<u16> {
    let mut port: u32 = if command == "tunnel" { 8787 } else { 8788 };
    let mut rest = args.iter();
    while let Some(&arg) = rest.next() {
        if arg == "--" {
            return rest.next().is_none().then_some(port as u16).filter(|&p| p >= 1);
        }
        let name = arg.strip_prefix("--").or_else(|| arg.strip_prefix('-'))?;
        let (name, value) = match name.split_once('=') {
            Some((name, value)) => (name, value),
            None => (name, *rest.next()?),
        };
        if name != "port" {
            return None;
        }
        let digits = value.strip_prefix('+').unwrap_or(value);
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        port = digits.parse().ok()?;
    }
    (1..=65535).contains(&port).then_some(port as u16)
}

/// Bun reads BUN_OPTIONS, BUN_BE_BUN, and similar variables even in a compiled executable.
/// Drop them so the caller's environment cannot load code into the sidecar.
pub fn sidecar_environment(vars: impl Iterator<Item = (OsString, OsString)>) -> Vec<(OsString, OsString)> {
    vars.filter(|(name, _)| {
        let name = name.to_string_lossy();
        !name.starts_with("BUN_") && name != "NODE_OPTIONS" && name != "WALLETERM_BINARY"
    })
    .collect()
}

fn on_path(program: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|path| {
        std::env::split_paths(&path).any(|dir| {
            std::fs::metadata(dir.join(program))
                .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        })
    })
}

fn fail(out: &mut dyn Write, code: &'static str, message: &str) -> i32 {
    let _ = writeln!(out, "{code}: {message}");
    if code == "invalid_input" { 2 } else { 1 }
}

pub fn run(command: &str, args: &[&str], out: &mut dyn Write) -> i32 {
    if let ["--help" | "-h"] = args {
        let vault = if command == "tunnel" {
            "Set OP_VAULT in the shell or working directory's .env to filter website wallets by vault name or ID.\nShell values override .env. Filtering requires the 1Password CLI.\n"
        } else {
            ""
        };
        let text = format!(
            "{}\nRequires cloudflared. Shows public links and QR codes.\nThe signing bridge requires macOS and the 1Password SSH agent.\n{vault}Press Ctrl+C to stop this service.\n",
            usage(command)
        );
        return if out.write_all(text.as_bytes()).is_ok() { 0 } else { 1 };
    }
    let Some(port) = parse_port(command, args) else {
        return fail(out, "invalid_input", &format!("Use {}.", usage(command)));
    };
    if command == "tunnel" && !cfg!(target_os = "macos") {
        return fail(out, "unsupported_platform", "The signing bridge requires macOS.");
    }
    if !on_path("cloudflared") {
        return fail(out, "start_failed", "Install cloudflared. On macOS, run: brew install cloudflared");
    }
    let binary = std::env::current_exe().and_then(std::fs::canonicalize);
    let sidecar = binary.as_ref().ok().and_then(|b| b.parent()).map(|dir| dir.join("walleterm-bridge"));
    let (Ok(binary), Some(sidecar)) = (&binary, sidecar.filter(|s| s.is_file())) else {
        return fail(out, "start_failed", "The walleterm-bridge binary is missing. Reinstall walleterm.");
    };
    let mut environment = sidecar_environment(std::env::vars_os());
    environment.push(("WALLETERM_BINARY".into(), binary.as_os_str().to_owned()));
    // exec returns only on failure.
    let _ = std::process::Command::new(&sidecar)
        .arg0(PathBuf::from(&sidecar))
        .args([command, &format!("{{\"port\":{port}}}")])
        .env_clear()
        .envs(environment)
        .exec();
    fail(out, "start_failed", "The service could not start.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_options_follow_go_flag_rules() {
        assert_eq!(parse_port("tunnel", &[]), Some(8787));
        assert_eq!(parse_port("demo", &[]), Some(8788));
        for args in [
            &["--port", "9000"][..],
            &["-port", "9000"],
            &["--port=9000"],
            &["-port=9000"],
            &["--port", "+9000"],
        ] {
            assert_eq!(parse_port("demo", args), Some(9000), "{args:?}");
        }
        assert_eq!(parse_port("demo", &["--"]), Some(8788));
        for args in [
            &["--human"][..],
            &["--public"],
            &["--recipient", "GTEST"],
            &["--port", "0"],
            &["--port", "65536"],
            &["--port"],
            &["--port", "x"],
            &["extra"],
            &["--", "extra"],
            &["--state-dir", "/tmp/state"],
        ] {
            assert_eq!(parse_port("tunnel", args), None, "{args:?}");
        }
    }

    #[test]
    fn help_names_only_the_port_option() {
        for command in ["tunnel", "demo"] {
            let mut out = Vec::new();
            assert_eq!(run(command, &["--help"], &mut out), 0);
            let text = String::from_utf8(out).unwrap();
            assert!(text.contains(&format!("walleterm {command}")));
            assert!(!text.contains("--recipient") && !text.contains("--human") && !text.contains("--public"));
        }
    }

    #[test]
    fn the_sidecar_never_inherits_code_loading_variables() {
        let vars = [
            ("BUN_OPTIONS", "--preload x.js"),
            ("BUN_BE_BUN", "1"),
            ("NODE_OPTIONS", "--require x.js"),
            ("WALLETERM_BINARY", "/tmp/other"),
            ("OP_VAULT", "Private"),
        ]
        .map(|(k, v)| (OsString::from(k), OsString::from(v)));
        let kept = sidecar_environment(vars.into_iter());
        assert_eq!(kept, vec![(OsString::from("OP_VAULT"), OsString::from("Private"))]);
    }
}
