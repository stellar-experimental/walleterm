//! SDK 28 aware custom account.
//!
//! One Ed25519 owner signs the raw 32-byte host `signature_payload`
//! (signature ScVal: `Bytes(64)`). Contract creation is authorized only when
//! the executable is `ContractExecutable::ExternalRef` owned by the trusted
//! manager. An SDK 27 account that inspects contexts cannot even parse the
//! `ExternalRef` variant (CAP-85 backwards incompatibility note).
#![no_std]
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    Address, Bytes, BytesN, ContractExecutable, Env, Vec,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Owner,
    TrustedManager,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    ExecutableNotExternalRef = 2,
    UntrustedOwner = 3,
}

#[contract]
pub struct Cap85Account;

fn check_executable(env: &Env, executable: &ContractExecutable) -> Result<(), Error> {
    let trusted: Address = env.storage().instance().get(&DataKey::TrustedManager).ok_or(Error::NotInitialized)?;
    match executable {
        ContractExecutable::ExternalRef(r) if r.owner == trusted => Ok(()),
        ContractExecutable::ExternalRef(_) => Err(Error::UntrustedOwner),
        ContractExecutable::Wasm(_) => Err(Error::ExecutableNotExternalRef),
    }
}

#[contractimpl]
impl Cap85Account {
    pub fn __constructor(env: Env, owner: BytesN<32>, trusted_manager: Address) {
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::TrustedManager, &trusted_manager);
    }

    pub fn owner(env: Env) -> Result<BytesN<32>, Error> {
        env.storage().instance().get(&DataKey::Owner).ok_or(Error::NotInitialized)
    }

    pub fn trusted_manager(env: Env) -> Result<Address, Error> {
        env.storage().instance().get(&DataKey::TrustedManager).ok_or(Error::NotInitialized)
    }
}

#[contractimpl]
impl CustomAccountInterface for Cap85Account {
    type Error = Error;
    type Signature = BytesN<64>;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: BytesN<64>,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let owner: BytesN<32> = env.storage().instance().get(&DataKey::Owner).ok_or(Error::NotInitialized)?;
        let payload: Bytes = signature_payload.to_bytes().to_bytes();
        env.crypto().ed25519_verify(&owner, &payload, &signature);
        for context in auth_contexts.iter() {
            match context {
                Context::Contract(_) => {}
                Context::CreateContractHostFn(c) => check_executable(&env, &c.executable)?,
                Context::CreateContractWithCtorHostFn(c) => check_executable(&env, &c.executable)?,
            }
        }
        Ok(())
    }
}

mod test;
