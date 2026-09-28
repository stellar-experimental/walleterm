//! AddressV2 authorization entries: checks, adapter digests, and signature attachment.
//! Schemas match `sdk/authorization.ts` and OpenZeppelin commit `OPENZEPPELIN_AUTH_COMMIT`.

use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::Value;
use stellar_xdr::{
    ContractId, Hash, HashIdPreimage, HashIdPreimageSorobanAuthorizationWithAddress, ScAddress, ScBytes,
    ScMap, ScMapEntry, ScSymbol, ScVal, ScVec, SorobanAddressCredentials, SorobanAuthorizationEntry,
    SorobanAuthorizedInvocation, SorobanCredentials,
};

use crate::error::{Result, fail};
use crate::stellar::{self, Decode};
use crate::util::{hex, lower_hex, sha256, valid_passphrase};

pub const OPENZEPPELIN_AUTH_COMMIT: &str = "a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640";
pub const MAX_AUTH_XDR: usize = 32768;
pub const MAX_AUTH_LEDGER_WINDOW: u32 = 60;
const MAX_CONTEXTS: usize = 256;
const MAX_DEPTH: usize = 32;

fn invalid<T>(message: &str) -> Result<T> {
    fail("invalid_input", message)
}

const V2_REQUIRED: &str =
    "Authorization signing requires address-bound V2 credentials. Legacy V1 permits cross-address replay.";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Adapter {
    Account,
    ContractEd25519,
    OpenZeppelinEd25519 { verifier: [u8; 32], context_rule_ids: Vec<u32> },
}

/// One unsigned entry for a selected key. Loose JSON fields fail the same checks, in the same order, as the TS source.
#[derive(Clone, Debug)]
pub struct AuthEntryInput {
    pub auth_entry_xdr: String,
    pub network_passphrase: String,
    pub public_key: String,
    pub address: String,
    pub adapter: Value,
}

impl AuthEntryInput {
    /// Read the fields from a JSON object. A field with the wrong type becomes a value that fails its own check.
    pub fn from_json(object: &serde_json::Map<String, Value>) -> Self {
        let text = |name: &str| object.get(name).and_then(Value::as_str).unwrap_or_default().to_owned();
        Self {
            auth_entry_xdr: text("auth_entry_xdr"),
            network_passphrase: text("network_passphrase"),
            public_key: text("public_key"),
            address: text("address"),
            adapter: object.get("adapter").cloned().unwrap_or(Value::Null),
        }
    }
}

pub struct CheckedAuth {
    pub entry: SorobanAuthorizationEntry,
    pub digest: [u8; 32],
    pub adapter: Adapter,
    pub key: [u8; 32],
    pub nonce: i64,
    pub expiration_ledger: u32,
}

/// Read address credentials. V1 stays readable because a transaction can carry signed V1 entries from others.
pub fn address_credentials(entry: &SorobanAuthorizationEntry) -> Result<&SorobanAddressCredentials> {
    match &entry.credentials {
        SorobanCredentials::Address(c) | SorobanCredentials::AddressV2(c) => Ok(c),
        _ => invalid(
            "Use explicit V1 or V2 address credentials. SourceAccount and delegated credentials are not supported.",
        ),
    }
}

pub fn parse_auth_entry(encoded: &str) -> Result<SorobanAuthorizationEntry> {
    if encoded.is_empty() || encoded.len() > MAX_AUTH_XDR {
        return invalid("The authorization XDR is invalid or too large.");
    }
    let entry: SorobanAuthorizationEntry = match stellar::decode(encoded) {
        Ok(entry) => entry,
        Err(Decode::NonCanonical) => return invalid("Use canonical authorization XDR."),
        Err(Decode::Invalid) => return invalid("The authorization XDR is invalid."),
    };
    address_credentials(&entry)?;
    count_auth_contexts(&entry.root_invocation)?;
    Ok(entry)
}

/// Count contexts depth first. Stop at the first context past 256 or the first level past 32.
pub fn count_auth_contexts(invocation: &SorobanAuthorizedInvocation) -> Result<usize> {
    fn visit(node: &SorobanAuthorizedInvocation, depth: usize, count: &mut usize) -> Result<()> {
        *count += 1;
        if *count > MAX_CONTEXTS || depth > MAX_DEPTH {
            return invalid("The invocation tree exceeds the size or depth limit.");
        }
        node.sub_invocations.iter().try_for_each(|child| visit(child, depth + 1, count))
    }
    let mut count = 0;
    visit(invocation, 1, &mut count)?;
    Ok(count)
}

fn ledger(value: Option<u32>) -> Result<u32> {
    match value {
        Some(v) if v >= 1 => Ok(v),
        _ => invalid("Use a positive uint32 ledger number."),
    }
}

