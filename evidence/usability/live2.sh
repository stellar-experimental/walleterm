#!/bin/bash
# Task 2 live: two auth signatures (A, B) and one envelope signature (A). Run only inside a
# parent-granted live window, after task 1 is final. Rebuilds with the current sequence.
source /tmp/walleterm-usability-snYwFv/lib.sh
./prep2.sh
AD=$(jq -r .auth_digest t2/auth-digest.json)
N0=$(stellar contract invoke --id "$TGT" --source-account "$A" --send=no -- count --who "$ACC" 2>/dev/null | tail -1)
echo "$N0" > t2/count-before.txt
for k in A B; do
  journal "{\"task\":2,\"step\":\"sign_auth_request\",\"key\":\"${!k}\",\"digest\":\"$AD\"}"
  walleterm sign < t2/sign-auth-$k.json > t2/sign-auth-$k-response.json || { echo "walleterm sign $k failed; no retry" >&2; cat t2/sign-auth-$k-response.json >&2; exit 4; }
  S=$(check_sig t2/sign-auth-$k-response.json "${!k}" "$AD")
  node verify.js "${!k}" "$AD" "$S" > t2/independent-verify-auth-$k.json
  eval "SIG_$k=$S"
done
./assemble2.sh "$SIG_A" "$SIG_B" t2/final
D=$(cat t2/final-envelope-digest.txt)
journal "{\"task\":2,\"step\":\"sign_envelope_request\",\"key\":\"$A\",\"digest\":\"$D\"}"
walleterm sign < t2/final-sign-envelope.json > t2/sign-envelope-response.json || { echo "walleterm envelope sign failed; no retry" >&2; cat t2/sign-envelope-response.json >&2; exit 4; }
SE=$(check_sig t2/sign-envelope-response.json "$A" "$D")
node verify.js "$A" "$D" "$SE" > t2/independent-verify-envelope.json
jq -c --arg h "$(hint "$A")" --arg s "$SE" '.tx.signatures=[{hint:$h,signature:$s}]' t2/final-enforced.json | stellar tx encode > t2/signed.xdr
[ "$(env_digest t2/signed.xdr)" = "$D" ]
journal "{\"task\":2,\"step\":\"pre_send\",\"original_hash\":\"$D\"}"
set +e
stellar tx send t2/signed.xdr > t2/send.out 2> t2/send.err; RC=$?
set -e
journal "{\"task\":2,\"step\":\"send_returned\",\"rc\":$RC}"
./reconcile.sh "$D" t2/result.json | tee t2/result-summary.json
ST=$(jq -r .result.status t2/result.json)
journal "{\"task\":2,\"step\":\"reconciled\",\"original_hash\":\"$D\",\"status\":\"$ST\"}"
[ "$ST" = SUCCESS ] || { echo "outcome not SUCCESS ($ST); stop" >&2; exit 5; }
RV=$(jq -r .result.returnValue t2/result.json | stellar xdr decode --type ScVal 2>/dev/null || true)
N1=$(stellar contract invoke --id "$TGT" --source-account "$A" --send=no -- count --who "$ACC" 2>/dev/null | tail -1)
FEE=$(jq -r .result.resultXdr t2/result.json | stellar xdr decode --type TransactionResult | jq -r .fee_charged)
jq -n --arg h "$D" --arg n0 "$N0" --arg n1 "$N1" --arg rv "$RV" --arg f "$FEE" --arg l "$(jq -r .result.ledger t2/result.json)" \
  '{hash:$h,ledger:($l|tonumber),fee_charged:($f|tonumber),count_before:($n0|tonumber),count_after:($n1|tonumber),return_value:$rv,counter_ok:(($n1|tonumber)==($n0|tonumber)+1)}' | tee t2/verify.json
