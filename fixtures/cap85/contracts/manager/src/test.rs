#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, vec, IntoVal, Symbol};

const TARGET_V1: &[u8] = include_bytes!("../../../wasm/cap85_target_v1.wasm");
const TARGET_V2: &[u8] = include_bytes!("../../../wasm/cap85_target_v2.wasm");

fn setup() -> (Env, ManagerClient<'static>, Address, BytesN<32>, BytesN<32>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(Manager, (admin.clone(),));
    let client = ManagerClient::new(&env, &id);
    let v1 = env.deployer().upload_contract_wasm(TARGET_V1);
    let v2 = env.deployer().upload_contract_wasm(TARGET_V2);
    (env, client, admin, v1, v2)
}

fn version(env: &Env, contract: &Address) -> u32 {
    env.invoke_contract(contract, &Symbol::new(env, "version"), vec![env])
}

#[test]
fn set_get_and_stale_guard() {
    let (env, client, _admin, v1, v2) = setup();
    let tag = String::from_str(&env, "target");
    assert_eq!(client.executable(&tag), None);
    assert_eq!(client.set_executable(&tag, &v1, &1), 1);
    assert_eq!(client.executable(&tag), Some(v1.clone()));
    assert_eq!(client.try_set_executable(&tag, &v2, &1), Err(Ok(Error::StaleVersion)));
    assert_eq!(client.set_executable(&tag, &v2, &2), 2);
    assert_eq!(client.version_of(&tag), 2);
}

#[test]
#[should_panic(expected = "Error(Storage, MissingValue)")]
fn unknown_wasm_hash_rejected_by_protocol() {
    // Host diagnostic: "Wasm does not exist".
    let (env, client, _admin, _v1, _v2) = setup();
    client.set_executable(&String::from_str(&env, "target"), &BytesN::from_array(&env, &[7u8; 32]), &1);
}

#[test]
fn deploy_via_external_ref_then_switch_behavior_at_same_address() {
    let (env, client, admin, v1, v2) = setup();
    let tag = String::from_str(&env, "target");
    client.set_executable(&tag, &v1, &1);
    let salt = BytesN::from_array(&env, &[3u8; 32]);
    let deployed = client.deploy(&tag, &salt, &vec![&env, admin.clone().into_val(&env)]);
    assert_eq!(version(&env, &deployed), 1);
    assert_eq!(client.resolved_wasm(&deployed), Some(v1));
    let who = Address::generate(&env);
    let n1: u32 = env.invoke_contract(&deployed, &Symbol::new(&env, "ping"), vec![&env, who.clone().into_val(&env), 1u32.into_val(&env)]);
    assert_eq!(n1, 1);

    client.set_executable(&tag, &v2, &2);
    assert_eq!(version(&env, &deployed), 2);
    assert_eq!(client.resolved_wasm(&deployed), Some(v2));
    // v2 doubles the increment; state at the same address is preserved.
    let n2: u32 = env.invoke_contract(&deployed, &Symbol::new(&env, "ping"), vec![&env, who.into_val(&env), 1u32.into_val(&env)]);
    assert_eq!(n2, 3);
}

#[test]
#[should_panic(expected = "Auth, InvalidAction")]
fn set_executable_requires_admin() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(Manager, (admin,));
    let v1 = env.deployer().upload_contract_wasm(TARGET_V1);
    ManagerClient::new(&env, &id).set_executable(&String::from_str(&env, "target"), &v1, &1);
}
