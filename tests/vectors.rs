//! Frozen JS SDK 17.1.0 vectors from `fixtures/parity/vectors.json`, run through the shared core
//! (`artifact.rs`) and the bridge admission rules. The Rust core must reproduce every digest, signed artifact,
//! detail field, and error exactly, except the reviewed changes in `CHANGED`.
//! Mock seeds only; nothing here reaches a network.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{Value, json};
use walleterm::artifact::{self, Artifact, Scope, Signed};
use walleterm::error::Error;
use walleterm::network::DEFAULT;
use walleterm::stellar::verify;
use walleterm::util::{hex, lower_hex, sha256};

/// The signing rules in `docs/INTERFACE.md` define these expectations. `"ok"` means the case signs.
/// No request reads a ledger, so every `latest_ledger` window and value check is gone. Expiration ledger 0 still fails.
/// A transaction needs no time bounds. Only a nonzero `max_time` at or before now fails.
/// A request for another key runs `bridge::admit`, which refuses it with `address_mismatch`.
/// A preimage bound to another G-address passes the shared core. The bridge still refuses it (`tests/bridge.rs`).
const CHANGED: &[(&str, &str)] = &[
    ("auth-window-61", "ok"),
    ("auth-window-now", "ok"),
    ("auth-ledger-zero", "ok"),
    ("auth-ledger-fraction", "ok"),
    ("auth-ledger-string", "ok"),
    ("auth-ledger-near-integer", "ok"),
    (
        "auth-other-key",
        r#"{"code":"address_mismatch","message":"The requested account differs from the selected account."}"#,
    ),
    (
        "auth-public-key-number",
        r#"{"code":"address_mismatch","message":"The requested account differs from the selected account."}"#,
    ),
    ("preimage-window-121", "ok"),
    ("preimage-expired", "ok"),
    ("preimage-other-account", "ok"),
    ("tx-no-time-bounds", "ok"),
    ("tx-lifetime-301s", "ok"),
    ("tx-starts-later", "ok"),
    (
        "tx-ended",
        r#"{"code":"invalid_request","message":"The transaction expired. Its max_time is at or before the current time."}"#,
    ),
];

fn vectors() -> Value {
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/parity/vectors.json"))
        .unwrap();
    serde_json::from_str(&text).unwrap()
}

fn error(e: Error) -> Value {
    json!({ "error": { "code": e.code, "message": e.message } })
}

fn signed_text(signed: Signed, raw: &[u8; 64]) -> String {
    match signed {
        Signed::Transaction(xdr) | Signed::AuthEntry(xdr) => xdr,
        Signed::Raw => STANDARD.encode(raw),
    }
}

/// Inspect, sign with the mock key, and finish. Returns the digest, the signature, and the signed artifact.
fn sign(artifact: &Artifact, scope: &Scope, key: &SigningKey) -> Result<([u8; 32], [u8; 64], String), Error> {
    let checked = artifact::inspect(artifact, scope)?;
    let raw = key.sign(&checked.digest).to_bytes();
    let signed = artifact::finish(artifact, scope, &raw)?;
    Ok((checked.digest, raw, signed_text(signed, &raw)))
}

