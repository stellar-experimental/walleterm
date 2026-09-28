//! `OP_VAULT` discovery through a fake 1Password CLI. Ported from bridge/vault.test.ts and bridge/signer.test.ts.
//! The fake CLI and its keys exist only inside each test directory.

use std::ffi::OsStr;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::json;
use walleterm::cancel::Cancel;
use walleterm::stellar::account_address;
use walleterm::vault::{allowed_keys_with, discover};

const VAULT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const ITEM: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";

const SCRIPT: &str = r#"#!/bin/sh
D="$(cd "$(dirname "$0")" && pwd)"
echo "$*" >> "$D/calls"
mode=$(cat "$D/mode")
case "$mode" in
  fail) echo DIAGNOSTIC_CANARY; echo DIAGNOSTIC_CANARY >&2; exit 1 ;;
  oversize) head -c 1048577 /dev/zero | tr '\0' x; exit 0 ;;
  stall) trap '' TERM; echo $$ >> "$D/pids"; while :; do sleep 1; done ;;
esac
if [ "$1" = item ]; then
  if [ "$mode" = invalid ]; then echo invalid; else cat "$D/items"; fi
  exit 0
fi
item=$(echo "$3" | cut -d/ -f4)
start=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
echo "start $start" >> "$D/timeline"
[ -f "$D/slow" ] && sleep 0.2
if [ -f "$D/stall-$item" ]; then trap '' TERM; echo $$ >> "$D/pids"; while :; do sleep 1; done; fi
end=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
echo "end $end" >> "$D/timeline"
if [ -f "$D/key-$item" ]; then printf '%s' "$(cat "$D/key-$item")"; else exit 1; fi
"#;

struct Fake(PathBuf);

impl Fake {
    fn new() -> Self {
        // A short path: macOS limits Unix socket paths to 104 bytes.
        let dir = PathBuf::from(format!("/private/tmp/wtv-{}", &walleterm::util::uuid()[..8]));
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("op"), SCRIPT).unwrap();
        std::fs::set_permissions(dir.join("op"), std::fs::Permissions::from_mode(0o700)).unwrap();
        let fake = Self(dir);
        fake.mode("ok");
        fake.items(&[item(ITEM)]);
        fake.key(ITEM, &line(&[7; 32]));
        fake
    }
    fn program(&self) -> PathBuf {
        self.0.join("op")
    }
    fn mode(&self, mode: &str) {
        std::fs::write(self.0.join("mode"), mode).unwrap();
    }
    fn items(&self, items: &[serde_json::Value]) {
        std::fs::write(self.0.join("items"), serde_json::to_string(items).unwrap()).unwrap();
    }
    fn key(&self, item: &str, line: &str) {
        std::fs::write(self.0.join(format!("key-{item}")), line).unwrap();
    }
    fn touch(&self, name: &str) {
        std::fs::write(self.0.join(name), "").unwrap();
    }
    fn calls(&self) -> Vec<String> {
        std::fs::read_to_string(self.0.join("calls")).unwrap_or_default().lines().map(str::to_owned).collect()
    }
    fn pids(&self) -> Vec<i32> {
        std::fs::read_to_string(self.0.join("pids"))
            .unwrap_or_default()
            .lines()
            .filter_map(|l| l.parse().ok())
            .collect()
    }
    /// Live processes started from this fake CLI's directory.
    fn live_processes(&self) -> Vec<String> {
        let out =
            std::process::Command::new("pgrep").args(["-f", self.0.to_str().unwrap()]).output().unwrap();
        String::from_utf8_lossy(&out.stdout).lines().map(str::to_owned).collect()
    }

    /// The largest number of reads that overlapped in time.
    fn max_overlap(&self) -> usize {
        let text = std::fs::read_to_string(self.0.join("timeline")).unwrap_or_default();
        let mut events: Vec<(f64, i32)> = text
            .lines()
            .map(|l| {
                let (kind, t) = l.split_once(' ').unwrap();
                (t.parse::<f64>().unwrap(), if kind == "start" { 1 } else { -1 })
            })
            .collect();
        events.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let (mut now, mut max) = (0i32, 0i32);
        for (_, delta) in events {
            now += delta;
            max = max.max(now);
        }
        max as usize
    }
}

