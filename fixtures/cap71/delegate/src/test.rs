extern crate std;
use super::*;
use cap71_raw_account::RawAccount;
use cap71_target::{Target, TargetClient};
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{testutils::Ledger, xdr::*, Bytes, BytesN, IntoVal, TryIntoVal};
use std::{format, vec};

fn env() -> Env {
    let e = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    e.ledger().set_sequence_number(10);
    e
}
fn key() -> SigningKey {
    SigningKey::from_bytes(&[71; 32])
}
fn leaf(e: &Env) -> Address {
    e.register(
        RawAccount,
        (BytesN::from_array(e, key().verifying_key().as_bytes()),),
    )
}
fn root(target: &Address) -> SorobanAuthorizedInvocation {
    SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: target.clone().try_into().unwrap(),
            function_name: "ping".try_into().unwrap(),
            args: vec![ScVal::U32(1)].try_into().unwrap(),
        }),
        sub_invocations: Default::default(),
    }
}
fn payload(
    e: &Env,
    who: &Address,
    invocation: &SorobanAuthorizedInvocation,
    nonce: i64,
    expiry: u32,
) -> [u8; 32] {
    let preimage = HashIdPreimage::SorobanAuthorizationWithAddress(
        HashIdPreimageSorobanAuthorizationWithAddress {
            network_id: e.ledger().get().network_id.into(),
            nonce,
            signature_expiration_ledger: expiry,
            address: who.clone().try_into().unwrap(),
            invocation: invocation.clone(),
        },
    );
    e.crypto()
        .sha256(&Bytes::from_slice(
            e,
            &preimage.to_xdr(Limits::none()).unwrap(),
        ))
        .to_array()
}
fn node(
    address: &Address,
    signature: ScVal,
    children: std::vec::Vec<SorobanDelegateSignature>,
) -> SorobanDelegateSignature {
    SorobanDelegateSignature {
        address: address.clone().try_into().unwrap(),
        signature,
        nested_delegates: children.try_into().unwrap(),
    }
}
fn sig(payload: &[u8; 32]) -> ScVal {
    ScVal::Bytes(key().sign(payload).to_bytes().to_vec().try_into().unwrap())
}
fn entry(
    who: &Address,
    invocation: SorobanAuthorizedInvocation,
    mut delegates: std::vec::Vec<SorobanDelegateSignature>,
) -> SorobanAuthorizationEntry {
    delegates.sort_by(|a, b| a.address.cmp(&b.address));
    SorobanAuthorizationEntry {
        credentials: SorobanCredentials::AddressWithDelegates(
            SorobanAddressCredentialsWithDelegates {
                address_credentials: SorobanAddressCredentials {
                    address: who.clone().try_into().unwrap(),
                    nonce: 1,
                    signature_expiration_ledger: 100,
                    signature: ScVal::Void,
                },
                delegates: delegates.try_into().unwrap(),
            },
        ),
        root_invocation: invocation,
    }
}
fn delegates(e: &Env, weights: &[(Address, u32)], threshold: u32) -> Address {
    let mut map = Map::new(e);
    for (address, weight) in weights {
        map.set(address.clone(), *weight);
    }
    e.register(DelegateAccount, (map, threshold))
}
fn diagnostics(e: &Env) -> std::string::String {
    format!("{:?}", e.host().get_diagnostic_events().unwrap())
}

#[test]
fn nested_delegates_verify_shared_root_payload() {
    let e = env();
    let signer = leaf(&e);
    let target = e.register(Target, ());
    let inner = delegates(&e, &[(signer.clone(), 1)], 1);
    let outer = delegates(&e, &[(inner.clone(), 1)], 1);
    let invocation = root(&target);
    let hash = payload(&e, &outer, &invocation, 1, 100);
    let auth = entry(
        &outer,
        invocation,
        vec![node(
            &inner,
            ScVal::Void,
            vec![node(&signer, sig(&hash), vec![])],
        )],
    );
    e.set_auths(&[auth]);
    assert_eq!(TargetClient::new(&e, &target).ping(&outer, &1), 1);
    assert_eq!(e.auths().len(), 1);
}

