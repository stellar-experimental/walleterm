# Research commands

## Discovery

```text
stellar-raven-jev --help
stellar-raven-jev search --help
stellar-raven-jev doctor
parallel-cli --help
parallel-cli search --help
```

All commands completed.
Jev doctor reported a `$1` default budget and 45 configured sources.
It did not validate remote authentication.

## Jev

```text
stellar-raven-jev search --budget-usd 1 --limit 6 --bundle --full-record --output-dir audit/2026-09-26/research/06-contracts-daybreak "For Stellar protocol 28, which fields bind Soroban authorization signatures for AddressV2 and AddressWithDelegates, and what official guidance supports validating an RPC returned rootInvocation before requesting a signature? Use official Stellar sources and CAP specifications only."
```

Result: failed.
Three Jev transport failures cost `$0.008729397`.
The run had no rate limit.

## parallel-cli

```text
parallel-cli search --mode basic --max-results 8 --include-domains developers.stellar.org,github.com "Find official Stellar documentation or specifications for Soroban authorization preimages, AddressV2, AddressWithDelegates, rootInvocation, and safe client signing of simulation-produced authorization entries." --output audit/2026-09-26/research/06-contracts-daybreak/parallel-cli.json --json
```

Result: failed.
The command returned `APIConnectionError` after two internal retries.
It did not create the requested output file.

## MCP calls

Stellar Raven MCP searched official Stellar documentation first.
Parallel Search MCP ran one primary-source query.
Perplexity MCP ran one challenge query.

The compact outcomes are in this research directory.