impl Drop for Fake {
    fn drop(&mut self) {
        for pid in self.pids() {
            // SAFETY: a test-owned fake CLI process.
            unsafe { libc::kill(pid, libc::SIGKILL) };
        }
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn item(id: &str) -> serde_json::Value {
    json!({"id": id, "vault": {"id": VAULT, "name": "Private"}, "category": "SSH_KEY"})
}

fn line(key: &[u8; 32]) -> String {
    let mut blob = 11u32.to_be_bytes().to_vec();
    blob.extend(b"ssh-ed25519");
    blob.extend(32u32.to_be_bytes());
    blob.extend(key);
    format!("ssh-ed25519 {} mock", STANDARD.encode(blob))
}

fn alive(pid: i32) -> bool {
    // SAFETY: signal 0 only checks that the process exists.
    unsafe { libc::kill(pid, 0) == 0 }
}

async fn keys(fake: &Fake, vault: &str) -> walleterm::error::Result<Vec<String>> {
    allowed_keys_with(fake.program().as_os_str(), vault, &Cancel::new()).await
}

#[tokio::test]
async fn uuids_and_names_select_public_fields_only() {
    let fake = Fake::new();
    assert_eq!(keys(&fake, VAULT).await.unwrap(), vec![account_address(&[7; 32])]);
    assert_eq!(keys(&fake, "Private").await.unwrap(), vec![account_address(&[7; 32])]);
    assert_eq!(keys(&fake, "PRIVATE").await.unwrap(), vec![account_address(&[7; 32])]);
    assert_eq!(
        fake.calls()[..2],
        [
            format!("item list --vault {VAULT} --categories SSH Key --format json"),
            format!("read --no-newline op://{VAULT}/{ITEM}/public key"),
        ]
    );
    assert!(fake.calls().iter().all(|c| !c.contains("item get")), "never an unfiltered item read");
}

#[tokio::test]
async fn cli_failures_never_return_keys_or_diagnostics() {
    let fake = Fake::new();
    for mode in ["fail", "invalid", "oversize"] {
        fake.mode(mode);
        let e = keys(&fake, VAULT).await.unwrap_err();
        assert_eq!(
            e.message, "The selected 1Password vault is unavailable. Check OP_VAULT and the 1Password CLI.",
            "{mode}"
        );
        assert!(!e.message.contains("CANARY"));
    }
    fake.mode("ok");
    assert_eq!(
        keys(&fake, " \t").await.unwrap_err().message,
        "Set OP_VAULT to a 1Password vault name or ID."
    );
    let missing =
        allowed_keys_with(OsStr::new("/nonexistent/walleterm/op"), VAULT, &Cancel::new()).await.unwrap_err();
    assert_eq!(missing.code, "bridge_unavailable");
}

#[tokio::test]
async fn invalid_metadata_and_keys_stop_discovery() {
    let fake = Fake::new();
    for (items, message) in [
        (
            json!([{"id": ITEM, "vault": {"id": VAULT}, "category": "LOGIN"}]),
            "The selected vault returned an invalid key item.",
        ),
        (
            json!([{"id": "short", "vault": {"id": VAULT}, "category": "SSH_KEY"}]),
            "The selected vault returned an invalid key item.",
        ),
        (
            json!([{"id": ITEM, "vault": {"id": "cccccccccccccccccccccccccc", "name": "Other"}, "category": "SSH_KEY"}]),
            "The selected vault returned an invalid key item.",
        ),
        (json!({"items": []}), "The selected vault returned an invalid key list."),
        (json!(vec![item(ITEM); 1025]), "The selected vault returned an invalid key list."),
    ] {
        std::fs::write(fake.0.join("items"), items.to_string()).unwrap();
        assert_eq!(keys(&fake, VAULT).await.unwrap_err().message, message, "{items}");
    }
    fake.items(&[item(ITEM)]);
    fake.key(ITEM, "ssh-ed25519 AAAA mock");
    assert_eq!(
        keys(&fake, VAULT).await.unwrap_err().message,
        "An Ed25519 public key in the selected vault is invalid."
    );
    fake.key(ITEM, "ssh-rsa AAAAB3NzaC1yc2E mock");
    assert_eq!(keys(&fake, VAULT).await.unwrap(), Vec::<String>::new(), "an unsupported key is not a wallet");
    std::fs::remove_file(fake.0.join(format!("key-{ITEM}"))).unwrap();
    assert_eq!(
        keys(&fake, VAULT).await.unwrap_err().message,
        "A public key in the selected vault is unavailable."
    );
    fake.items(&[]);
    assert_eq!(keys(&fake, VAULT).await.unwrap(), Vec::<String>::new(), "an empty vault exposes no keys");
}

#[tokio::test]
async fn reads_overlap_with_at_most_four_active() {
    let fake = Fake::new();
    let ids: Vec<String> = (0..9).map(|i| format!("{}{}", "b".repeat(25), (b'a' + i) as char)).collect();
    fake.items(&ids.iter().map(|id| item(id)).collect::<Vec<_>>());
    for (i, id) in ids.iter().enumerate() {
        fake.key(id, &line(&[i as u8 + 1; 32]));
    }
    fake.touch("slow");
    let found = keys(&fake, VAULT).await.unwrap();
    assert_eq!(found.len(), 9);
    let overlap = fake.max_overlap();
    assert!((2..=4).contains(&overlap), "overlap {overlap}");
}

#[tokio::test]
async fn a_failed_read_cancels_its_batch_and_waits_for_cleanup() {
    let fake = Fake::new();
    let ids: Vec<String> = (0..4).map(|i| format!("{}{}", "b".repeat(25), (b'a' + i) as char)).collect();
    fake.items(&ids.iter().map(|id| item(id)).collect::<Vec<_>>());
    for id in &ids[1..] {
        fake.touch(&format!("stall-{id}"));
    }
    let start = Instant::now();
    let e = keys(&fake, VAULT).await.unwrap_err();
    assert_eq!(e.message, "A public key in the selected vault is unavailable.");
    assert!(start.elapsed() < Duration::from_secs(8), "{:?}", start.elapsed());
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(fake.pids().iter().all(|&p| !alive(p)), "every stalled read stopped");
    assert!(fake.live_processes().is_empty(), "no fake CLI process survives: {:?}", fake.live_processes());
}

#[tokio::test]
async fn cancellation_stops_a_cli_that_ignores_sigterm() {
    let fake = Fake::new();
    fake.mode("stall");
    let cancel = Cancel::new();
    let stopper = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        stopper.abort();
    });
    let start = Instant::now();
    assert!(allowed_keys_with(fake.program().as_os_str(), VAULT, &cancel).await.is_err());
    assert!(start.elapsed() < Duration::from_secs(5));
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(fake.pids().iter().all(|&p| !alive(p)));
    assert!(fake.live_processes().is_empty());
}

