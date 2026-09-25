//! Immutable CAP-71 account. This fixture has no administration or upgrade path.
#![no_std]
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl,
    crypto::Hash,
    symbol_short, Address, Env, Map, Vec,
};

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    InvalidConfig = 7100,
    EmptyDelegates = 7101,
    UnknownDelegate = 7102,
    InsufficientWeight = 7103,
}

#[contract]
pub struct DelegateAccount;

#[contractimpl]
impl DelegateAccount {
    pub fn __constructor(
        env: Env,
        weights: Map<Address, u32>,
        threshold: u32,
    ) -> Result<(), Error> {
        if weights.is_empty() || weights.len() > 16 || threshold == 0 {
            return Err(Error::InvalidConfig);
        }
        let mut total = 0u32;
        for (_, weight) in weights.iter() {
            if weight == 0 {
                return Err(Error::InvalidConfig);
            }
            total = total.checked_add(weight).ok_or(Error::InvalidConfig)?;
        }
        if threshold > total {
            return Err(Error::InvalidConfig);
        }
        env.storage()
            .instance()
            .set(&symbol_short!("weights"), &weights);
        env.storage()
            .instance()
            .set(&symbol_short!("threshold"), &threshold);
        Ok(())
    }
}

#[contractimpl]
impl CustomAccountInterface for DelegateAccount {
    type Error = Error;
    type Signature = ();

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        _payload: Hash<32>,
        _signature: (),
        _contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let weights: Map<Address, u32> = env
            .storage()
            .instance()
            .get(&symbol_short!("weights"))
            .ok_or(Error::InvalidConfig)?;
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&symbol_short!("threshold"))
            .ok_or(Error::InvalidConfig)?;
        if threshold == 0 {
            return Err(Error::InvalidConfig);
        }
        let delegates = env.custom_account().get_delegated_signers();
        if delegates.is_empty() {
            return Err(Error::EmptyDelegates);
        }
        let mut total = 0u32;
        for delegate in delegates.iter() {
            let weight = weights.get(delegate).ok_or(Error::UnknownDelegate)?;
            total = total.checked_add(weight).ok_or(Error::InvalidConfig)?;
        }
        if total < threshold {
            return Err(Error::InsufficientWeight);
        }
        // The host rejects duplicate and unordered addresses before this function.
        // Verify all supplied members, including members beyond the threshold.
        for delegate in delegates.iter() {
            env.custom_account().delegate_auth(&delegate);
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
