//! Deliberately omits `who` from the auth arguments to isolate address binding.
#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, IntoVal};

#[contract]
pub struct Target;

#[contractimpl]
impl Target {
    pub fn ping(env: Env, who: Address, n: u32) -> u32 {
        who.require_auth_for_args((n,).into_val(&env));
        let count = Self::count(env.clone(), who.clone())
            .checked_add(n)
            .unwrap();
        env.storage().persistent().set(&who, &count);
        count
    }

    pub fn count(env: Env, who: Address) -> u32 {
        env.storage().persistent().get(&who).unwrap_or(0)
    }
}