/// A JSON number that JavaScript treats as an integer in `0..=u32::MAX`.
pub fn json_u32(value: &Value) -> Option<u32> {
    let number = value.as_number()?;
    if let Some(v) = number.as_u64() {
        return u32::try_from(v).ok();
    }
    let v = number.as_f64()?;
    (v.fract() == 0.0 && (0.0..=u32::MAX as f64).contains(&v)).then_some(v as u32)
}

fn adapter(value: &Value, address: &str, selected: &str, contexts: usize) -> Result<Adapter> {
    let Some(object) = value.as_object() else {
        return invalid("Provide an authorization adapter.");
    };
    let kind = object.get("type").and_then(Value::as_str);
    let fields: &[&str] = if kind == Some("openzeppelin-ed25519") {
        &["type", "verifier", "context_rule_ids"]
    } else {
        &["type"]
    };
    if object.keys().any(|k| !fields.contains(&k.as_str())) {
        return invalid("The adapter fields are invalid.");
    }
    let result = match kind {
        Some("account") => {
            if address != selected {
                return invalid("The account authorization must match the selected G-address.");
            }
            Adapter::Account
        }
        Some("contract-ed25519" | "openzeppelin-ed25519") => {
            if !stellar::is_contract(address) {
                return invalid("The contract adapter requires a C-address.");
            }
            if kind == Some("contract-ed25519") {
                Adapter::ContractEd25519
            } else {
                let verifier = object.get("verifier").and_then(Value::as_str).and_then(stellar::contract_id);
                let ids = object.get("context_rule_ids").and_then(Value::as_array);
                let ids: Option<Vec<u32>> = ids.and_then(|ids| ids.iter().map(json_u32).collect());
                match (verifier, ids) {
                    (Some(verifier), Some(ids)) if ids.len() == contexts => {
                        Adapter::OpenZeppelinEd25519 { verifier, context_rule_ids: ids }
                    }
                    _ => {
                        return invalid(
                            "Provide a verifier C-address and one uint32 rule ID per authorization context.",
                        );
                    }
                }
            }
        }
        _ => return invalid("The authorization adapter is not supported."),
    };
    Ok(result)
}

fn rule_ids(ids: &[u32]) -> ScVal {
    let values: Vec<ScVal> = ids.iter().map(|&id| ScVal::U32(id)).collect();
    ScVal::Vec(Some(ScVec(values.try_into().expect("at most 256 contexts"))))
}

/// Check one unsigned AddressV2 entry and compute the adapter digest that the key signs.
pub fn inspect_auth_entry(
    input: &AuthEntryInput,
    selected: &str,
    latest_ledger: Option<u32>,
) -> Result<CheckedAuth> {
    let Some(key) = stellar::account_key(selected).filter(|_| input.public_key == selected) else {
        return invalid("The requested signer differs from the selected key.");
    };
    if !valid_passphrase(&input.network_passphrase) {
        return invalid("Provide the exact network passphrase.");
    }
    let entry = parse_auth_entry(&input.auth_entry_xdr)?;
    let SorobanCredentials::AddressV2(credentials) = &entry.credentials else {
        return invalid(V2_REQUIRED);
    };
    if credentials.address.to_string() != input.address {
        return invalid("The authorization address differs from the requested address.");
    }
    if credentials.signature != ScVal::Void {
        return invalid("Use an unsigned authorization entry.");
    }
    let latest = ledger(latest_ledger)?;
    let expiration = credentials.signature_expiration_ledger;
    if expiration <= latest || u64::from(expiration) > u64::from(latest) + u64::from(MAX_AUTH_LEDGER_WINDOW) {
        return invalid("The authorization must expire within the next 60 ledgers.");
    }
    let contexts = count_auth_contexts(&entry.root_invocation)?;
    let adapter = adapter(&input.adapter, &input.address, selected, contexts)?;
    let preimage =
        HashIdPreimage::SorobanAuthorizationWithAddress(HashIdPreimageSorobanAuthorizationWithAddress {
            network_id: Hash(sha256(input.network_passphrase.as_bytes())),
            nonce: credentials.nonce,
            signature_expiration_ledger: expiration,
            address: credentials.address.clone(),
            invocation: entry.root_invocation.clone(),
        });
    let payload = sha256(&stellar::xdr_bytes(&preimage));
    let digest = match &adapter {
        Adapter::OpenZeppelinEd25519 { context_rule_ids, .. } => {
            let mut message = payload.to_vec();
            message.extend(stellar::xdr_bytes(&rule_ids(context_rule_ids)));
            sha256(&message)
        }
        _ => payload,
    };
    let (nonce, expiration_ledger) = (credentials.nonce, expiration);
    Ok(CheckedAuth { entry, digest, adapter, key, nonce, expiration_ledger })
}