fn run(case: &Value, key: &SigningKey, public_key: &str) -> Value {
    match case["kind"].as_str().unwrap() {
        "auth_entry" => {
            let input = &case["input"];
            let text = |name: &str| input[name].as_str().unwrap_or_default().to_owned();
            let artifact = Artifact::Authorization {
                entry_xdr: text("auth_entry_xdr"),
                address: text("address"),
                adapter: input.get("adapter").cloned().unwrap_or(Value::Null),
            };
            let passphrase = text("network_passphrase");
            // A request for another signer: the CLI names its key in `public_key`, and the bridge admission refuses it.
            let requested = text("public_key");
            if requested != public_key {
                return match walleterm::bridge::admit(
                    &artifact,
                    &DEFAULT,
                    &passphrase,
                    &requested,
                    public_key,
                    0,
                ) {
                    Ok(_) => json!({ "admitted": requested }),
                    Err(e) => error(e),
                };
            }
            let scope = Scope { key: public_key, passphrase: Some(&passphrase), now_ms: 0 };
            match sign(&artifact, &scope, key) {
                Ok((digest, raw, signed)) => json!({
                    "digest": hex(&digest),
                    "signature": hex(&raw),
                    "signed_auth_entry_xdr": signed,
                }),
                Err(e) => error(e),
            }
        }
        "preimage" => {
            let artifact = Artifact::Preimage(case["preimage_xdr"].as_str().unwrap().to_owned());
            let network = case["network_passphrase"].as_str().unwrap();
            let key_text = case["public_key"].as_str().unwrap();
            let scope = Scope { key: key_text, passphrase: Some(network), now_ms: 0 };
            let checked = match artifact::inspect(&artifact, &scope) {
                Ok(checked) => checked,
                Err(e) => return error(e),
            };
            let mut out = json!({ "digest": hex(&checked.digest), "address": checked.details["address"] });
            // The frozen file records a signature only for cases that ran with a ledger on testnet.
            if case["latest_ledger"].is_number() && network == walleterm::network::TESTNET {
                match sign(&artifact, &scope, key) {
                    Ok((_, raw, signed)) => {
                        out["signature"] = json!(hex(&raw));
                        out["signed_auth_entry"] = json!(signed);
                    }
                    Err(e) => return error(e),
                }
            }
            out
        }
        "transaction" => {
            let input = &case["input"];
            let xdr = input["xdr"].as_str().unwrap();
            let passphrase = input["network_passphrase"].as_str().unwrap();
            let now = case["now_ms"].as_u64().unwrap();
            let artifact = Artifact::Transaction(xdr.to_owned());
            let admitted = walleterm::bridge::admit(
                &artifact,
                &DEFAULT,
                passphrase,
                input["address"].as_str().unwrap(),
                public_key,
                now,
            );
            let (details, hash) = match admitted {
                Ok(value) => value,
                Err(e) => return error(e),
            };
            let scope = Scope { key: public_key, passphrase: Some(passphrase), now_ms: now };
            let (_, raw, signed) = sign(&artifact, &scope, key).unwrap();
            json!({ "hash": hash, "details": details, "signature": hex(&raw), "signed_tx_xdr": signed })
        }
        kind => panic!("unknown case kind {kind}"),
    }
}

