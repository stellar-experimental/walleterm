//! Authorization target for acceptance tests.
//!
//! `ping` needs one authorizer. `ping2` needs two authorizers in one
//! invocation. `outer` needs one authorizer for a two-level invocation
//! tree: `outer(who, inner, n)` calls `inner.ping(who, n)`.
//! Each call adds `n` to a per-address counter so a state change is visible.
//! Test matrix rows: C01, C06, C07, C08, C09, C10, C11.
#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

const DAY_IN_LEDGERS: u32 = 17280;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Count(Address),
}

#[contract]
pub struct AuthTarget;

fn bump(env: &Env, who: &Address, n: u32) -> u32 {
    let key = DataKey::Count(who.clone());
    let count: u32 = env.storage().persistent().get(&key).unwrap_or(0) + n;
    env.storage().persistent().set(&key, &count);
    env.storage().persistent().extend_ttl(&key, DAY_IN_LEDGERS, 30 * DAY_IN_LEDGERS);
    count
}

#[contractimpl]
impl AuthTarget {
    /// `who` must authorize. Returns the new counter of `who`.
    pub fn ping(env: Env, who: Address, n: u32) -> u32 {
        who.require_auth();
        bump(&env, &who, n)
    }

    /// `a` and `b` must both authorize. Returns the sum of both new counters.
    pub fn ping2(env: Env, a: Address, b: Address, n: u32) -> u32 {
        a.require_auth();
        b.require_auth();
        bump(&env, &a, n) + bump(&env, &b, n)
    }

    /// `who` must authorize this call and the nested `inner.ping(who, n)`.
    pub fn outer(env: Env, who: Address, inner: Address, n: u32) -> u32 {
        who.require_auth();
        AuthTargetClient::new(&env, &inner).ping(&who, &n)
    }

    pub fn count(env: Env, who: Address) -> u32 {
        env.storage().persistent().get(&DataKey::Count(who)).unwrap_or(0)
    }
}

mod test;
