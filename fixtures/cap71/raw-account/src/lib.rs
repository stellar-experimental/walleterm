//! Immutable same-key account fixture for the address_v2 replay test.
#![no_std]
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    symbol_short, BytesN, Env, Vec,
};

#[contract]
pub struct RawAccount;

#[contractimpl]
impl RawAccount {
    pub fn __constructor(env: Env, owner: BytesN<32>) {
        env.storage()
            .instance()
            .set(&symbol_short!("owner"), &owner);
    }
}

#[contractimpl]
impl CustomAccountInterface for RawAccount {
    type Error = soroban_sdk::Error;
    type Signature = BytesN<64>;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        payload: Hash<32>,
        signature: BytesN<64>,
        _contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        let owner: BytesN<32> = env
            .storage()
            .instance()
            .get(&symbol_short!("owner"))
            .unwrap();
        env.crypto()
            .ed25519_verify(&owner, &payload.to_bytes().to_bytes(), &signature);
        Ok(())
    }
}
