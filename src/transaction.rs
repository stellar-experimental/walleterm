//! V1 and fee-bump envelopes: structural checks, the network-bound hash, and one appended signature.
//! The bridge filters no operations. A review of each request decides its content.

use serde_json::{Value, json};
use stellar_xdr::{
    DecoratedSignature, FeeBumpTransactionInnerTx, Hash, MuxedAccount, OperationBody, Preconditions,
    Signature, SignatureHint, TimeBounds, Transaction, TransactionEnvelope, TransactionSignaturePayload,
    TransactionSignaturePayloadTaggedTransaction, TransactionV1Envelope,
};

use crate::authorization::verify;
use crate::error::{Result, fail};
use crate::stellar::{self, Decode};
use crate::util::{hex, lower_hex, sha256, valid_passphrase};

pub const TESTNET: &str = "Test SDF Network ; September 2015";
pub const MAX_TRANSACTION_XDR: usize = 262144;
/// The protocol permits 20 envelope signatures. The selected key adds one.
const MAX_EXISTING_SIGNATURES: usize = 19;
/// A returned signature stays usable for at most five minutes.
const MAX_LIFETIME_MS: i128 = 300_000;
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

fn invalid<T>(message: &str) -> Result<T> {
    fail("invalid_request", message)
}

pub struct CheckedTransaction {
    pub envelope: TransactionEnvelope,
    pub hash: [u8; 32],
    pub key: [u8; 32],
}

impl CheckedTransaction {
    pub fn fee_bump(&self) -> bool {
        matches!(self.envelope, TransactionEnvelope::TxFeeBump(_))
    }

    /// The transaction that carries the operations and time bounds.
    pub fn inner(&self) -> &Transaction {
        match &self.envelope {
            TransactionEnvelope::Tx(v1) => &v1.tx,
            TransactionEnvelope::TxFeeBump(fee_bump) => {
                let FeeBumpTransactionInnerTx::Tx(inner) = &fee_bump.tx.inner_tx;
                &inner.tx
            }
            TransactionEnvelope::TxV0(_) => unreachable!("inspect rejects V0 envelopes"),
        }
    }

    fn signature_count(&self) -> usize {
        match &self.envelope {
            TransactionEnvelope::Tx(v1) => v1.signatures.len(),
            TransactionEnvelope::TxFeeBump(fee_bump) => fee_bump.signatures.len(),
            TransactionEnvelope::TxV0(_) => unreachable!("inspect rejects V0 envelopes"),
        }
    }
}

/// A muxed account signs with its base key.
pub fn base_key(account: &MuxedAccount) -> [u8; 32] {
    match account {
        MuxedAccount::Ed25519(key) => key.0,
        MuxedAccount::MuxedEd25519(muxed) => muxed.ed25519.0,
    }
}

fn hint(key: &[u8; 32]) -> [u8; 4] {
    [key[28], key[29], key[30], key[31]]
}

fn signature_bytes(signature: &Signature) -> Option<[u8; 64]> {
    signature.0.as_slice().try_into().ok()
}

fn envelope(encoded: &str, extra: usize) -> Result<TransactionEnvelope> {
    if encoded.is_empty() || encoded.len() > MAX_TRANSACTION_XDR + extra {
        return invalid("The transaction XDR is invalid or too large.");
    }
    let value: TransactionEnvelope = match stellar::decode(encoded) {
        Ok(value) => value,
        Err(Decode::NonCanonical) => return invalid("Use canonical transaction XDR."),
        Err(Decode::Invalid) => return invalid("The transaction XDR is invalid."),
    };
    if matches!(value, TransactionEnvelope::TxV0(_)) {
        return invalid("Use a V1 or fee-bump transaction envelope.");
    }
    Ok(value)
}

