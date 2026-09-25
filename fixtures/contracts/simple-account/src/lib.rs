//! Minimal contract account with one Ed25519 owner.
//!
//! The owner signs the raw 32-byte `signature_payload` that the host passes
//! to `__check_auth`. This is the naive host-payload scheme. It is correct
//! for this account and wrong for the OpenZeppelin account, which signs
//! `sha256(signature_payload || context_rule_ids_xdr)` instead.
//!
//! Signature ScVal: `Bytes` with exactly 64 raw Ed25519 signature bytes.
//! Test matrix rows: C02, C06, C13.
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
pub struct SimpleAccount;

#[contractimpl]
impl SimpleAccount {
    pub fn __constructor(env: Env, owner: BytesN<32>) {
        env.storage().instance().set(&OWNER, &owner);
    }

    pub fn owner(env: Env) -> Result<BytesN<32>, Error> {
        env.storage().instance().get(&OWNER).ok_or(Error::NotInitialized)
    }

    /// Rotates the owner key. The account itself must authorize the call,
    /// so the current owner signs the auth entry.
    pub fn set_owner(env: Env, owner: BytesN<32>) {
        env.current_contract_address().require_auth();
        env.storage().instance().set(&OWNER, &owner);
    }
}

#[contractimpl]
impl CustomAccountInterface for SimpleAccount {
    type Error = Error;
    type Signature = BytesN<64>;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: BytesN<64>,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let owner: BytesN<32> = env.storage().instance().get(&OWNER).ok_or(Error::NotInitialized)?;
        let payload: Bytes = signature_payload.to_bytes().to_bytes();
        // Panics with Error(Crypto, InvalidInput) on a bad signature.
        env.crypto().ed25519_verify(&owner, &payload, &signature);
        Ok(())
    }
}

mod test;
