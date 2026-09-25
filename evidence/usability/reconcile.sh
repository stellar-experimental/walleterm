#!/bin/bash
# Query one original transaction hash. Never resubmits. $1 = hash, $2 = output file.
source /tmp/walleterm-usability-snYwFv/lib.sh
H=$1; OUT=$2
for i in $(seq 1 30); do
  curl -s -X POST "$STELLAR_RPC_URL" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":{\"hash\":\"$H\"}}" > "$OUT"
  S=$(jq -r '.result.status // "RPC_ERROR"' "$OUT")
  case "$S" in SUCCESS|FAILED) break;; esac
  sleep 2
done
jq -c --arg h "$H" '{hash:$h,status:.result.status,ledger:.result.ledger,latestLedger:.result.latestLedger}' "$OUT"