/// Structural checks only: a canonical V1 or fee-bump envelope that needs the selected key.
/// The key must be the transaction source, an operation source, or the fee-bump fee source.
pub fn inspect_transaction_request(
    transaction_xdr: &str,
    public_key: &str,
    network_passphrase: &str,
) -> Result<CheckedTransaction> {
    let Some(key) = stellar::account_key(public_key) else {
        return fail("address_mismatch", "Select a valid G-address.");
    };
    if !valid_passphrase(network_passphrase) {
        return invalid("Provide the exact network passphrase.");
    }
    let envelope = envelope(transaction_xdr, 0)?;
    let network_id = Hash(sha256(network_passphrase.as_bytes()));
    let (signers, tagged, signatures) = match &envelope {
        TransactionEnvelope::Tx(TransactionV1Envelope { tx, signatures }) => {
            let sources = tx.operations.iter().filter_map(|op| op.source_account.as_ref());
            let signers: Vec<[u8; 32]> =
                std::iter::once(&tx.source_account).chain(sources).map(base_key).collect();
            (signers, TransactionSignaturePayloadTaggedTransaction::Tx(tx.clone()), signatures)
        }
        TransactionEnvelope::TxFeeBump(fee_bump) => (
            vec![base_key(&fee_bump.tx.fee_source)],
            TransactionSignaturePayloadTaggedTransaction::TxFeeBump(fee_bump.tx.clone()),
            &fee_bump.signatures,
        ),
        TransactionEnvelope::TxV0(_) => unreachable!("envelope rejects V0"),
    };
    if !signers.contains(&key) {
        return fail("address_mismatch", "The selected account does not need to sign this transaction.");
    }
    let payload = TransactionSignaturePayload { network_id, tagged_transaction: tagged };
    let hash = sha256(&stellar::xdr_bytes(&payload));
    if signatures.len() > MAX_EXISTING_SIGNATURES {
        return invalid("The transaction has too many signatures.");
    }
    let signed = signatures.iter().any(|s| {
        s.hint.0 == hint(&key) && signature_bytes(&s.signature).is_some_and(|sig| verify(&key, &hash, &sig))
    });
    if signed {
        return invalid("The selected account already signed this transaction.");
    }
    Ok(CheckedTransaction { envelope, hash, key })
}

fn time_bounds(tx: &Transaction) -> Option<&TimeBounds> {
    match &tx.cond {
        Preconditions::Time(bounds) => Some(bounds),
        Preconditions::V2(v2) => v2.time_bounds.as_ref(),
        Preconditions::None => None,
    }
}

/// The JS SDK operation type names that the review display shows.
pub fn operation_type(body: &OperationBody) -> &'static str {
    match body {
        OperationBody::CreateAccount(_) => "createAccount",
        OperationBody::Payment(_) => "payment",
        OperationBody::PathPaymentStrictReceive(_) => "pathPaymentStrictReceive",
        OperationBody::ManageSellOffer(_) => "manageSellOffer",
        OperationBody::CreatePassiveSellOffer(_) => "createPassiveSellOffer",
        OperationBody::SetOptions(_) => "setOptions",
        OperationBody::ChangeTrust(_) => "changeTrust",
        OperationBody::AllowTrust(_) => "allowTrust",
        OperationBody::AccountMerge(_) => "accountMerge",
        OperationBody::Inflation => "inflation",
        OperationBody::ManageData(_) => "manageData",
        OperationBody::BumpSequence(_) => "bumpSequence",
        OperationBody::ManageBuyOffer(_) => "manageBuyOffer",
        OperationBody::PathPaymentStrictSend(_) => "pathPaymentStrictSend",
        OperationBody::CreateClaimableBalance(_) => "createClaimableBalance",
        OperationBody::ClaimClaimableBalance(_) => "claimClaimableBalance",
        OperationBody::BeginSponsoringFutureReserves(_) => "beginSponsoringFutureReserves",
        OperationBody::EndSponsoringFutureReserves => "endSponsoringFutureReserves",
        OperationBody::RevokeSponsorship(_) => "revokeSponsorship",
        OperationBody::Clawback(_) => "clawback",
        OperationBody::ClawbackClaimableBalance(_) => "clawbackClaimableBalance",
        OperationBody::SetTrustLineFlags(_) => "setTrustLineFlags",
        OperationBody::LiquidityPoolDeposit(_) => "liquidityPoolDeposit",
        OperationBody::LiquidityPoolWithdraw(_) => "liquidityPoolWithdraw",
        OperationBody::InvokeHostFunction(_) => "invokeHostFunction",
        OperationBody::ExtendFootprintTtl(_) => "extendFootprintTtl",
        OperationBody::RestoreFootprint(_) => "restoreFootprint",
    }
}