async fn mock_agent(dir: &Path, keys: &[[u8; 32]]) -> PathBuf {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let path = dir.join("agent.sock");
    let listener = tokio::net::UnixListener::bind(&path).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let mut body = vec![12];
    body.extend((keys.len() as u32).to_be_bytes());
    for key in keys {
        let mut blob = 11u32.to_be_bytes().to_vec();
        blob.extend(b"ssh-ed25519");
        blob.extend(32u32.to_be_bytes());
        blob.extend(key);
        body.extend((blob.len() as u32).to_be_bytes());
        body.extend(blob);
        body.extend(4u32.to_be_bytes());
        body.extend(b"Same");
    }
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else { return };
            let body = body.clone();
            tokio::spawn(async move {
                let mut header = [0u8; 4];
                if stream.read_exact(&mut header).await.is_ok() {
                    let mut request = vec![0u8; u32::from_be_bytes(header) as usize];
                    let _ = stream.read_exact(&mut request).await;
                    let mut frame = (body.len() as u32).to_be_bytes().to_vec();
                    frame.extend(&body);
                    let _ = stream.write_all(&frame).await;
                }
            });
        }
    });
    path
}

#[tokio::test]
async fn discovery_filters_agent_keys_by_the_vault_and_skips_the_cli_when_unset() {
    let fake = Fake::new();
    let socket = mock_agent(&fake.0, &[[7; 32], [8; 32]]).await;
    let program = fake.program();
    let all = discover(&socket, None, program.as_os_str(), &Cancel::new()).await.unwrap();
    assert_eq!(all.len(), 2);
    assert!(fake.calls().is_empty(), "no CLI call without OP_VAULT");
    let empty = discover(&socket, Some(""), program.as_os_str(), &Cancel::new()).await.unwrap();
    assert_eq!(empty.len(), 2);
    let filtered = discover(&socket, Some(VAULT), program.as_os_str(), &Cancel::new()).await.unwrap();
    assert_eq!(
        filtered.iter().map(|s| s.public_key.clone()).collect::<Vec<_>>(),
        vec![account_address(&[7; 32])]
    );
    assert_eq!(filtered[0].comment.as_deref(), Some("Same"));
    assert!(filtered[0].fingerprint.as_deref().unwrap().starts_with("SHA256:"));
    fake.mode("fail");
    let e = discover(&socket, Some(VAULT), program.as_os_str(), &Cancel::new()).await.unwrap_err();
    assert_eq!(e.code, "bridge_unavailable");
}