#[test]
fn empty_unknown_and_underweight_have_distinct_reasons() {
    for (mode, error) in [(0, 7101), (1, 7102), (2, 7103)] {
        let e = env();
        let a = leaf(&e);
        let b = leaf(&e);
        let stranger = leaf(&e);
        let who = delegates(&e, &[(a.clone(), 1), (b, 1)], 2);
        let target = e.register(Target, ());
        let invocation = root(&target);
        let hash = payload(&e, &who, &invocation, 1, 100);
        let nodes = match mode {
            0 => vec![],
            1 => vec![node(&stranger, sig(&hash), vec![])],
            _ => vec![node(&a, sig(&hash), vec![])],
        };
        e.set_auths(&[entry(&who, invocation, nodes)]);
        assert!(TargetClient::new(&e, &target).try_ping(&who, &1).is_err());
        assert!(
            diagnostics(&e).contains(&format!("Error(Contract({error}))")),
            "{}",
            diagnostics(&e)
        );
        assert_eq!(TargetClient::new(&e, &target).count(&who), 0);
    }
}

#[test]
fn threshold_and_all_supplied_signatures_are_enforced() {
    for corrupt in [false, true] {
        let e = env();
        let a = leaf(&e);
        let b = leaf(&e);
        let who = delegates(&e, &[(a.clone(), 2), (b.clone(), 1)], 2);
        let target = e.register(Target, ());
        let invocation = root(&target);
        let hash = payload(&e, &who, &invocation, 1, 100);
        let other_hash = if corrupt { [0; 32] } else { hash };
        e.set_auths(&[entry(
            &who,
            invocation,
            vec![
                node(&a, sig(&hash), vec![]),
                node(&b, sig(&other_hash), vec![]),
            ],
        )]);
        let result = TargetClient::new(&e, &target).try_ping(&who, &1);
        assert_eq!(result.is_ok(), !corrupt);
        if corrupt {
            assert!(diagnostics(&e).contains("Error(Crypto(InvalidInput))"));
        }
    }
}

#[test]
fn address_v2_rejects_same_key_cross_account_replay() {
    let e = env();
    let a = leaf(&e);
    let b = leaf(&e);
    let target = e.register(Target, ());
    let invocation = root(&target);
    let signature = sig(&payload(&e, &a, &invocation, 1, 100));
    let make = |who: &Address| SorobanAuthorizationEntry {
        credentials: SorobanCredentials::AddressV2(SorobanAddressCredentials {
            address: who.clone().try_into().unwrap(),
            nonce: 1,
            signature_expiration_ledger: 100,
            signature: signature.clone(),
        }),
        root_invocation: invocation.clone(),
    };
    e.set_auths(&[make(&a)]);
    assert_eq!(TargetClient::new(&e, &target).ping(&a, &1), 1);
    e.set_auths(&[make(&b)]);
    assert!(TargetClient::new(&e, &target).try_ping(&b, &1).is_err());
    assert!(diagnostics(&e).contains("Error(Crypto(InvalidInput))"));
    assert_eq!(TargetClient::new(&e, &target).count(&b), 0);
}

#[test]
fn constructor_rejects_invalid_policies() {
    for (weight, threshold) in [(0, 1), (1, 0), (1, 2)] {
        let rejected = std::panic::catch_unwind(|| {
            let e = env();
            let signer = leaf(&e);
            delegates(&e, &[(signer, weight)], threshold);
        });
        assert!(rejected.is_err());
    }
    assert!(std::panic::catch_unwind(|| delegates(&env(), &[], 1)).is_err());
}

#[test]
fn host_rejects_duplicate_and_unordered_delegates() {
    for duplicate in [true, false] {
        let e = env();
        let a = leaf(&e);
        let b = leaf(&e);
        let who = delegates(&e, &[(a.clone(), 1), (b.clone(), 1)], 1);
        let target = e.register(Target, ());
        let invocation = root(&target);
        let hash = payload(&e, &who, &invocation, 1, 100);
        let mut auth = entry(
            &who,
            invocation,
            vec![node(&a, sig(&hash), vec![]), node(&b, sig(&hash), vec![])],
        );
        if let SorobanCredentials::AddressWithDelegates(ref mut credentials) = auth.credentials {
            let mut nodes = credentials.delegates.to_vec();
            if duplicate {
                nodes.insert(0, nodes[0].clone());
            } else {
                nodes.reverse();
            }
            credentials.delegates = nodes.try_into().unwrap();
        }
        let rejected =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| e.set_auths(&[auth])));
        assert!(rejected.is_err());
        let expected = if duplicate {
            "delegated signers contain duplicate address"
        } else {
            "delegated signer addresses are not in sorted order"
        };
        assert!(diagnostics(&e).contains(expected), "{}", diagnostics(&e));
    }
}

