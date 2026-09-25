#![cfg(test)]
extern crate std;

use super::*;
use ed25519_dalek::{Signer as _, SigningKey};
use soroban_sdk::{
    auth::{ContractContext, CreateContractWithConstructorHostFnContext},
    testutils::{Address as _, BytesN as _},
    vec, ContractExecutableRef, IntoVal, String, Symbol,
};

fn setup() -> (Env, Address, Address, SigningKey) {
    let env = Env::default();
    let key = SigningKey::from_bytes(&[5u8; 32]);
    let owner = BytesN::<32>::from_array(&env, key.verifying_key().as_bytes());
    let manager = Address::generate(&env);
    let account = env.register(Cap85Account, (owner, manager.clone()));
    (env, account, manager, key)
}

fn check(env: &Env, account: &Address, key: &SigningKey, contexts: Vec<Context>) -> Result<(), Result<Error, soroban_sdk::InvokeError>> {
    let payload = BytesN::<32>::random(env);
    let signature = BytesN::<64>::from_array(env, &key.sign(&payload.to_array()).to_bytes());
    env.try_invoke_contract_check_auth::<Error>(account, &payload, signature.into_val(env), &contexts)
}

fn creation(env: &Env, executable: ContractExecutable) -> Context {
    Context::CreateContractWithCtorHostFn(CreateContractWithConstructorHostFnContext {
        executable,
        salt: BytesN::from_array(env, &[1u8; 32]),
        constructor_args: vec![env],
    })
}

#[test]
fn trusted_external_ref_creation_passes() {
    let (env, account, manager, key) = setup();
    let ctx = creation(&env, ContractExecutable::ExternalRef(ContractExecutableRef { owner: manager, tag: String::from_str(&env, "target") }));
    assert!(check(&env, &account, &key, vec![&env, ctx]).is_ok());
}

#[test]
fn wasm_creation_rejected() {
    let (env, account, _manager, key) = setup();
    let ctx = creation(&env, ContractExecutable::Wasm(BytesN::from_array(&env, &[9u8; 32])));
    assert_eq!(check(&env, &account, &key, vec![&env, ctx]), Err(Ok(Error::ExecutableNotExternalRef)));
}

#[test]
fn untrusted_owner_rejected() {
    let (env, account, _manager, key) = setup();
    let ctx = creation(&env, ContractExecutable::ExternalRef(ContractExecutableRef { owner: Address::generate(&env), tag: String::from_str(&env, "target") }));
    assert_eq!(check(&env, &account, &key, vec![&env, ctx]), Err(Ok(Error::UntrustedOwner)));
}

#[test]
fn contract_call_context_passes_and_wrong_key_fails() {
    let (env, account, _manager, key) = setup();
    let ctx = Context::Contract(ContractContext { contract: Address::generate(&env), fn_name: Symbol::new(&env, "ping"), args: vec![&env] });
    assert!(check(&env, &account, &key, vec![&env, ctx.clone()]).is_ok());
    assert!(check(&env, &account, &SigningKey::from_bytes(&[6u8; 32]), vec![&env, ctx]).is_err());
}

// ---- Legacy (SDK 27) accounts run as wasm inside this SDK 28 test host ----
// The protocol 28 host passes ContractExecutable::ExternalRef in creation contexts.
const LEGACY_READS_CONTEXTS: &[u8] = include_bytes!("../../../wasm/cap85_legacy_account.wasm");
const LEGACY_IGNORES_CONTEXTS: &[u8] = include_bytes!("../../../../wasm/walleterm_simple_account.wasm");

fn legacy_check(wasm: &[u8], executable: fn(&Env) -> ContractExecutable) -> Result<(), Result<soroban_sdk::Error, soroban_sdk::InvokeError>> {
    // Everything is built inside one Env; host objects must not cross environments.
    let env = Env::default();
    let key = SigningKey::from_bytes(&[5u8; 32]);
    let account = env.register(wasm, (BytesN::<32>::from_array(&env, key.verifying_key().as_bytes()),));
    let payload = BytesN::<32>::random(&env);
    let signature = BytesN::<64>::from_array(&env, &key.sign(&payload.to_array()).to_bytes());
    let contexts = vec![&env, creation(&env, executable(&env))];
    env.try_invoke_contract_check_auth::<soroban_sdk::Error>(&account, &payload, signature.into_val(&env), &contexts)
}

fn external_ref(env: &Env) -> ContractExecutable {
    ContractExecutable::ExternalRef(ContractExecutableRef { owner: Address::generate(env), tag: String::from_str(env, "target") })
}

fn wasm_executable(env: &Env) -> ContractExecutable {
    ContractExecutable::Wasm(BytesN::from_array(env, &[9u8; 32]))
}

#[test]
fn legacy_sdk27_account_that_reads_contexts_rejects_external_ref_and_accepts_wasm() {
    assert!(legacy_check(LEGACY_READS_CONTEXTS, external_ref).is_err());
    assert!(legacy_check(LEGACY_READS_CONTEXTS, wasm_executable).is_ok());
}

#[test]
fn legacy_sdk27_account_that_ignores_contexts_accepts_external_ref() {
    assert!(legacy_check(LEGACY_IGNORES_CONTEXTS, external_ref).is_ok());
    assert!(legacy_check(LEGACY_IGNORES_CONTEXTS, wasm_executable).is_ok());
}

#[test]
fn legacy_sdk27_decode_failure_is_value_missing_value() {
    // Exact error the SDK 27 context-reading account returns on an ExternalRef creation context.
    assert_eq!(std::format!("{:?}", legacy_check(LEGACY_READS_CONTEXTS, external_ref)), "Err(Ok(Error(Value, MissingValue)))");
}
