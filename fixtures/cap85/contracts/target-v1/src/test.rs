#![cfg(test)]
use super::*;
use soroban_sdk::testutils::Address as _;

#[test]
fn version_and_ping_multiplier() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let client = TargetClient::new(&env, &env.register(Target, (admin,)));
    let who = Address::generate(&env);
    assert_eq!(client.version(), 1);
    assert_eq!(client.ping(&who, &1), 1);
    assert_eq!(client.ping(&who, &2), 3 * 1);
    assert_eq!(client.count(&who), 3 * 1);
}
