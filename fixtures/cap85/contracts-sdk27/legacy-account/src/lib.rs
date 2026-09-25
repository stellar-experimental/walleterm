//! SDK 27 custom account that READS every authorization context.
//!
//! Same signature scheme as walleterm_simple_account (Ed25519 over the raw
//! host payload, ScVal Bytes(64)), but `__check_auth` iterates and matches
//! all contexts. Iteration decodes each `Context`, and the SDK 27 decoder
//! has no `ContractExecutable::ExternalRef` variant, so a CAP-85 creation
//! context fails to decode. The existing walleterm_simple_account ignores
//! its contexts and is therefore not affected. Built here to keep the
//! original fixtures unchanged.
#![no_std]
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl,
    crypto::Hash,
    symbol_short, Bytes, BytesN, Env, Symbol, Vec,
};

const OWNER: Symbol = symbol_short!("owner");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
}

#[contract]
pub struct LegacyAccount;

#[contractimpl]
impl LegacyAccount {
    pub fn __constructor(env: Env, owner: BytesN<32>) {
        env.storage().instance().set(&OWNER, &owner);
    }

    pub fn owner(env: Env) -> Result<BytesN<32>, Error> {
        env.storage().instance().get(&OWNER).ok_or(Error::NotInitialized)
    }
}

#[contractimpl]
impl CustomAccountInterface for LegacyAccount {
    type Error = Error;
    type Signature = BytesN<64>;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: BytesN<64>,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let owner: BytesN<32> = env.storage().instance().get(&OWNER).ok_or(Error::NotInitialized)?;
        let payload: Bytes = signature_payload.to_bytes().to_bytes();
        env.crypto().ed25519_verify(&owner, &payload, &signature);
        // Decoding every context is the point: an SDK 27 decoder panics on ExternalRef.
        for context in auth_contexts.iter() {
            match context {
                Context::Contract(_) => {}
                Context::CreateContractHostFn(_) => {}
                Context::CreateContractWithCtorHostFn(_) => {}
            }
        }
        Ok(())
    }
}

mod test;
