# Shared helpers. Source from the temp folder. No private keys are read here.
set -euo pipefail
W=/tmp/walleterm-usability-snYwFv
cd "$W"
export STELLAR_RPC_URL=https://soroban-testnet.stellar.org
export STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
A=$(jq -r .a inputs.json); B=$(jq -r .b inputs.json); C=$(jq -r .c inputs.json)
ACC=$(jq -r .account inputs.json); VER=$(jq -r .verifier inputs.json); TGT=$(jq -r .target inputs.json)
NETID=$(printf '%s' "$STELLAR_NETWORK_PASSPHRASE" | shasum -a 256 | cut -d' ' -f1)
FEE_LIMIT=10000000
JOURNAL=$W/journal.jsonl

raw() { stellar strkey decode "$1" | jq -r .public_key_ed25519; }
hint() { raw "$1" | cut -c57-64; }
sha_xdr() { stellar xdr encode --type "$1" | base64 -d | shasum -a 256 | cut -d' ' -f1; }
latest_ledger() { curl -s -X POST "$STELLAR_RPC_URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | jq -r .result.sequence; }
journal() { jq -cn --arg ts "$(date -u +%FT%TZ)" --argjson e "$1" '$e + {ts:$ts}' >> "$JOURNAL"; }

# Envelope digest two ways: CLI tx hash, and SHA-256(XDR(TransactionSignaturePayload)).
env_digest() { # $1 = envelope xdr file
  local h1 h2
  h1=$(stellar tx hash "$1")
  h2=$(stellar tx decode < "$1" | jq -c --arg n "$NETID" '{network_id:$n,tagged_transaction:{tx:.tx.tx}}' | sha_xdr TransactionSignaturePayload)
  [ "$h1" = "$h2" ] || { echo "digest mismatch $h1 $h2" >&2; return 1; }
  echo "$h1"
}

# Set time bounds on a V1 envelope: $1 in, $2 out, $3 seconds from now.
set_timebounds() {
  local max=$(( $(date +%s) + $3 ))
  stellar tx decode < "$1" | jq -c --argjson m "$max" '.tx.tx.cond={time:{min_time:0,max_time:$m}}' | stellar tx encode > "$2"
}

# Check one walleterm response file: $1 file, $2 key, $3 digest. Prints signature.
check_sig() {
  jq -e --arg k "$2" --arg d "$3" '.ok==true and .verified==true and .public_key==$k and .digest==$d and (.signature|test("^[0-9a-f]{128}$"))' "$1" >/dev/null \
    || { echo "bad walleterm response $1" >&2; return 1; }
  jq -r .signature "$1"
}
