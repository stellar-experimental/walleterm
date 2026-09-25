#!/bin/bash
# Insert AuthPayload into the auth entry and enforce-simulate.
# $1 = sig A hex, $2 = sig B hex, $3 = output prefix (e.g. t2/final or t2/dryrun).
source /tmp/walleterm-usability-snYwFv/lib.sh
SA=$1; SB=$2; P=$3
VARIANT=$(jq -r .variant t2/auth-digest.json); EXP=$(jq -r .expiration_ledger t2/auth-digest.json)
RA=$(raw "$A"); RB=$(raw "$B")
jq -c --arg ver "$VER" --arg ra "$RA" --arg rb "$RB" --arg sa "$SA" --arg sb "$SB" -n '
  [{raw:$ra,sig:$sa},{raw:$rb,sig:$sb}] | sort_by(.raw) |
  {map:[{key:{symbol:"context_rule_ids"},val:{vec:[{u32:0}]}},
        {key:{symbol:"signers"},val:{map:[.[]|{key:{vec:[{symbol:"External"},{address:$ver},{bytes:.raw}]},val:{bytes:.sig}}]}}]}' > "$P-authpayload.json"
jq -c --arg v "$VARIANT" --argjson e "$EXP" --slurpfile s "$P-authpayload.json" \
  '.tx.tx.operations[0].body.invoke_host_function.auth[0].credentials[$v].signature_expiration_ledger=$e |
   .tx.tx.operations[0].body.invoke_host_function.auth[0].credentials[$v].signature=$s[0]' t2/sim-record.json > "$P-withauth.json"
stellar tx encode < "$P-withauth.json" > "$P-withauth.xdr"
set +e
stellar tx simulate --source-account "$A" --auth-mode enforce "$P-withauth.xdr" > "$P-enforced.xdr" 2> "$P-enforce.err"; RC=$?
set -e
echo "enforce_rc=$RC"
[ $RC = 0 ] || { tail -20 "$P-enforce.err"; exit 6; }
stellar tx decode < "$P-enforced.xdr" > "$P-enforced.json"
# The auth entry, call, source, sequence, and time bounds must survive simulation unchanged.
jq -e --slurpfile w "$P-withauth.json" --argjson lim "$FEE_LIMIT" '.tx.tx as $x | $w[0].tx.tx as $y |
  $x.operations[0].body.invoke_host_function==$y.operations[0].body.invoke_host_function and
  $x.source_account==$y.source_account and $x.seq_num==$y.seq_num and $x.cond==$y.cond and
  ($x.fee|tonumber)<=$lim and (.tx.signatures|length)==0' "$P-enforced.json" >/dev/null
D=$(env_digest "$P-enforced.xdr"); echo "$D" > "$P-envelope-digest.txt"
jq -n --arg k "$A" --arg d "$D" '{public_key:$k,digest:$d}' > "$P-sign-envelope.json"
jq -c '{fee:.tx.tx.fee,resource_fee:.tx.tx.ext.v1.resource_fee,instructions:.tx.tx.ext.v1.resources.instructions}' "$P-enforced.json"
echo "envelope_digest=$D"