#[test]
fn every_frozen_vector_matches() {
    let vectors = vectors();
    let seed = lower_hex::<32>(vectors["mock_seed_hex"].as_str().unwrap()).unwrap();
    let key = SigningKey::from_bytes(&seed);
    let public_key = vectors["public_key"].as_str().unwrap();
    assert_eq!(walleterm::stellar::account_address(&key.verifying_key().to_bytes()), public_key);
    let cases = vectors["cases"].as_array().unwrap();
    assert!(cases.len() >= 80, "the vector file lost cases");
    let mut failures = Vec::new();
    for case in cases.iter().filter(|case| case.get("rust_accepts").is_none()) {
        let id = case["id"].as_str().unwrap();
        let actual = run(case, &key, public_key);
        let expected = match CHANGED.iter().find(|(changed, _)| *changed == id) {
            Some((_, "ok")) => {
                if actual.get("error").is_some() {
                    failures.push(format!("{id} must now sign: {actual}"));
                }
                continue;
            }
            Some((_, error)) => json!({ "error": serde_json::from_str::<Value>(error).unwrap() }),
            None => {
                let mut expected = case["expect"].clone();
                // The bridge request expiry no longer follows the transaction's max_time.
                expected.as_object_mut().unwrap().remove("expires_ms");
                expected
            }
        };
        if actual != expected {
            failures.push(format!("{id}\n  expected: {expected}\n  actual:   {actual}"));
        }
    }
    assert_eq!(CHANGED.iter().filter(|(id, _)| cases.iter().any(|c| c["id"] == *id)).count(), CHANGED.len());
    assert!(
        failures.is_empty(),
        "{} of {} vectors differ:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
}

/// Recorded difference (fixtures/parity/README.md): v3 structural admission accepts a valid envelope whose
/// content the JS SDK refuses to model. The body and existing signatures stay exact; one signature is appended.
#[test]
fn structural_admission_accepts_what_the_sdk_cannot_model() {
    use stellar_xdr::{Limits, ReadXdr, TransactionEnvelope};
    let vectors = vectors();
    let seed = lower_hex::<32>(vectors["mock_seed_hex"].as_str().unwrap()).unwrap();
    let key = SigningKey::from_bytes(&seed);
    let public_key = vectors["public_key"].as_str().unwrap();
    let accepted: Vec<&Value> = vectors["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c.get("rust_accepts") == Some(&json!(true)))
        .collect();
    assert_eq!(accepted.len(), 1);
    for case in accepted {
        assert!(case["expect"]["error"].is_object(), "the TS side must still reject {}", case["id"]);
        let input = &case["input"];
        let xdr = input["xdr"].as_str().unwrap();
        let passphrase = input["network_passphrase"].as_str().unwrap();
        let now = case["now_ms"].as_u64().unwrap();
        let artifact = Artifact::Transaction(xdr.to_owned());
        walleterm::bridge::admit(&artifact, &DEFAULT, passphrase, public_key, public_key, now).unwrap();
        let scope = Scope { key: public_key, passphrase: Some(passphrase), now_ms: now };
        let (_, _, signed) = sign(&artifact, &scope, &key).unwrap();
        let (TransactionEnvelope::Tx(before), TransactionEnvelope::Tx(after)) = (
            TransactionEnvelope::from_xdr_base64(xdr, Limits::none()).unwrap(),
            TransactionEnvelope::from_xdr_base64(&signed, Limits::none()).unwrap(),
        ) else {
            panic!("a V1 envelope");
        };
        assert_eq!(before.tx, after.tx);
        assert_eq!(after.signatures.len(), before.signatures.len() + 1);
        assert_eq!(&after.signatures[..before.signatures.len()], &before.signatures[..]);
    }
}

#[test]
fn a_changed_signature_fails_independent_verification() {
    let vectors = vectors();
    let seed = lower_hex::<32>(vectors["mock_seed_hex"].as_str().unwrap()).unwrap();
    let public_key = vectors["public_key"].as_str().unwrap();
    for id in ["auth-account", "preimage-account", "tx-v1"] {
        let case = vectors["cases"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap();
        let (artifact, passphrase, now) = match case["kind"].as_str().unwrap() {
            "auth_entry" => {
                let input = &case["input"];
                let artifact = Artifact::Authorization {
                    entry_xdr: input["auth_entry_xdr"].as_str().unwrap().to_owned(),
                    address: input["address"].as_str().unwrap().to_owned(),
                    adapter: input["adapter"].clone(),
                };
                (artifact, input["network_passphrase"].as_str().unwrap(), 0)
            }
            "preimage" => (
                Artifact::Preimage(case["preimage_xdr"].as_str().unwrap().to_owned()),
                case["network_passphrase"].as_str().unwrap(),
                0,
            ),
            _ => (
                Artifact::Transaction(case["input"]["xdr"].as_str().unwrap().to_owned()),
                case["input"]["network_passphrase"].as_str().unwrap(),
                case["now_ms"].as_u64().unwrap(),
            ),
        };
        let scope = Scope { key: public_key, passphrase: Some(passphrase), now_ms: now };
        let checked = artifact::inspect(&artifact, &scope).unwrap();
        let mut signature = SigningKey::from_bytes(&seed).sign(&checked.digest).to_bytes();
        assert!(artifact::finish(&artifact, &scope, &signature).is_ok(), "{id}");
        signature[0] ^= 1;
        let e = artifact::finish(&artifact, &scope, &signature).err().unwrap();
        assert_eq!(
            (e.code, e.message.as_str()),
            ("invalid_signature", "The signature failed independent verification.")
        );
    }
}

/// SEP-53 v1.0.0 test cases. The key is the public SEP-53 test key: a mock key, never funded or used live.
/// The published signatures verify against the digests that the core computes.
#[test]
fn sep53_vectors_match_the_specification() {
    let key =
        walleterm::stellar::account_key("GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L").unwrap();
    let binary = STANDARD.decode("2zZDP1sa1BVBfLP7TeeMk3sUbaxAkUhBhDiNdrksaFo=").unwrap();
    for (message, digest, signature) in [
        (
            "Hello, World!".as_bytes(),
            "d52eb59c06bb510d065997ff93077068eed0a486c20215b5e02e1ab0d2ebea5f",
            "7cee5d6d885752104c85eea421dfdcb95abf01f1271d11c4bec3fcbd7874dccd6e2e98b97b8eb23b643cac4073bb77de5d07b0710139180ae9f3cbba78f2ba04",
        ),
        (
            "こんにちは、世界！".as_bytes(),
            "7bde4f792e336ed43df42ad66a92b44cb1bc60708e8bee63494c289dee161682",
            "083536eb95ecf32dce59b07fe7a1fd8cf814b2ce46f40d2a16e4ea1f6cecd980e04e6fbef9d21f98011c785a81edb85f3776a6e7d942b435eb0adc07da4d4604",
        ),
        (
            &binary[..],
            "460008feac2bccee41de48c2717db5d2e81591f71205dd612c4e8ce7125dea2f",
            "540d7eee179f370bf634a49c1fa9fe4a58e3d7990b0207be336c04edfcc539ff8bd0c31bb2c0359b07c9651cb2ae104e4504657b5d17d43c69c7e50e23811b0d",
        ),
    ] {
        let computed = walleterm::message::digest(message);
        assert_eq!(hex(&computed), digest);
        assert!(verify(&key, &computed, &lower_hex::<64>(signature).unwrap()));
        if let Ok(text) = std::str::from_utf8(message) {
            let scope = Scope {
                key: "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L",
                passphrase: None,
                now_ms: 0,
            };
            let checked = artifact::inspect(&Artifact::Message(text.to_owned()), &scope).unwrap();
            assert_eq!(hex(&checked.digest), digest);
            assert_eq!(checked.details["bytes"], message.len());
        }
    }
}

/// A site that sends a transaction hash as message text gets a SEP-53 digest, never the hash itself.
#[test]
fn a_hash_sent_as_text_is_hashed_again() {
    let hash = "e73804551639230dc03821cfd5c11b8067d8951bf6ebc1da2326fef62c0cb4df";
    let digest = walleterm::message::digest(hash.as_bytes());
    // Python hashlib computed this value independently.
    assert_eq!(hex(&digest), "e52151175cbac29a9dc6406729c2a173369ace8c532b361a1ced3f95b843683d");
    assert_ne!(hex(&digest), hash);
    assert_eq!(digest, sha256(&[&b"Stellar Signed Message:\n"[..], hash.as_bytes()].concat()));
}

#[test]
fn every_parity_file_matches_its_recorded_hash() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/parity");
    let readme = std::fs::read_to_string(format!("{dir}/README.md")).unwrap();
    for name in ["vectors.json", "cli.json"] {
        let bytes = std::fs::read(format!("{dir}/{name}")).unwrap();
        let row = readme.lines().find(|l| l.starts_with(&format!("| `{name}`"))).unwrap();
        let recorded = row.trim_end_matches(" |").rsplit('`').nth(1).unwrap();
        assert_eq!(hex(&walleterm::util::sha256(&bytes)), recorded, "{name} changed without review");
    }
}