/// The bridge admission check: testnet only, the selected account, and bounded signature lifetime.
/// Returns the checked envelope, the review details, and the expiry in Unix milliseconds.
pub fn inspect_transaction(
    transaction_xdr: &str,
    network_passphrase: &str,
    address: &str,
    public_key: &str,
    now_ms: u64,
) -> Result<(CheckedTransaction, Value, u64)> {
    if network_passphrase != TESTNET {
        return fail("network_unsupported", "Walleterm signs only on Stellar testnet.");
    }
    if address != public_key {
        return fail("address_mismatch", "The requested account differs from the selected account.");
    }
    let checked = inspect_transaction_request(transaction_xdr, public_key, TESTNET)?;
    let inner = checked.inner();
    let window = time_bounds(inner).and_then(|b| {
        let (min, max) = (b.min_time.0, b.max_time.0);
        (min <= MAX_SAFE_INTEGER && max <= MAX_SAFE_INTEGER).then_some((b, min, max))
    });
    let now = i128::from(now_ms);
    let valid = window.is_some_and(|(_, min, max)| {
        let (min, max) = (i128::from(min) * 1000, i128::from(max) * 1000);
        min <= now && max > now && max <= now + MAX_LIFETIME_MS
    });
    let Some((bounds, _, max)) = window.filter(|_| valid) else {
        return invalid("Use time bounds that are valid now and end within five minutes.");
    };
    let source = inner.source_account.to_string();
    let operations: Vec<Value> = inner
        .operations
        .iter()
        .map(|op| {
            let source = op.source_account.as_ref().map_or_else(|| source.clone(), ToString::to_string);
            json!({ "type": operation_type(&op.body), "source": source })
        })
        .collect();
    let mut details = json!({
        "kind": "transaction",
        "network": "TESTNET",
        "envelope_type": if checked.fee_bump() { "fee_bump" } else { "transaction" },
        "source": source,
    });
    if let TransactionEnvelope::TxFeeBump(fee_bump) = &checked.envelope {
        details["fee_source"] = json!(fee_bump.tx.fee_source.to_string());
        details["fee_bump_fee_stroops"] = json!(fee_bump.tx.fee.to_string());
    }
    let extra = json!({
        "fee_stroops": inner.fee.to_string(),
        "sequence": inner.seq_num.0.to_string(),
        "min_time": bounds.min_time.0.to_string(),
        "max_time": bounds.max_time.0.to_string(),
        "operations": operations,
        "existing_signatures": checked.signature_count(),
        "transaction_xdr": transaction_xdr,
        "hash": hex(&checked.hash),
    });
    details.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    Ok((checked, details, max * 1000))
}

/// Verify the raw signature, then append it to the outer envelope.
pub fn attach_signature(checked: &CheckedTransaction, signature: &str) -> Result<String> {
    let raw = lower_hex::<64>(signature).filter(|raw| verify(&checked.key, &checked.hash, raw));
    let Some(raw) = raw else {
        return fail("internal", "The signing response failed independent signature verification.");
    };
    let decorated = DecoratedSignature {
        hint: SignatureHint(hint(&checked.key)),
        signature: Signature(raw.to_vec().try_into().expect("64 bytes")),
    };
    let mut envelope = checked.envelope.clone();
    let signatures = match &mut envelope {
        TransactionEnvelope::Tx(v1) => &mut v1.signatures,
        TransactionEnvelope::TxFeeBump(fee_bump) => &mut fee_bump.signatures,
        TransactionEnvelope::TxV0(_) => unreachable!("inspect rejects V0 envelopes"),
    };
    let mut list = signatures.to_vec();
    list.push(decorated);
    *signatures = list.try_into().expect("inspect allows at most 19 existing signatures");
    Ok(stellar::encode(&envelope))
}
