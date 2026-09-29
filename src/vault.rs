//! `--vault` filtering through the 1Password CLI. It reads item metadata and public key fields only.

use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::Value;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::cancel::Cancel;
use crate::error::{Error, Result};
use crate::stellar::account_address;
use crate::util::js_blank;

const MAX_OUTPUT: usize = 1 << 20;
const MAX_ITEMS: usize = 1024;
/// Vault lookup permits 100 seconds after agent discovery. With the 10-second agent listing, a website's wallet
/// discovery ends within 110 seconds. That keeps it under the SDK deadline of 115 seconds and the 125-second
/// Cloudflare response limit. A Cloudflare timeout page has no CORS header, so a website could not read it.
pub const LOOKUP: Duration = Duration::from_secs(100);
/// Escalate from SIGTERM to SIGKILL after this grace period.
const GRACE: Duration = Duration::from_millis(1500);

fn unavailable(message: &str) -> Error {
    Error::new("bridge_unavailable", message)
}

/// Run the 1Password CLI with bounded output. A failure returns no CLI diagnostics.
async fn op(program: &OsStr, args: &[&str], cancel: &Cancel) -> std::result::Result<String, ()> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| ())?;
    let mut stdout = child.stdout.take().ok_or(())?;
    let read = async {
        let mut output = Vec::new();
        let mut buffer = [0u8; 8192];
        loop {
            let n = stdout.read(&mut buffer).await.map_err(|_| ())?;
            if n == 0 {
                break;
            }
            if output.len() + n > MAX_OUTPUT {
                return Err(());
            }
            output.extend_from_slice(&buffer[..n]);
        }
        let status = child.wait().await.map_err(|_| ())?;
        if !status.success() {
            return Err(());
        }
        String::from_utf8(output).map_err(|_| ())
    };
    let result = tokio::select! {
        result = read => result,
        () = cancel.cancelled() => Err(()),
    };
    if result.is_err() {
        crate::process::stop_child(&mut child, GRACE).await;
    }
    result
}

fn base32_id(value: &Value) -> Option<&str> {
    value.as_str().filter(|s| s.len() == 26 && s.bytes().all(|b| matches!(b, b'a'..=b'z' | b'2'..=b'7')))
}

/// The public-key reference for one listed SSH key item. References use IDs, never titles or comments.
fn reference(item: &Value, vault: &str) -> Option<String> {
    let id = base32_id(&item["id"])?;
    let vault_id = base32_id(&item["vault"]["id"])?;
    let name = item["vault"]["name"].as_str();
    let matches = vault_id == vault || name.is_some_and(|n| n.to_lowercase() == vault.to_lowercase());
    (item["category"] == "SSH_KEY" && matches).then(|| format!("op://{vault_id}/{id}/public key"))
}

/// The G-address of an `ssh-ed25519` public key line, `None` for another algorithm.
fn ed25519_address(line: &str) -> std::result::Result<Option<String>, ()> {
    let mut parts = line
        .split(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}')
        .filter(|p| !p.is_empty());
    if parts.next() != Some("ssh-ed25519") {
        return Ok(None);
    }
    let encoded = parts.next().unwrap_or_default();
    let blob = STANDARD.decode(encoded).map_err(|_| ())?;
    let valid = blob.len() == 51
        && blob[..4] == 11u32.to_be_bytes()
        && &blob[4..15] == b"ssh-ed25519"
        && blob[15..19] == 32u32.to_be_bytes();
    if !valid {
        return Err(());
    }
    Ok(Some(account_address(blob[19..].try_into().expect("32 bytes"))))
}

/// The G-addresses of SSH keys in `vault`. Four reads run at most; the first failure stops the rest.
pub async fn allowed_keys(vault: &str, cancel: &Cancel) -> Result<Vec<String>> {
    allowed_keys_with(OsStr::new("op"), vault, cancel).await
}