#[test]
fn host_rejects_expired_and_consumed_nonce_with_distinct_reasons() {
    for expired in [false, true] {
        let e = env();
        let a = leaf(&e);
        let who = delegates(&e, &[(a.clone(), 1)], 1);
        let target = e.register(Target, ());
        let invocation = root(&target);
        let hash = payload(&e, &who, &invocation, 1, 100);
        let auth = entry(&who, invocation, vec![node(&a, sig(&hash), vec![])]);
        if expired {
            e.ledger().set_sequence_number(101);
        } else {
            e.set_auths(&[auth.clone()]);
            assert_eq!(TargetClient::new(&e, &target).ping(&who, &1), 1);
        }
        e.set_auths(&[auth]);
        assert!(TargetClient::new(&e, &target).try_ping(&who, &1).is_err());
        let expected = if expired {
            "signature has expired"
        } else {
            "nonce already exists for address"
        };
        assert!(diagnostics(&e).contains(expected), "{}", diagnostics(&e));
    }
}

#[test]
fn native_g_and_c_to_c_to_g_verify_real_ed25519_signatures() {
    for nested in [false, true] {
        let e = env();
        let account_id = AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(
            *key().verifying_key().as_bytes(),
        )));
        let ledger_key = std::rc::Rc::new(LedgerKey::Account(LedgerKeyAccount {
            account_id: account_id.clone(),
        }));
        let ledger_entry = std::rc::Rc::new(LedgerEntry {
            last_modified_ledger_seq: 1,
            ext: LedgerEntryExt::V0,
            data: LedgerEntryData::Account(AccountEntry {
                account_id: account_id.clone(),
                balance: 10_000_000_000,
                seq_num: SequenceNumber(1),
                num_sub_entries: 0,
                inflation_dest: None,
                flags: 0,
                home_domain: Default::default(),
                thresholds: Thresholds([1, 1, 1, 1]),
                signers: Default::default(),
                ext: AccountEntryExt::V0,
            }),
        });
        e.host()
            .add_ledger_entry(&ledger_key, &ledger_entry, None)
            .unwrap();
        let g: Address = ScAddress::Account(account_id).try_into_val(&e).unwrap();
        let inner = delegates(&e, &[(g.clone(), 1)], 1);
        let who = if nested {
            delegates(&e, &[(inner.clone(), 1)], 1)
        } else {
            inner.clone()
        };
        let target = e.register(Target, ());
        let invocation = root(&target);
        let hash = payload(&e, &who, &invocation, 1, 100);
        let mut signature = Map::new(&e);
        signature.set(
            soroban_sdk::Symbol::new(&e, "public_key"),
            Bytes::from_slice(&e, key().verifying_key().as_bytes()),
        );
        signature.set(
            soroban_sdk::Symbol::new(&e, "signature"),
            Bytes::from_slice(&e, &key().sign(&hash).to_bytes()),
        );
        let signatures = soroban_sdk::vec![&e, signature];
        let value: soroban_sdk::Val = signatures.into_val(&e);
        let leaf = node(&g, value.try_into_val(&e).unwrap(), vec![]);
        let nodes = if nested {
            vec![node(&inner, ScVal::Void, vec![leaf])]
        } else {
            vec![leaf]
        };
        let mut auth = entry(&who, invocation, nodes);
        // Keep the registered G address present, but remove its signature vector.
        let mut missing = auth.clone();
        if let SorobanCredentials::AddressWithDelegates(ref mut credentials) = missing.credentials {
            let mut delegates = credentials.delegates.to_vec();
            if nested {
                let mut leaves = delegates[0].nested_delegates.to_vec();
                leaves[0].signature = ScVal::Vec(Some(ScVec::default()));
                delegates[0].nested_delegates = leaves.try_into().unwrap();
            } else {
                delegates[0].signature = ScVal::Vec(Some(ScVec::default()));
            }
            credentials.delegates = delegates.try_into().unwrap();
        }
        e.set_auths(&[missing]);
        assert!(TargetClient::new(&e, &target).try_ping(&who, &1).is_err());
        assert!(diagnostics(&e).contains("Error(Contract(5))"));
        assert!(diagnostics(&e).contains("no account signatures found"));
        assert_eq!(TargetClient::new(&e, &target).count(&who), 0);
        e.set_auths(&[auth.clone()]);
        assert_eq!(TargetClient::new(&e, &target).ping(&who, &1), 1);
        let other = delegates(&e, &[(if nested { inner } else { g }, 1)], 1);
        if let SorobanCredentials::AddressWithDelegates(ref mut credentials) = auth.credentials {
            credentials.address_credentials.address = other.clone().try_into().unwrap();
        }
        e.set_auths(&[auth]);
        assert!(TargetClient::new(&e, &target).try_ping(&other, &1).is_err());
        assert!(diagnostics(&e).contains("Error(Crypto(InvalidInput))"));
    }
}
