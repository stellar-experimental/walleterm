#!/bin/bash
# Task 1 live: one walleterm signature, journal hash, send, reconcile, verify balances.
# Run only inside a parent-granted live window.
source /tmp/walleterm-usability-snYwFv/lib.sh
./prep1.sh
D=$(cat t1/digest.txt)
# Recheck the fixed artifact before signing.
[ "$(env_digest t1/unsigned.xdr)" = "$D" ]
SEQ=$(jq -r .tx.tx.seq_num t1/unsigned.json); MAXT=$(jq -r .tx.tx.cond.time.max_time t1/unsigned.json)
CUR=$(curl -s "https://horizon-testnet.stellar.org/accounts/$A" | jq -r .sequence)
[ "$SEQ" = "$((CUR + 1))" ] || { echo "stale sequence: have $SEQ, account $CUR" >&2; exit 3; }
[ "$MAXT" -gt $(( $(date +%s) + 60 )) ] || { echo "time bound too close" >&2; exit 3; }
for k in A C; do curl -s "https://horizon-testnet.stellar.org/accounts/${!k}" | jq -r '.balances[]|select(.asset_type=="native").balance' > t1/bal-$k-before.txt; done

journal "{\"task\":1,\"step\":\"sign_request\",\"key\":\"$A\",\"digest\":\"$D\"}"
walleterm sign < t1/sign-request.json > t1/sign-response.json || { echo "walleterm sign failed; no retry" >&2; cat t1/sign-response.json >&2; exit 4; }
SIG=$(check_sig t1/sign-response.json "$A" "$D")
node verify.js "$A" "$D" "$SIG" > t1/independent-verify.json
H=$(hint "$A")
jq -c --arg h "$H" --arg s "$SIG" '.tx.signatures=[{hint:$h,signature:$s}]' t1/unsigned.json | stellar tx encode > t1/signed.xdr
[ "$(env_digest t1/signed.xdr)" = "$D" ]
# For a V1 envelope the transaction hash equals the signature digest.
journal "{\"task\":1,\"step\":\"pre_send\",\"original_hash\":\"$D\"}"
set +e
stellar tx send t1/signed.xdr > t1/send.out 2> t1/send.err; RC=$?
set -e
journal "{\"task\":1,\"step\":\"send_returned\",\"rc\":$RC}"
./reconcile.sh "$D" t1/result.json | tee t1/result-summary.json
ST=$(jq -r .result.status t1/result.json)
journal "{\"task\":1,\"step\":\"reconciled\",\"original_hash\":\"$D\",\"status\":\"$ST\"}"
[ "$ST" = SUCCESS ] || { echo "outcome not SUCCESS ($ST); stop" >&2; exit 5; }
sleep 5; for k in A C; do curl -s "https://horizon-testnet.stellar.org/accounts/${!k}" | jq -r '.balances[]|select(.asset_type=="native").balance' > t1/bal-$k-after.txt; done
FEE=$(curl -s "https://horizon-testnet.stellar.org/transactions/$D" | jq -r .fee_charged)
jq -n --arg ab "$(cat t1/bal-A-before.txt)" --arg aa "$(cat t1/bal-A-after.txt)" --arg cb "$(cat t1/bal-C-before.txt)" --arg ca "$(cat t1/bal-C-after.txt)" --arg f "$FEE" --arg h "$D" \
 'def s: (.|tonumber*10000000|round); {hash:$h,fee_charged:($f|tonumber),a_delta_stroops:(($aa|s)-($ab|s)),c_delta_stroops:(($ca|s)-($cb|s))}' | tee t1/verify.json