fn symbol(name: &str) -> ScVal {
    ScVal::Symbol(ScSymbol(name.try_into().expect("a fixed short symbol")))
}

fn bytes(value: &[u8]) -> ScVal {
    ScVal::Bytes(ScBytes(value.to_vec().try_into().expect("a 32- or 64-byte value")))
}

fn map(pairs: Vec<(ScVal, ScVal)>) -> ScVal {
    let entries: Vec<ScMapEntry> = pairs.into_iter().map(|(key, val)| ScMapEntry { key, val }).collect();
    ScVal::Map(Some(ScMap(entries.try_into().expect("a fixed small map"))))
}

/// Verify a raw Ed25519 signature strictly.
pub fn verify(key: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> bool {
    VerifyingKey::from_bytes(key)
        .is_ok_and(|key| key.verify_strict(message, &Signature::from_bytes(signature)).is_ok())
}

/// Verify the signature independently, then change only the credential signature value.
pub fn attach_auth_signature(
    input: &AuthEntryInput,
    selected: &str,
    latest_ledger: Option<u32>,
    signature: &str,
) -> Result<String> {
    let checked = inspect_auth_entry(input, selected, latest_ledger)?;
    let Some(raw) = lower_hex::<64>(signature) else {
        return invalid("The signer returned an invalid signature.");
    };
    if !verify(&checked.key, &checked.digest, &raw) {
        return invalid("The signature failed independent verification.");
    }
    let key = bytes(&checked.key);
    let value = match &checked.adapter {
        Adapter::ContractEd25519 => bytes(&raw),
        Adapter::Account => ScVal::Vec(Some(ScVec(
            vec![map(vec![(symbol("public_key"), key), (symbol("signature"), bytes(&raw))])]
                .try_into()
                .expect("one element"),
        ))),
        Adapter::OpenZeppelinEd25519 { verifier, context_rule_ids } => {
            let signer = ScVal::Vec(Some(ScVec(
                vec![
                    symbol("External"),
                    ScVal::Address(ScAddress::Contract(ContractId(Hash(*verifier)))),
                    key,
                ]
                .try_into()
                .expect("three elements"),
            )));
            map(vec![
                (symbol("context_rule_ids"), rule_ids(context_rule_ids)),
                (symbol("signers"), map(vec![(signer, bytes(&raw))])),
            ])
        }
    };
    let mut entry = checked.entry;
    let SorobanCredentials::AddressV2(credentials) = &mut entry.credentials else {
        unreachable!("inspect_auth_entry accepts only AddressV2 credentials")
    };
    credentials.signature = value;
    Ok(stellar::encode(&entry))
}

/// The digest in lowercase hexadecimal, as every JSON result reports it.
pub fn digest_hex(checked: &CheckedAuth) -> String {
    hex(&checked.digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verification_rejects_a_weak_key() {
        // The compressed identity point, with an identity R and a zero S, verifies under a cofactor-free check.
        let mut identity = [0u8; 32];
        identity[0] = 1;
        let mut signature = [0u8; 64];
        signature[0] = 1;
        assert!(!verify(&identity, b"any message", &signature));
    }

    #[test]
    fn verification_rejects_a_noncanonical_scalar() {
        use ed25519_dalek::{Signer, SigningKey};
        let key = SigningKey::from_bytes(&[7; 32]);
        let message = [1u8; 32];
        let mut signature = key.sign(&message).to_bytes();
        assert!(verify(&key.verifying_key().to_bytes(), &message, &signature));
        // Replace S with the Ed25519 group order L; S must be below L.
        const L: [u8; 32] = [
            0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
        ];
        signature[32..].copy_from_slice(&L);
        assert!(!verify(&key.verifying_key().to_bytes(), &message, &signature));
    }

    #[test]
    fn json_u32_follows_number_is_integer() {
        let parse = |text: &str| json_u32(&serde_json::from_str::<Value>(text).unwrap());
        for (text, want) in [
            ("0", Some(0)),
            ("4294967295", Some(u32::MAX)),
            ("1.0", Some(1)),
            ("1e2", Some(100)),
            ("4.294967295e9", Some(u32::MAX)),
            ("-0", Some(0)),
            ("0.9999999999999999", None),
            ("99.99999999999999", None),
            ("1.5", None),
            ("-1", None),
            ("4294967296", None),
            ("\"7\"", None),
            ("true", None),
            ("null", None),
        ] {
            assert_eq!(parse(text), want, "{text}");
        }
    }
}
