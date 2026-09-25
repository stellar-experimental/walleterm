#!/bin/bash
# Task 2: target.ping(account,1), payer A, OZ rule 0 auth by A+B. Builds and computes the
# auth digest. Does not sign.
source /tmp/walleterm-usability-snYwFv/lib.sh
mkdir -p t2
stellar contract invoke --id "$TGT" --source-account "$A" --build-only -- ping --who "$ACC" --n 1 > t2/built.xdr
stellar tx simulate --source-account "$A" t2/built.xdr > t2/sim-record.xdr
set_timebounds t2/sim-record.xdr t2/sim-record-tb.xdr "${TTL:-900}"
stellar tx decode < t2/sim-record-tb.xdr > t2/sim-record.json
# Exactly one op, one auth entry for ACC, root call target.ping(ACC,1), no sub-invocations.
jq -e --arg a "$A" --arg acc "$ACC" --arg t "$TGT" --argjson lim "$FEE_LIMIT" '.tx.tx as $x |
  $x.source_account==$a and ($x.fee|tonumber)<=$lim and ($x.operations|length)==1 and
  ($x.operations[0].body.invoke_host_function.auth|length)==1 and
  ($x.operations[0].body.invoke_host_function.auth[0] as $e |
    ($e.credentials|to_entries[0].value.address)==$acc and
    $e.root_invocation.function.contract_fn=={contract_address:$t,function_name:"ping",args:[{address:$acc},{u32:1}]} and
    ($e.root_invocation.sub_invocations|length)==0)' t2/sim-record.json >/dev/null
jq '.tx.tx.operations[0].body.invoke_host_function.auth[0]' t2/sim-record.json > t2/auth-entry-unsigned.json
VARIANT=$(jq -r '.credentials|keys[0]' t2/auth-entry-unsigned.json)
EXP=$(( $(latest_ledger) + ${EXP_LEDGERS:-150} ))
case "$VARIANT" in
  address) PRE='{soroban_authorization:{network_id:$n,nonce:.credentials.address.nonce,signature_expiration_ledger:$e,invocation:.root_invocation}}';;
  address_v2) PRE='{soroban_authorization_with_address:{network_id:$n,address:.credentials.address_v2.address,nonce:.credentials.address_v2.nonce,signature_expiration_ledger:$e,invocation:.root_invocation}}';;
  *) echo "unsupported credential variant $VARIANT" >&2; exit 2;;
esac
jq -c --arg n "$NETID" --argjson e "$EXP" "$PRE" t2/auth-entry-unsigned.json > t2/preimage.json
PAYLOAD=$(sha_xdr HashIdPreimage < t2/preimage.json)
IDS_HEX=$(echo '{"vec":[{"u32":0}]}' | stellar xdr encode --type ScVal | base64 -d | xxd -p | tr -d '\n')
[ "$IDS_HEX" = 0000001000000001000000010000000300000000 ]
AUTH_DIGEST=$( { printf '%s' "$PAYLOAD"; printf '%s' "$IDS_HEX"; } | xxd -r -p | shasum -a 256 | cut -d' ' -f1)
jq -n --arg v "$VARIANT" --argjson e "$EXP" --arg p "$PAYLOAD" --arg i "$IDS_HEX" --arg d "$AUTH_DIGEST" \
  '{variant:$v,expiration_ledger:$e,signature_payload:$p,context_rule_ids_xdr:$i,auth_digest:$d}' > t2/auth-digest.json
for k in A B; do jq -n --arg k "${!k}" --arg d "$AUTH_DIGEST" '{public_key:$k,digest:$d}' > t2/sign-auth-$k.json; done
jq -c '{task:2,source:.tx.tx.source_account,seq:.tx.tx.seq_num,fee:.tx.tx.fee,cond:.tx.tx.cond,call:.tx.tx.operations[0].body.invoke_host_function.host_function}' t2/sim-record.json
cat t2/auth-digest.json | jq -c .
