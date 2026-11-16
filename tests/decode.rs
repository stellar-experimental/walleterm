//! The approver's view: `artifact::decode` JSON for frozen vectors and two built envelopes.
//! `tests/support/decoded.json` holds the output of `stellar-xdr` 28.0.1, except where a comment says otherwise.
//! Never regenerate it to make this test pass. A difference means the approver sees something new.

use serde_json::Value;
use stellar_xdr::{
    BytesM, MuxedAccount, Preconditions, PreconditionsV2, SignerKey, SignerKeyEd25519SignedPayload,
    TransactionEnvelope, Uint256,
};
use walleterm::artifact::{Artifact, decode};
use walleterm::stellar;

fn read(path: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// A SetOptions signer, muxed M sources, Soroban calls, a preimage, and an entry.
const VECTORS: [&str; 7] = [
    "tx-operation-names",
    "tx-muxed-source",
    "tx-muxed-operation-source",
    "tx-soroban-invoke",
    "tx-soroban-delegated-auth",
    "preimage-contract",
    "auth-openzeppelin",
];

fn vector(id: &str) -> Artifact {
    let vectors = read("fixtures/parity/vectors.json");
    let c = vectors["cases"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap();
    match c["kind"].as_str().unwrap() {
        "transaction" => Artifact::Transaction(c["input"]["xdr"].as_str().unwrap().to_owned()),
        "auth_entry" => Artifact::Authorization {
            entry_xdr: c["input"]["auth_entry_xdr"].as_str().unwrap().to_owned(),
            address: c["input"]["address"].as_str().unwrap().to_owned(),
            adapter: c["input"]["adapter"].clone(),
        },
        _ => Artifact::Preimage(c["preimage_xdr"].as_str().unwrap().to_owned()),
    }
}

/// `tx-muxed-source` with `extra_signers`. The second signer has an empty payload.
fn extra_signers() -> Artifact {
    let Artifact::Transaction(xdr) = vector("tx-muxed-source") else { unreachable!() };
    let TransactionEnvelope::Tx(mut v1) = stellar::decode(&xdr).unwrap() else { unreachable!() };
    assert!(matches!(v1.tx.source_account, MuxedAccount::MuxedEd25519(_)));
    let payload = |bytes: &[u8]| {
        SignerKey::Ed25519SignedPayload(SignerKeyEd25519SignedPayload {
            ed25519: Uint256([7; 32]),
            payload: BytesM::try_from(bytes.to_vec()).unwrap(),
        })
    };
    v1.tx.cond = Preconditions::V2(PreconditionsV2 {
        extra_signers: vec![payload(&[1, 2, 3]), payload(&[])].try_into().unwrap(),
        ..PreconditionsV2::default()
    });
    Artifact::Transaction(stellar::encode(&TransactionEnvelope::Tx(v1)))
}

#[test]
fn the_approver_sees_the_same_decoded_json() {
    let snapshot = read("tests/support/decoded.json");
    let mut cases: Vec<(&str, Artifact)> = VECTORS.iter().map(|id| (*id, vector(id))).collect();
    cases.push(("extra-signers", extra_signers()));
    assert_eq!(snapshot.as_object().unwrap().len(), cases.len());
    for (id, artifact) in cases {
        assert_eq!(decode(&artifact).unwrap(), snapshot[id], "{id}");
    }
}

/// `stellar-xdr` 28.0.1 showed an empty signed payload as a P strkey that SEP-23 decoders refuse.
/// 30.0.0 shows a marker. The signed bytes are the same. The snapshot holds the 30.0.0 form for this one value.
#[test]
fn an_empty_signed_payload_shows_as_invalid() {
    let decoded = decode(&extra_signers()).unwrap().to_string();
    let marker = "<INVALID:GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI:EMPTY_PAYLOAD>";
    assert!(decoded.contains(marker), "{decoded}");
    assert!(!decoded.contains("PADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOAAAAAADGVQ"));
}
