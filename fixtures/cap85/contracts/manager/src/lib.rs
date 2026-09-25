//! CAP-85 executable owner ("manager").
//!
//! Owns executable reference entries keyed by an executable tag. Contracts
//! deployed with `ContractExecutable::ExternalRef { owner: this, tag }` run
//! whatever Wasm the entry points at. Changing the entry changes every such
//! contract at once, at the same addresses.
//!
//! Policy: only `admin` may change an entry, and the caller-supplied version
//! must increase (stale code guard). The protocol itself rejects a hash that
//! is not an uploaded Wasm and never lets the entry be removed.
#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, ContractExecutable,
    ContractExecutableRef, Env, Executable, String, Val, Vec,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Version(String),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    StaleVersion = 2,
}

#[contract]
pub struct Manager;

fn admin(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&DataKey::Admin).ok_or(Error::NotInitialized)
}

#[contractimpl]
impl Manager {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        admin(&env)
    }

    /// Points `tag` at `wasm_hash`. Admin auth. `version` must be greater
    /// than the stored version for `tag`.
    pub fn set_executable(env: Env, tag: String, wasm_hash: BytesN<32>, version: u32) -> Result<u32, Error> {
        admin(&env)?.require_auth();
        let key = DataKey::Version(tag.clone());
        let current: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        if version <= current {
            return Err(Error::StaleVersion);
        }
        // Protocol checks: persistent entry, value is an existing Wasm hash.
        env.executable_refs().set(&tag, &wasm_hash);
        env.storage().persistent().set(&key, &version);
        Ok(version)
    }

    pub fn executable(env: Env, tag: String) -> Option<BytesN<32>> {
        env.executable_refs().get(&tag)
    }

    pub fn version_of(env: Env, tag: String) -> u32 {
        env.storage().persistent().get(&DataKey::Version(tag)).unwrap_or(0)
    }

    /// Deploys a contract whose executable is this manager's `tag` entry.
    /// The deployer is this contract, so the address derives from it and `salt`.
    pub fn deploy(env: Env, tag: String, salt: BytesN<32>, constructor_args: Vec<Val>) -> Result<Address, Error> {
        admin(&env)?.require_auth();
        Ok(env.deployer().with_current_contract(salt).deploy_contract(
            ContractExecutable::ExternalRef(ContractExecutableRef { owner: env.current_contract_address(), tag }),
            constructor_args,
        ))
    }

    /// Resolved Wasm hash of any contract address (`get_address_executable`
    /// resolves executable references to the Wasm hash they point at).
    pub fn resolved_wasm(env: Env, contract: Address) -> Option<BytesN<32>> {
        match contract.executable() {
            Some(Executable::Wasm(hash)) => Some(hash),
            _ => None,
        }
    }
}

mod test;
