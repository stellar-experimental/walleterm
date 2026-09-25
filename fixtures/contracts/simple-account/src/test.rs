#![cfg(test)]
extern crate std;

use super::*;
use ed25519_dalek::{Signer as _, SigningKey};
use soroban_sdk::{
    auth::ContractContext,
    testutils::{Address as _, BytesN as _},
    vec, Address, IntoVal, Symbol,
};

fn signing_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn owner_bytes(env: &Env, key: &SigningKey) -> BytesN<32> {
    BytesN::<32>::from_array(env, key.verifying_key().as_bytes())
}

fn contexts(env: &Env) -> Vec<Context> {
    vec![
        env,
        Context::Contract(ContractContext {
            contract: Address::generate(env),
            fn_name: Symbol::new(env, "ping"),
            args: vec![env],
        }),
    ]
}

fn check_auth(env: &Env, account: &Address, key: &SigningKey, payload: &BytesN<32>) -> bool {
    let signature = BytesN::<64>::from_array(env, &key.sign(&payload.to_array()).to_bytes());
    env.try_invoke_contract_check_auth::<Error>(
        account,
        payload,
        signature.into_val(env),
        &contexts(env),
    )
    .is_ok()
}

#[test]
fn owner_signature_over_raw_payload_passes() {
    let env = Env::default();
    let key = signing_key(7);
    let account = env.register(SimpleAccount, (owner_bytes(&env, &key),));
    let payload = BytesN::<32>::random(&env);
    assert!(check_auth(&env, &account, &key, &payload));
}

#[test]
fn other_key_fails() {
    let env = Env::default();
    let owner = signing_key(7);
    let other = signing_key(9);
    let account = env.register(SimpleAccount, (owner_bytes(&env, &owner),));
    let payload = BytesN::<32>::random(&env);
    assert!(!check_auth(&env, &account, &other, &payload));
}

#[test]
fn changed_payload_fails() {
    let env = Env::default();
    let key = signing_key(7);
    let account = env.register(SimpleAccount, (owner_bytes(&env, &key),));
    let payload = BytesN::<32>::random(&env);
    let signature = BytesN::<64>::from_array(&env, &key.sign(&payload.to_array()).to_bytes());
    let mut altered = payload.to_array();
    altered[0] ^= 1;
    let altered = BytesN::<32>::from_array(&env, &altered);
    let result = env.try_invoke_contract_check_auth::<Error>(
        &account,
        &altered,
        signature.into_val(&env),
        &contexts(&env),
    );
    assert!(result.is_err());
}

#[test]
fn set_owner_rotates_and_requires_account_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let old = signing_key(7);
    let new = signing_key(9);
    let account = env.register(SimpleAccount, (owner_bytes(&env, &old),));
    let client = SimpleAccountClient::new(&env, &account);

    client.set_owner(&owner_bytes(&env, &new));
    // env.auths() reports the last invocation only, so assert before any read.
    assert_eq!(env.auths()[0].0, account);

    assert_eq!(client.owner(), owner_bytes(&env, &new));
    let payload = BytesN::<32>::random(&env);
    assert!(check_auth(&env, &account, &new, &payload));
    assert!(!check_auth(&env, &account, &old, &payload));
}
