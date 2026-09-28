//! Frozen JS SDK 17.1.0 vectors from `fixtures/parity/vectors.json`. The Rust core must reproduce every
//! digest, signed artifact, detail field, and error exactly. Mock seeds only; nothing here reaches a network.

use ed25519_dalek::{Signer, SigningKey};
use serde_json::{Value, json};
use walleterm::authorization::{AuthEntryInput, attach_auth_signature, inspect_auth_entry, json_u32};
use walleterm::error::Error;
use walleterm::preimage::{attach_preimage_signature, inspect_auth_preimage};
use walleterm::transaction::{attach_signature, inspect_transaction};
use walleterm::util::{hex, lower_hex};

fn vectors() -> Value {
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/parity/vectors.json"))
        .unwrap();
    serde_json::from_str(&text).unwrap()
}

fn error(e: Error) -> Value {
    json!({ "error": { "code": e.code, "message": e.message } })
}

fn run(case: &Value, key: &SigningKey, public_key: &str) -> Value {
    let sign = |digest: &[u8]| hex(&key.sign(digest).to_bytes());
    match case["kind"].as_str().unwrap() {
        "auth_entry" => {
            let input = AuthEntryInput::from_json(case["input"].as_object().unwrap());
            let latest = json_u32(&case["latest_ledger"]);
            let checked = match inspect_auth_entry(&input, public_key, latest) {
                Ok(checked) => checked,
                Err(e) => return error(e),
            };
            let signature = sign(&checked.digest);
            match attach_auth_signature(&input, public_key, latest, &signature) {
                Ok(signed) => json!({
                    "digest": hex(&checked.digest),
                    "signature": signature,
                    "signed_auth_entry_xdr": signed,
                }),
                Err(e) => error(e),
            }
        }
        "preimage" => {
            let (xdr, key_text) =
                (case["preimage_xdr"].as_str().unwrap(), case["public_key"].as_str().unwrap());
            let network = case["network_passphrase"].as_str().unwrap();
            let latest = case["latest_ledger"].as_u64().map(|v| v as u32);
            let checked = match inspect_auth_preimage(xdr, key_text, network, latest) {
                Ok(checked) => checked,
                Err(e) => return error(e),
            };
            let mut out = json!({ "digest": hex(&checked.digest), "address": checked.address });
            if let Some(latest) = latest.filter(|_| network == walleterm::transaction::TESTNET) {
                let signature = sign(&checked.digest);
                out["signature"] = json!(signature);
                out["signed_auth_entry"] =
                    match attach_preimage_signature(xdr, key_text, network, latest, &signature) {
                        Ok(value) => json!(value),
                        Err(e) => return error(e),
                    };
            }
            out
        }
        "transaction" => {
            let input = &case["input"];
            let result = inspect_transaction(
                input["xdr"].as_str().unwrap(),
                input["network_passphrase"].as_str().unwrap(),
                input["address"].as_str().unwrap(),
                public_key,
                case["now_ms"].as_u64().unwrap(),
            );
            let (checked, details, expires) = match result {
                Ok(value) => value,
                Err(e) => return error(e),
            };
            let signature = sign(&checked.hash);
            json!({
                "hash": hex(&checked.hash),
                "details": details,
                "expires_ms": expires,
                "signature": signature,
                "signed_tx_xdr": attach_signature(&checked, &signature).unwrap(),
            })
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
    let failures: Vec<String> = cases
        .iter()
        .filter_map(|case| {
            let actual = run(case, &key, public_key);
            (actual != case["expect"])
                .then(|| format!("{}\n  expected: {}\n  actual:   {}", case["id"], case["expect"], actual))
        })
        .collect();
    assert!(
        failures.is_empty(),
        "{} of {} vectors differ:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
}

#[test]
fn a_changed_signature_fails_independent_verification() {
    let vectors = vectors();
    let seed = lower_hex::<32>(vectors["mock_seed_hex"].as_str().unwrap()).unwrap();
    let public_key = vectors["public_key"].as_str().unwrap();
    let case = vectors["cases"].as_array().unwrap().iter().find(|c| c["id"] == "auth-account").unwrap();
    let input = AuthEntryInput::from_json(case["input"].as_object().unwrap());
    let checked = inspect_auth_entry(&input, public_key, Some(100)).unwrap();
    let mut signature = SigningKey::from_bytes(&seed).sign(&checked.digest).to_bytes();
    signature[0] ^= 1;
    let e = attach_auth_signature(&input, public_key, Some(100), &hex(&signature)).unwrap_err();
    assert_eq!(e.message, "The signature failed independent verification.");
    let e =
        attach_auth_signature(&input, public_key, Some(100), &hex(&signature).to_uppercase()).unwrap_err();
    assert_eq!(e.message, "The signer returned an invalid signature.");
}

#[test]
fn the_vector_file_matches_its_recorded_hash() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/parity");
    let bytes = std::fs::read(format!("{dir}/vectors.json")).unwrap();
    let readme = std::fs::read_to_string(format!("{dir}/README.md")).unwrap();
    let recorded = readme.split("File SHA-256: `").nth(1).and_then(|s| s.get(..64)).unwrap();
    assert_eq!(hex(&walleterm::util::sha256(&bytes)), recorded, "vectors.json changed without review");
}
