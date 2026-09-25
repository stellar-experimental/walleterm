#!/bin/bash
# Task 1: native payment A -> C, 100 stroops. Builds unsigned envelope and digest. Does not sign.
source /tmp/walleterm-usability-snYwFv/lib.sh
mkdir -p t1
stellar tx new payment --source-account "$A" --destination "$C" --amount 100 --inclusion-fee 100 --build-only > t1/built.xdr
set_timebounds t1/built.xdr t1/unsigned.xdr "${TTL:-900}"
stellar tx decode < t1/unsigned.xdr > t1/unsigned.json
jq -e --arg a "$A" --arg c "$C" --argjson lim "$FEE_LIMIT" '.tx.tx as $t |
  $t.source_account==$a and ($t.fee|tonumber)<=$lim and ($t.operations|length)==1 and
  $t.operations[0].source_account==null and $t.operations[0].body.payment.destination==$c and
  $t.operations[0].body.payment.asset=="native" and $t.operations[0].body.payment.amount=="100" and
  (.tx.signatures|length)==0' t1/unsigned.json >/dev/null
D=$(env_digest t1/unsigned.xdr)
echo "$D" > t1/digest.txt
jq -n --arg k "$A" --arg d "$D" '{public_key:$k,digest:$d}' > t1/sign-request.json
jq -c '{task:1,source:.tx.tx.source_account,seq:.tx.tx.seq_num,fee:.tx.tx.fee,cond:.tx.tx.cond,op:.tx.tx.operations[0].body}' t1/unsigned.json
echo "digest=$D key=$A"
