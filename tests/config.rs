//! `.env` parsing against Bun's `node:util.parseEnv`, and the vault setting through discovery.

use std::collections::BTreeMap;

use serde_json::Value;
use walleterm::config::parse_env;

#[test]
fn dotenv_parsing_matches_bun_for_every_frozen_case() {
    let path = std::env::var("WALLETERM_DOTENV_CORPUS")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/parity/dotenv.json").into());
    let corpus: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let mut failures = Vec::new();
    for case in corpus["cases"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let want: BTreeMap<String, String> = serde_json::from_value(case["env"].clone()).unwrap();
        let got: BTreeMap<String, String> = parse_env(text).into_iter().collect();
        if got != want {
            failures.push(format!("{text:?}\n  bun:  {want:?}\n  rust: {got:?}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} differences:\n{}",
        failures.len(),
        failures[..failures.len().min(15)].join("\n")
    );
}
