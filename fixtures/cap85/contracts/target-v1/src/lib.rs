//! CAP-85 target contract, version 1. `ping` adds `n * 1` to a counter.
//! Version 1 of two otherwise identical builds; the manager swaps between them.
#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, ContractExecutable, ContractExecutableRef, Env, String};

pub const VERSION: u32 = 1;
const MULTIPLIER: u32 = 1;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Count(Address),
}

#[contract]
pub struct Target;

fn admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).expect("initialized")
}

#[contractimpl]
impl Target {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn version(_env: Env) -> u32 {
        VERSION
    }

    /// `who` must authorize. Adds `n * MULTIPLIER` to the counter of `who`.
    pub fn ping(env: Env, who: Address, n: u32) -> u32 {
        who.require_auth();
        let key = DataKey::Count(who);
        let count: u32 = env.storage().persistent().get(&key).unwrap_or(0) + n * MULTIPLIER;
        env.storage().persistent().set(&key, &count);
        count
    }

    pub fn count(env: Env, who: Address) -> u32 {
        env.storage().persistent().get(&DataKey::Count(who)).unwrap_or(0)
    }

    /// Moves this contract onto the executable reference `owner`/`tag`.
    /// Admin auth. Applied after this invocation returns.
    pub fn adopt_ref(env: Env, owner: Address, tag: String) {
        admin(&env).require_auth();
        env.deployer().update_current_contract(ContractExecutable::ExternalRef(ContractExecutableRef { owner, tag }));
    }

    /// Moves this contract back to a direct Wasm hash. Admin auth.
    pub fn adopt_wasm(env: Env, wasm_hash: BytesN<32>) {
        admin(&env).require_auth();
        env.deployer().update_current_contract(ContractExecutable::Wasm(wasm_hash));
    }
}

mod test;