/// `allowed_keys` with another CLI program. Only tests pass a program other than `op`.
pub async fn allowed_keys_with(program: &OsStr, vault: &str, cancel: &Cancel) -> Result<Vec<String>> {
    if js_blank(vault) {
        return Err(unavailable("Set --vault to a 1Password vault name or ID."));
    }
    let late = || {
        let message = format!(
            "The 1Password vault lookup took longer than {} seconds. Check for a 1Password prompt on the Mac.",
            LOOKUP.as_secs()
        );
        Error::new("bridge_unavailable", message)
    };
    let lookup = Cancel::any(&[cancel], LOOKUP, late());
    let listed = op(
        program,
        &["item", "list", "--vault", vault, "--categories", "SSH Key", "--format", "json"],
        &lookup,
    )
    .await;
    let items: Value = listed.ok().and_then(|text| serde_json::from_str(&text).ok()).ok_or_else(|| {
        unavailable("The selected 1Password vault is unavailable. Check --vault and the 1Password CLI.")
    })?;
    let Some(items) = items.as_array().filter(|items| items.len() <= MAX_ITEMS) else {
        return Err(unavailable("The selected vault returned an invalid key list."));
    };
    let references: Option<Vec<String>> = items.iter().map(|item| reference(item, vault)).collect();
    let references =
        references.ok_or_else(|| unavailable("The selected vault returned an invalid key item."))?;
    let mut allowed = Vec::new();
    for batch in references.chunks(4) {
        if lookup.is_cancelled() {
            return Err(lookup.reason());
        }
        let batch_cancel = Cancel::any(&[&lookup], LOOKUP, late());
        let reads = batch.iter().map(|reference| {
            let (reference, batch_cancel, program) =
                (reference.clone(), batch_cancel.clone(), program.to_owned());
            async move {
                let line = op(&program, &["read", "--no-newline", &reference], &batch_cancel)
                    .await
                    .map_err(|()| unavailable("A public key in the selected vault is unavailable."))?;
                ed25519_address(&line)
                    .map_err(|()| unavailable("An Ed25519 public key in the selected vault is invalid."))
            }
        });
        // Handle each read as it ends. The first failure cancels the rest, then waits for their cleanup.
        // Dropping the set aborts the reads, and each child is killed on drop.
        let mut set: tokio::task::JoinSet<_> = reads.collect();
        let mut failure = None;
        while let Some(joined) = set.join_next().await {
            let joined = joined
                .unwrap_or_else(|_| Err(unavailable("A public key in the selected vault is unavailable.")));
            match joined {
                Ok(Some(address)) => allowed.push(address),
                Ok(None) => {}
                Err(e) => {
                    batch_cancel.abort();
                    failure.get_or_insert(e);
                }
            }
        }
        if let Some(e) = failure {
            return Err(e);
        }
    }
    if lookup.is_cancelled() {
        return Err(lookup.reason());
    }
    Ok(allowed)
}

/// Agent listing is bounded by ten seconds; discovery never returns an unfiltered list after a vault failure.
pub const AGENT_LIST: Duration = Duration::from_secs(10);

/// The wallets a website may see: agent Ed25519 keys, filtered by `--vault` when it is supplied.
pub async fn discover(
    socket: &Path,
    vault: Option<&str>,
    program: &OsStr,
    cancel: &Cancel,
) -> Result<Vec<crate::bridge::SignerInfo>> {
    let listed = crate::agent::list(socket, AGENT_LIST, cancel)
        .await
        .map_err(|e| if cancel.is_cancelled() { e } else { unavailable(&e.message) })?;
    let signers: Vec<crate::bridge::SignerInfo> = listed
        .into_iter()
        .map(|s| crate::bridge::SignerInfo {
            public_key: s.public_key,
            fingerprint: Some(s.fingerprint),
            comment: Some(s.comment),
        })
        .collect();
    let Some(vault) = vault else {
        return Ok(signers);
    };
    let allowed = allowed_keys_with(program, vault, cancel).await?;
    Ok(signers.into_iter().filter(|s| allowed.contains(&s.public_key)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn references_use_ids_and_the_selected_vault_only() {
        let id = "a".repeat(26);
        let vault = "b".repeat(26);
        let item = json!({"id": id, "category": "SSH_KEY", "vault": {"id": vault, "name": "Private"}});
        assert_eq!(reference(&item, &vault).unwrap(), format!("op://{vault}/{id}/public key"));
        assert!(reference(&item, "private").is_some());
        assert!(reference(&item, "Other").is_none());
        for bad in [
            json!({"id": "A".repeat(26), "category": "SSH_KEY", "vault": {"id": vault}}),
            json!({"id": id, "category": "LOGIN", "vault": {"id": vault}}),
            json!({"id": id, "category": "SSH_KEY", "vault": {"id": "short"}}),
            json!({"id": id, "category": "SSH_KEY"}),
        ] {
            assert!(reference(&bad, &vault).is_none(), "{bad}");
        }
    }

    #[test]
    fn public_key_lines_are_strict() {
        let mut blob = 11u32.to_be_bytes().to_vec();
        blob.extend(b"ssh-ed25519");
        blob.extend(32u32.to_be_bytes());
        blob.extend([7u8; 32]);
        let encoded = STANDARD.encode(&blob);
        assert_eq!(
            ed25519_address(&format!("ssh-ed25519 {encoded} comment")),
            Ok(Some(account_address(&[7; 32])))
        );
        assert_eq!(
            ed25519_address(&format!("  ssh-ed25519\t{encoded}\n")),
            Ok(Some(account_address(&[7; 32])))
        );
        assert_eq!(ed25519_address("ssh-rsa AAAA"), Ok(None));
        assert_eq!(ed25519_address("ssh-ed25519"), Err(()));
        assert_eq!(ed25519_address(&format!("ssh-ed25519 {}", &encoded[..encoded.len() - 1])), Err(()));
        blob[19] ^= 0;
        blob.push(0);
        assert_eq!(ed25519_address(&format!("ssh-ed25519 {}", STANDARD.encode(&blob))), Err(()));
    }
}
