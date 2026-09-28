# Soroban test snapshot semantics

Accessed: 2026-09-26

Primary source: https://developers.stellar.org/docs/build/guides/testing/differential-tests-with-test-snapshots

Stellar Raven MCP and the official page gave the same semantics.

- The Soroban Rust SDK enables test snapshots by default.
- Each test involving `Env` writes a JSON snapshot at test completion.
- A snapshot contains published events and the final ledger storage state.
- Multiple `Env` values can produce multiple numbered files.
- The official differential workflow commits the files and reviews later diffs.
- Generated files alone are not a committed project baseline.

Project evidence:

- Git tree `40d6cca9db732a0db16d154c80d4a153bf33c6b7` contains zero snapshot files.
- `audit/2026-09-26/manifest.json` contains zero snapshot files.
- `.gitignore:27` ignores `**/test_snapshots/`.
- Native coordinator tests generated 16 CAP-85 snapshot files in the frozen directory.
- `fixtures/cap85/build.sh:15` removes those ignored outputs after its native tests.

Conclusion:

The cleanup does not delete tracked source or a committed differential baseline.
The initial P2 classification was a false positive and is withdrawn.
