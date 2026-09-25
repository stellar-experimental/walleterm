#![cfg(test)]
extern crate std;

use super::*;
use ed25519_dalek::{Signer as _, SigningKey};
use soroban_sdk::auth::ContractExecutable;
use soroban_sdk::{
    auth::{ContractContext, CreateContractWithConstructorHostFnContext},
    testutils::{Address as _, BytesN as _},
    vec, Address, IntoVal,
};

#[test]
fn wasm_creation_and_call_contexts_pass_wrong_key_fails() {
    let env = Env::default();
    let key = SigningKey::from_bytes(&[5u8; 32]);
    let account = env.register(LegacyAccount, (BytesN::<32>::from_array(&env, key.verifying_key().as_bytes()),));
    let payload = BytesN::<32>::random(&env);
    let signature = BytesN::<64>::from_array(&env, &key.sign(&payload.to_array()).to_bytes());
    let contexts = vec![
        &env,
        Context::Contract(ContractContext { contract: Address::generate(&env), fn_name: Symbol::new(&env, "ping"), args: vec![&env] }),
        Context::CreateContractWithCtorHostFn(CreateContractWithConstructorHostFnContext {
            executable: ContractExecutable::Wasm(BytesN::from_array(&env, &[9u8; 32])),
            salt: BytesN::from_array(&env, &[1u8; 32]),
            constructor_args: vec![&env],
        }),
    ];
    assert!(env.try_invoke_contract_check_auth::<Error>(&account, &payload, signature.clone().into_val(&env), &contexts).is_ok());
    let other = SigningKey::from_bytes(&[6u8; 32]);
    let bad = BytesN::<64>::from_array(&env, &other.sign(&payload.to_array()).to_bytes());
    assert!(env.try_invoke_contract_check_auth::<Error>(&account, &payload, bad.into_val(&env), &contexts).is_err());
}
