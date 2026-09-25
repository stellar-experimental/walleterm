#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation},
    IntoVal,
};

#[test]
fn ping_records_auth_and_counts() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AuthTarget, ());
    let client = AuthTargetClient::new(&env, &id);
    let who = Address::generate(&env);

    assert_eq!(client.ping(&who, &2), 2);
    assert_eq!(client.ping(&who, &3), 5);
    // env.auths() reports the last invocation only, so assert before any read.
    assert_eq!(
        env.auths(),
        std::vec![(
            who.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    id.clone(),
                    symbol_short!("ping"),
                    (who.clone(), 3u32).into_val(&env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
    assert_eq!(client.count(&who), 5);
}

#[test]
fn ping2_records_both_authorizers() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AuthTarget, ());
    let client = AuthTargetClient::new(&env, &id);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    assert_eq!(client.ping2(&a, &b, &1), 2);
    let auths = env.auths();
    assert_eq!(auths.len(), 2);
    assert_eq!(auths[0].0, a);
    assert_eq!(auths[1].0, b);
}

#[test]
fn outer_records_nested_tree() {
    let env = Env::default();
    env.mock_all_auths();
    let outer_id = env.register(AuthTarget, ());
    let inner_id = env.register(AuthTarget, ());
    let who = Address::generate(&env);

    assert_eq!(AuthTargetClient::new(&env, &outer_id).outer(&who, &inner_id, &4), 4);
    assert_eq!(
        env.auths(),
        std::vec![(
            who.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    outer_id.clone(),
                    symbol_short!("outer"),
                    (who.clone(), inner_id.clone(), 4u32).into_val(&env),
                )),
                sub_invocations: std::vec![AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        inner_id.clone(),
                        symbol_short!("ping"),
                        (who.clone(), 4u32).into_val(&env),
                    )),
                    sub_invocations: std::vec![],
                }],
            }
        )]
    );
    assert_eq!(AuthTargetClient::new(&env, &inner_id).count(&who), 4);
}

#[test]
#[should_panic(expected = "Auth, InvalidAction")]
fn ping_without_auth_panics() {
    let env = Env::default();
    let id = env.register(AuthTarget, ());
    AuthTargetClient::new(&env, &id).ping(&Address::generate(&env), &1);
}
