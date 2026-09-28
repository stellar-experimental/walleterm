//! V1 and fee-bump envelopes: structural checks, the network-bound hash, and one appended signature.
//! Operations are not filtered. The caller reviews the content.

use serde_json::{Value, json};
use stellar_xdr::{
    DecoratedSignature, FeeBumpTransactionInnerTx, Hash, MuxedAccount, OperationBody, Preconditions,
    Signature, SignatureHint, TimeBounds, Transaction, TransactionEnvelope, TransactionSignaturePayload,
    TransactionSignaturePayloadTaggedTransaction, TransactionV1Envelope,
};

use crate::authorization::verify;
use crate::error::{Result, fail};
use crate::stellar::{self, Decode};
use crate::util::{hex, sha256, valid_passphrase};

pub const TESTNET: &str = "Test SDF Network ; September 2015";
pub const MAX_TRANSACTION_XDR: usize = 262144;
/// The protocol permits 20 envelope signatures. The selected key adds one.
const MAX_EXISTING_SIGNATURES: usize = 19;

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

fn envelope(encoded: &str) -> Result<TransactionEnvelope> {
    if encoded.is_empty() || encoded.len() > MAX_TRANSACTION_XDR {
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

/// The shared checks: a canonical V1 or fee-bump envelope that the key has not signed yet.
/// The only time rule: a nonzero `max_time` at or before now fails. A fee bump uses its inner bounds.
pub fn inspect(
    transaction_xdr: &str,
    key: &[u8; 32],
    network_passphrase: &str,
    now_ms: u64,
) -> Result<CheckedTransaction> {
    if !valid_passphrase(network_passphrase) {
        return invalid("Provide the exact network passphrase.");
    }
    let envelope = envelope(transaction_xdr)?;
    let network_id = Hash(sha256(network_passphrase.as_bytes()));
    let (tagged, signatures) = match &envelope {
        TransactionEnvelope::Tx(TransactionV1Envelope { tx, signatures }) => {
            (TransactionSignaturePayloadTaggedTransaction::Tx(tx.clone()), signatures)
        }
        TransactionEnvelope::TxFeeBump(fee_bump) => (
            TransactionSignaturePayloadTaggedTransaction::TxFeeBump(fee_bump.tx.clone()),
            &fee_bump.signatures,
        ),
        TransactionEnvelope::TxV0(_) => unreachable!("envelope rejects V0"),
    };
    let payload = TransactionSignaturePayload { network_id, tagged_transaction: tagged };
    let hash = sha256(&stellar::xdr_bytes(&payload));
    if signatures.len() > MAX_EXISTING_SIGNATURES {
        return invalid("The transaction has too many signatures.");
    }
    let signed = signatures.iter().any(|s| {
        s.hint.0 == hint(key) && signature_bytes(&s.signature).is_some_and(|sig| verify(key, &hash, &sig))
    });
    if signed {
        return invalid("The selected account already signed this transaction.");
    }
    let checked = CheckedTransaction { envelope, hash, key: *key };
    let max_time = time_bounds(checked.inner()).map_or(0, |b| b.max_time.0);
    if max_time != 0 && u128::from(max_time) * 1000 <= u128::from(now_ms) {
        return invalid("The transaction expired. Its max_time is at or before the current time.");
    }
    Ok(checked)
}

/// The bridge rule: the key is the transaction source, an operation source, or the fee-bump fee source.
/// The CLI does not apply it, because a multisig co-signer signs for another account.
pub fn signer_role(transaction_xdr: &str, key: &[u8; 32]) -> Result<()> {
    let signers: Vec<[u8; 32]> = match &envelope(transaction_xdr)? {
        TransactionEnvelope::Tx(v1) => {
            let sources = v1.tx.operations.iter().filter_map(|op| op.source_account.as_ref());
            std::iter::once(&v1.tx.source_account).chain(sources).map(base_key).collect()
        }
        TransactionEnvelope::TxFeeBump(fee_bump) => vec![base_key(&fee_bump.tx.fee_source)],
        TransactionEnvelope::TxV0(_) => unreachable!("inspect rejects V0 envelopes"),
    };
    if !signers.contains(key) {
        return fail("address_mismatch", "The selected account does not need to sign this transaction.");
    }
    Ok(())
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

/// The review details. A missing time bound reads as 0, as in XDR.
pub fn details(checked: &CheckedTransaction, transaction_xdr: &str, network_passphrase: &str) -> Value {
    let inner = checked.inner();
    let bounds = time_bounds(inner);
    let source = inner.source_account.to_string();
    let operations: Vec<Value> = inner
        .operations
        .iter()
        .map(|op| {
            let source = op.source_account.as_ref().map_or_else(|| source.clone(), ToString::to_string);
            json!({ "type": operation_type(&op.body), "source": source })
        })
        .collect();
    let network = if network_passphrase == TESTNET { "TESTNET" } else { network_passphrase };
    let mut details = json!({
        "kind": "transaction",
        "network": network,
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
        "min_time": bounds.map_or(0, |b| b.min_time.0).to_string(),
        "max_time": bounds.map_or(0, |b| b.max_time.0).to_string(),
        "operations": operations,
        "existing_signatures": checked.signature_count(),
        "transaction_xdr": transaction_xdr,
        "hash": hex(&checked.hash),
    });
    details.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    details
}

/// Append one verified signature to the outer envelope. No other byte changes.
pub fn attach_signature(checked: &CheckedTransaction, signature: &[u8; 64]) -> String {
    let decorated = DecoratedSignature {
        hint: SignatureHint(hint(&checked.key)),
        signature: Signature(signature.to_vec().try_into().expect("64 bytes")),
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
    stellar::encode(&envelope)
}
