# Evidence for: How do Stellar classic transaction time bounds and sequence numbers limit replay after a signed transaction leaves a wallet?

Contents (section: first line):
- Rank 1: Operations & Transactions: How Blockchain Actions Are Executed: line 15
- Rank 2: History Transactions: line 113
- Rank 3: Verifying the Starbridge Protocol with Ivy: line 138
- Rank 4: Error Handling: line 161
- Rank 5: Millisecond-Resolution Close Times: line 232
- Rank 6: Preserve Transaction-Set/Close-Time Affinity During Nomination: line 274
- Rank 7: Concurrent Transactions: line 366
- Rank 8: The Transaction Object: line 436
- Rank 9: Lightning on Stellar: Technical Spec and Roadmap: line 574
- Rank 10: Preconditions: Generalized transaction preconditions: line 613

## Rank 1: Operations & Transactions: How Blockchain Actions Are Executed
url: https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions | scope: research_chunk | date: 2026-06-17 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-astra/jev/1790470813-fa45d9fb-bb7c-4ad1-863d-cdfa7ebeeab3/search-documents/0050.txt

## Transaction and operation validity​

Before being successfully submitted to the Stellar network, transactions go through several validity checks. These checks are grouped into three categories:

### Preconditions (optional)​

Preconditions are checked first.

All preconditions are optional. Time bounds are encouraged, but the other preconditions are used in more specialized circumstances. You can set multiple preconditions as long as the combination is logically sound.

Time bounds​
Valid if within set time bounds of the transaction

Time bounds are an optional UNIX timestamp (in seconds), determined by ledger time, of a lower and upper bound of when a transaction will be valid. If a transaction is submitted too early or too late, it will fail to make it into the transaction set.

Setting time bounds on transactions is highly encouraged, and many SDKs enforce them.

If maxTime is 0, upper time bounds are not set. In this case, if a transaction does not make it to the transaction set, it is kept in memory and continuously tries to make it to the next transaction set. Because of this, we advise that all transactions are created with time bounds to invalidate transactions after a certain amount of time, especially if you plan to resubmit your transaction at a later time.

Ledger bounds​
Valid if within the set ledger bounds of the transaction

Ledger bounds apply to ledger numbers. With these defined, a transaction will only be valid for ledger numbers that fall within the determined range.

The lower bound is inclusive (less than or equal to) while the upper bound is not (just greater than).

If the upper bound is set to 0, this indicates there is no upper bound.

Minimum sequence number​
If a minimum sequence number is set, the transaction will only be valid when its source account’s sequence number (call it S) is large enough. Specifically, it’s valid when S satisfies minSeqNum <= S < tx.seqNum.

If this precondition is omitted, the default behavior applies: the transaction’s sequence number must be exactly one greater than the account’s sequence number.

Note that after a transaction is executed, the account will always set its sequence number to the transaction’s sequence number.

Minimum sequence age​
Transaction is valid after a particular duration (expressed in seconds) elapses since the account’s sequence number age.

Minimum sequence age is a precondition relating to time, but unlike time bounds, which express absolute times, minimum sequence age is relative to when the transaction source account’s sequence number was touched.

Minimum sequence ledger gap​
Valid if submitted in a ledger meeting or exceeding the source account’s sequence number age

This is similar to the minimum sequence age, except it is expressed as a number of ledgers rather than a duration of time.

Extra signers​
Valid if submitted with signatures that fulfill each of the extra signers

A transaction can specify up to two extra signers as a precondition, meaning it must have signatures that correspond to those extra signers, even if those signatures would not otherwise be required to authorize the transaction (i.e., for its sources account or operations).

The additional signers can be of any type besides the pre-authorized transaction signer since to pre-authorize a transaction, you need to know its hash, but be hash must include the extra signers. This Catch-22 relationship means including this type of extra signer will return an error.

### Operation validity​

When a transaction is submitted to a node, the node checks the validity of each operation in the transaction before attempting to include it in a candidate transaction set. These initial operation validity checks are intended to be fast and simple, with more intensive checks coming after the fees have been consumed. For an operation to pass this validity check, it has to meet the following conditions:

The signatures on the transaction must be valid for the operation​
The signatures are from valid signers for the source account of the operation. The combined weight of all signatures for the source account of the operation meets the threshold for the operation.

The operation must be well-formed​
Typically this means checking the parameters for the operation to see if they’re in a valid format. For example, only positive values can be set for the amount of a payment operation.

The operation must be valid in the current protocol version of the network​
Deprecated operations, such as inflation, are invalid by design.

### Transaction validity​

Finally, the following transaction checks take place:

Source account​
The source account must exist on the ledger.

Fee​
The fee must be greater than or equal to the network minimum fee for the number of operations submitted as part of the transaction. This does not guarantee that the transaction will be applied, only that it is valid. In addition, the source account must be able to pay the fee specified.

Fee-bump (if applicable)​
See Validity of a Fee-Bump Transaction Guide for more information.

Sequence number​
The sequence number must be one greater than the sequence number stored in the source account entry when the transaction is applied unless sequence number preconditions are set. An account can only have one transaction (and, therefore, one sequence number) consumed per ledger.

List of operations​
Each operation must pass all the validity checks for an operation, described in the Operation Validity section above.

List of signatures​

- Meet signature requirements for each operation in the transaction

- Appropriate network passphrase is part of the transaction hash signed by each signer

- Combined weight of the signatures for the source account of the transaction meets the low threshold for the source account.

Memo (if applicable)​
The memo type must be a valid type, and the memo itself must adhere to the formatting of the memo type.

## Rank 2: History Transactions
url: https://developers.stellar.org/docs/data/analytics/hubble/data-catalog/data-dictionary/bronze/history-transactions | scope: research_chunk | date: 2026-09-08 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-astra/jev/1790470813-fa45d9fb-bb7c-4ad1-863d-cdfa7ebeeab3/search-documents/0108.txt

## Column Details​

YesDefaults to MemoTypeMemoNonememoAn optional freeform field that attaches a memo to a transactionstringNoMemos are heavily used by centralized exchanges to help with account management.time_boundsA transaction precondition that can be set to determine when a transaction is valid. The user can set a lower and upper timebound, defined as a UNIX timestamp when the transaction can be executed. If the transaction attempts to execute outside of the time range, the transaction will failstringNosuccessfulIndicates if this transaction was successful or notbooleanNoA transaction&#x27;s success does not indicate whether it was included and written to a ledger. It only indicates whether the operations in the transaction were successfully applied to mutate the ledger state.fee_chargedThe fee (in stroops) paid by the source account to apply this transaction to the ledger. At minimum, a transaction is charged # of operations * base fee. The minimum base fee is 100 stroopsintegerNoThe stroop is the fractional representation of a lumen (XLM). 1 stroop is 0.0000001 XLM.inner_transaction_hashA transaction hash of a transaction wrapped with its signatures for fee-bump transactionsstringNofee_accountAn account that is not the originating source account for a transaction is allowed to pay transaction fees on behalf of the source account. These accounts are called fee accounts and incur all transaction costs for the source account.stringNonew_max_feeIf an account has a fee account, the fee account can specify a maximum fee (in stroops) that it is willing to pay for this account&#x27;s fees. When the network is in surge pricing, the validators will consider the new_max_fee instead of the max_fee when determining if the transaction will be included in the transaction setintegerNoaccount_muxedIf the user has defined multiplexed (muxed) accounts, the account exists "virtually" under a traditional Stellar account address. This address distinguishes between the virtual accountsstringNofee_account_muxedIf the fee account that sponsors fee is a multiplexed account, the virtual address will be listed herestringNoledger_boundsA transaction precondition that can be set to determine valid conditions for a transaction to be submitted to the network. Ledger bounds allow the user to specify a minimum and maxiumum ledger sequence number in which the transaction can successfully executestringNomin_account_sequenceA transaction precondition that can be set to determine valid conditions for a transaction to be submitted to the network. This condition contains an integer representation of the lowest source account sequence number for which the transaction is validintegerNomin_account_sequence_ageA transaction precondition that can be set to determine valid conditions for a transaction to be submitted to the network. This condition contains a minimum duration of time that must have passed since the source account&#x27;s sequence number changed for the transaction to be validintegerNomin_account_sequence_ledger_gapA transaction precondition that can be set to determine valid conditions for a transaction to be submitted to the network. This condition contains an integer representation of the minimum number of ledgers that must have closed since the source account&#x27;s sequence number change for the transaction to be validintegerNoextra_signersAn array of up to two additional signers that must have corresponding signatures for this transaction to be validarray[string]Notx_envelopebase-64 encoded XDR blobstringNotx_resultbase-64 encoded XDR blobstringNotx_metabase-64 encoded XDR blobstringNotx_fee_metabase-64 encoded XDR blobstringNobatch_idString representation of the run id for a given DAG in Airflow. Takes the form of "scheduled__[batch_end_date]-[dag_alias]". Batch ids are unique to the batch and help with monitoring and rerun capabilitiesstringYesbatch_run_dateThe start date for the batch interval. When taken with the date in the batch_id, the date represents the interval of ledgers processed. The batch run date can be seen as a proxy of closed_at for a ledger.datetimeYesThe table is partitioned on batch_run_date. It is recommended to always include the batch_run_date in the filter if possible to help reduce query cost.batch_insert_tsThe timestamp in UTC when a batch of records was inserted into the database. This field can help identify if a batch executed in real time or as part of a backfilltimestampYesresource_feeThe fee charged less the inclusion fee for the Soroban transaction. This is calculated by the read/write operations and how process intensive the Soroban transaction isintegerNosoroban_resources_instructionsNumber of CPU instructions the Soroban transaction usesintegerNosoroban_resources_read_bytesNumber of bytes read by the Soroban transactionintegerNosoroban_resources_write_bytesNumber of bytes written by the Soroban transactionintegerNoclosed_atTimestamp in UTC when this ledger closed and committed to the network. Ledgers are expected to close ~every 5 secondstimestampYesWe aim to repartition the table by closed_attransaction_result_codeThe detailed result code that outlines why a transaction failed. This code is only useful for failed transactions. The full list of domain values can be found herestring
- TransactionResultCodeTxFeeBumpInnerSuccess
- TransactionResultCodeTxSuccess
- TransactionResultCodeTxFailed
- TransactionResultCodeTxTooEarly
- TransactionResultCodeTxTooLate
- TransactionResultCodeTxMissingOperation
- TransactionResultCodeTxBadSeq
- TransactionResultCodeTxBadAuth
- TransactionResultCodeTxInsufficientBalance
- TransactionResultCodeTxNoAccount
- TransactionResultCodeTxInsufficientFee
- TransactionResultCodeTxBadAuthExtra
- TransactionResultCodeTxInternalError
- TransactionResultCodeTxNotSupported
- TransactionResultCodeTxFeeBumpInnerFailed
- TransactionResultCodeTxBadSponsorship
- TransactionResultCodeTxBadMinSeqAgeOrGap
- TransactionResultCodeTxMalformed

## Rank 3: Verifying the Starbridge Protocol with Ivy
url: https://stellar.org/blog/developers/verifying-the-starbridge-protocol-with-ivy | scope: research_chunk | date: 2022-11-01 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-astra/jev/1790470813-fa45d9fb-bb7c-4ad1-863d-cdfa7ebeeab3/search-documents/0028.txt

## Re-issuing withdrawal transaction and allowing refunds

Consider a user depositing 1 ETH in the Starbridge smart contract on Ethereum at time t0 (as given by the timestamp of the Ethereum block in which the user&#x27;s deposit is executed). Bridge validators consider a withdrawal request valid between time t0 and t0+Δ, called the withdrawal period, where Δ is a configurable parameter that is agreed upon by all the bridge validators.

During the withdrawal period, the user can contact the bridge validators and request a pre-signed transaction depositing 1 wETH into their account on Stellar. Importantly, this pre-signed transaction must deposit the correct amount of wETH tokens in the user&#x27;s account (here, 1 wETH), it must have a max-time t<t0+Δ, and it must have a sequence number equal to s+1, where s is the most recent sequence number of the user&#x27;s account according to the Starbridge validators. (Note that, because of network delay, we cannot guarantee that the Starbridge validators will know about the most recent ledger externalized on Stellar; as we will see below, this does compromise the security of Starbridge.)

As we explained before, the pre-signed transaction returned by the Starbridge validators might fail once submitted to Stellar. This is not a problem, because the user can request a new pre-signed transaction as many times as they want. However, the same constraints as above apply to the transaction&#x27;s max-time and sequence number.

For example, if the first pre-signed transaction has sequence number 2 (which would be okay if the user’s account has sequence number 1), but, by the time the user submits it to Stellar, their account’s sequence number increases to 2 and the transaction fails, the user can request a new pre-signed transaction with sequence number 3. Assuming that the Starbridge validators received the last externalized ledger (in which the user&#x27;s account has sequence number 2), they will pre-sign the transaction with sequence number 3, which the user can submit to Stellar to obtain their 1 wETH. This example scenario is depicted below.

‍

After the withdrawal period has ended (i.e. when a Stellar ledger with close time tc>t0+Δ is externalized), all pre-signed transactions requested by the user become invalid because their max-time is equal to t0+Δ. At this point, Starbridge validators start granting refund requests to the user by returning, at the user&#x27;s request, a signed message attesting that they agree to the refund. The user can then call the bridge smart contract on Ethereum, providing the signed refund requests as proof that the refund is legitimate. The smart-contract checks the signatures and, if they are valid, deposits 1 ETH back into the user&#x27;s account. Crucially, the bridge validators only sign a refund request if the last externalized ledger they know of has a close time greater than the end of the withdrawal period and no corresponding withdrawal was executed by the user in any past ledger.

There are a few interesting things to note about this process:

- The Starbridge validators don’t need to synchronize between each other (they only need to agree on Δ): they process user requests independently of each other.
- The Starbridge validators must ingest Stellar ledgers and Ethereum blocks, but they might, temporarily, not know about the latest ledger closed by Stellar or the latest block produced by Ethereum. This might cause user requests and withdrawals to temporarily fail, but it will not compromise the safety of the bridge.
- The Starbridge validators can even crash and restart from a blank state (for example, because their hard drive failed and was replaced), and immediately start processing new withdrawal requests without having to worry about what they signed before crashing. In other words, the bridge validators are almost stateless, needing only to remember their keys; the rest can always be reconstructed from the chain state of Stellar and Ethereum.

## Rank 4: Error Handling
url: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling | scope: research_chunk | date: 2025-12-19 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-astra/jev/1790470813-fa45d9fb-bb7c-4ad1-863d-cdfa7ebeeab3/search-documents/0020.txt

## Error Handling for Transaction Submissions​

cautionDo note that resubmitting a transaction is only safe when it is unchanged - same operations, signatures, sequence number, etc... Be careful when working around an error that does require changes to the transaction. It can cause duplicate transactions, which can cause problems - double payments, incorrect trustlines, and more. If you continue to face timeouts on retries, consider using a fee-bump transaction to get into the ledger (after the initial transaction&#x27;s timebound expires) or increasing the maximum fee you’re willing to pay. Read up on Surge Pricing and Fee Strategies for more details.

### Example: Using Time Bounds​

Timebounds are optional but highly recommended as they put a definitive time limit on the transaction&#x27;s finality - after it times out, you will know for sure whether it made it into a ledger. For example, you submit a transaction, and it enters the queue of the Stellar network, but Horizon crashes while giving you a response. Uncertain about the transaction status, you resubmit the transaction (with no changes!) until either (a) Horizon comes back up to give you a reply or (b) your time bounds are exceeded.

There are only two possible results to this scenario: either the transaction makes it into the ledger (exactly once) and Horizon gives you the response, or the transaction never makes it out of the queue, and you receive the corresponding tx_too_late response.

Example implementation:

- JavaScript

import { Horizon } from "@stellar/stellar-sdk";

let server = Horizon.Server("https://horizon-testnet.stellar.org");

function submitTransaction(tx, timeout) {
 if (!tx.timeBounds || tx.timeBounds.maxTime === 0) {
 throw new Error("Always set a reasonable timebound!");
 }
 const expiration = parseInt(tx.timeBounds.maxTime);

 return server.submitTransaction(tx).catch(function (error) {
 if (isNonRetryErrorCase(error)) {
 // ...do other error handling...
 return;
 }

 // the tx no longer has a chance of making it into a ledger
 if (Date.now() >= expiration) {
 return new Error("The transaction timed out.");
 }

 timeout = timeout || 1; // start the (linear) back-off process
 return sleep(timeout).then(function () {
 return submitTransaction(tx, timeout + 5);
 });
 });
}

We assume the existence of a sleep implementation similar to the one here. Be sure to integrate backoff into your retry mechanism. In our example error-handling code above, we implement a simple linear backoff, but there are plenty of recommendations for various other strategies. Backoff is important both for maintaining performance and avoiding rate-limiting issues.

### Example: Invalid Sequence Numbers​

These errors typically occur when you have an outdated view of an account. This could be because multiple devices are using this account, you have concurrent submissions happening, or other reasons. The solution is relatively simple: retrieve the account details and try again with an updated sequence number.

- JavaScript

// suppose `account` is an outdated `AccountResponse` object
let tx = sdk.TransactionBuilder(account, ...)/* etc */.build();
server.submitTransaction(tx).catch(function (error) {
 if (error.response && error.status == 400 && error.extras &&
 error.extras.result_codes.transaction == sdk.TX_BAD_SEQ) {
 return server.loadAccount(account.accountId())
 .then(function (response) {
 let tx = sdk.TransactionBuilder(response, ...)/* etc */.build()
 return server.submitTransaction(tx);
 });
 }
 // ...other error conditions...
})

Despite the solution’s simplicity, things can go wrong fast if you don’t understand why the error occurred.

Suppose you submit transactions from multiple places in your application simultaneously, and your user spammed a Send Payment button a few times in their impatience. If you send the exact same payment transaction for each tap, naturally, only one will succeed. The others will fail with an invalid sequence number (tx_bad_seq), and if you resubmit blindly with an updated sequence number (as we do above), these payments will also succeed, resulting in more than one payment being made when only one was intended. So be very careful when resubmitting transactions that have been modified to work around an error.

## Rank 5: Millisecond-Resolution Close Times
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0088.md | scope: research_chunk | date: 2026-08-21 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-astra/jev/1790470813-fa45d9fb-bb7c-4ad1-863d-cdfa7ebeeab3/search-documents/0252.txt

## Specification

* **Transaction time bounds** (`TimeBounds.minTime`/`maxTime` in
  `PRECOND_TIME` and `PRECOND_V2`): compared against the whole-second
  `closeTime`, as today. The same rules apply at the transaction queue and
  consensus level as at apply time. Note that a transaction whose `maxTime`
  equals the current whole second remains valid for every ledger that closes
  within that second.
* **`minSeqAge` and `seqTime`** (CAP-0021): `AccountEntryExtensionV3.seqTime`
  continues to be recorded as the whole-second `closeTime` of the ledger in
  which the sequence number was consumed, and the age comparison remains in
  whole seconds.
* **`ledgerBounds` and `minSeqLedgerGap`** (CAP-0021): based on ledger
  sequence numbers, not time; unaffected.
* **Claimable balance claim predicates**
  (`CLAIM_PREDICATE_BEFORE_ABSOLUTE_TIME` and
  `CLAIM_PREDICATE_BEFORE_RELATIVE_TIME`): evaluated against (and, for
  relative predicates, anchored to) the whole-second `closeTime`, as today.
* **Soroban ledger timestamp** (the `ledger_timestamp` host function): returns
  the whole-second `closeTime` as a `Timepoint`. Consecutive ledgers may now
  observe the same timestamp. This is the only time input to the Soroban host;
  the `Timepoint` and `Duration` value types themselves are unit-agnostic
  wrappers and are unaffected.
* **Network upgrade scheduling**: validator-configured upgrade times remain
  whole-second values and are compared against the whole-second `closeTime`.

**Warning:** these rules are intended as a sound, minimal baseline for
non whole-second ledger intervals (e.g. 4.5 seconds) that also remains
well defined for hypothetical sub-second intervals. They are not intended to
be the final word on sub-second ledgers. If the network's target close time
ever drops below one second, the whole-second resolution of transaction time
bounds, `minSeqAge`, claim predicates, and `ledger_timestamp` becomes coarser
than the ledger interval itself, and these interfaces should be re-evaluated
at that point (e.g. by introducing millisecond-resolution preconditions).
Independently of this CAP, any change to the ledger interval may also break
downstream assumptions that one ledger corresponds to a fixed duration (e.g.
that a `minSeqAge` or time-bound window of `N` seconds spans roughly `N / 5`
ledgers).

## Rank 6: Preserve Transaction-Set/Close-Time Affinity During Nomination
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0034.md | scope: research_chunk | date: 2020-07-06 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-astra/jev/1790470813-fa45d9fb-bb7c-4ad1-863d-cdfa7ebeeab3/search-documents/0107.txt

## Design Rationale

2. The ledger happens first to have capacity to accept `T1` into a transaction
set between `T1`'s expiration time and the time at which it will turn out (of
course the network can not foresee that this will eventually be the case) that
the next ledger will close.

3. `T1` happens at that point to be in the transaction queue of the validator
who (though again this is not predictable yet) will turn out to nominate the
`StellarValue` that will ultimately be externalized. That node builds a
transaction set that contains `T1`.

4. The transaction set containing `T1` is externalized, but (at least) one of
the candidate `closeTime`s is greater than `T1`'s expiration time.

5. Transactions are applied using the maximum of all candidate `closeTime`s as
the new last ledger close time.  `T1` therefore returns `txTOO_LATE`, and its
operations are not applied.  However, as it reached ledger close before being
failed, it consumes a sequence number (and is charged a fee).

6. `T2` gets into an externalized transaction set (possibly, but not
necessarily, the same one that `T1` got into) before it too expires.  It
has the correct sequence number, because `T1` consumed a sequence number.
`T2`'s operations are therefore applied -- even though its preconditions were
intended to include guarantees that `T1`'s operations had ensured, so the
actual postconditions of `T2` could violate any of the smart contract's intended
invariants which had depended upon `T1`'s operations having succeeded before
`T2`'s operations could be applied.

So `T` consumes a sequence number (and is charged a fee) but is never applied.
There is a design pattern in some smart contracts which breaks, allowing
inconsistent transactions to be committed, if it encounters this race:  a smart
contract might submit a chain of transactions, with incrementing sequence
numbers, each intended to be applied only if the previous ones succeeded.  If
there were transactions that were intended to be constrained by the incrementing
sequence numbers only to be applied if `T` succeeded, they could do so because
`T` had consumed its sequence number, even though it was never applied. The
dependent transactions would then perform operations which the smart contract
had intended to be performed only if `T` had succeeded. This would
potentially be arbitrarily bad for the smart contract.

With the behavior proposed in this CAP, step #3 -- a node building a transaction
set containing `T1` -- would only occur if `T1` were not expired with respect to
the `closeTime` in the same proposed `StellarValue` as that transaction set.
Otherwise, `T1` would not make it into a transaction set, and would therefore
never consume a sequence number (or be charged a fee), and `T2` would fail
validation with a bad sequence number, as the smart contract intended in that
case.  If `T1` did make it into a transaction set, then, under the new behavior
in this CAP, step #5 would change -- if the transaction set containing `T1` won
nomination, then the `closeTime` of the new ledger would be the `closeTime` from
the same `StellarValue` as `T1`, with respect to which `T1` is in this case not
expired.  Hence, `T1` would be applied during ledger close; it would not return
`txTOO_LATE`.  `T2` would therefore have the opportunity to be applied (assuming
it was valid in the other respects in addition to its sequence number), and in
this case that would be as expected, as `T1` had previously succeeded.

Note that the duration that this race window in the current protocol remains
open can be lengthened (up to one minute) by the increase of any _one_ candidate
`closeTime`, since the current protocol combines candidate `closeTime`s by
choosing the maximum.  That means in particular that a single bad _validator_
can open this race window significantly, with the consequences including both
the failure of more transactions with `txTOO_LATE` and the potential for
inconsistent smart contract behavior.  This reflects that the current
protocol's choice of the maximum candidate `closeTime` is, in a sense, too
sensitive:  it can externalize a value that could have been manipulated by a
single bad actor.  We refer to such manipulation as "maximum `closeTime`
injection". The proposal in this CAP is less sensitive: a node can affect the
composite `closeTime` only if it manages to provide a transaction set that the
network as a whole selects as a composited one for the ballot protocol.  We
force a node to do a "good deed" (putting together a transaction set which the
compositing function selects over any other node's candidate) for the network's
clients in order to influence the eventual externalized `closeTime`. In the
presence of this CAP, one node's increasing the `closeTime` significantly no
longer triggers the smart-contract race because that is closed completely by
this CAP, and it no longer reduces the number of applicable transactions in a
ledger because the high `closeTime` provided by the bad actor does not affect
the validity of transactions in transaction sets proposed by other nodes.

### Detailed argument in favor of this proposal

Here we argue that this CAP would represent a clear improvement in behavior
by arguing individually for each of the semantic changes in the table above, in
the order presented (we shall use the "index" column for reference), so that the
desirability of the first change depends only on the state of the current
protocol and code, and the desirability of each further change may depend upon
that of earlier changes as well, in effect assuming that they have been made
because they are desirable (thus constructing an inductive argument for the
desirability of the whole CAP).

## Rank 7: Concurrent Transactions
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0041.md | scope: research_chunk | date: 2021-10-29 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-astra/jev/1790470813-fa45d9fb-bb7c-4ad1-863d-cdfa7ebeeab3/search-documents/0019.txt

## Design Rationale

Sequence numbers allow the protocol to guarantee that no replay of a transaction
is ever possible for an account, forever, without a validator needing to
remember all transactions that have been included in past ledgers. This reduces
the storage and lookup costs for a validator.

However, for the majority of transactions on the Stellar network sequence
numbers do not need to provide this guarantee forever. The majority of users of
the Stellar network build, sign, and submit transactions immediately with an
expectation of success or failure within a single ledger. Even though the
Stellar network provides a transaction queue which allow transactions to be
accepted in a near future ledger during congestion, most application developers
assume success or failure within a single ledger. We could argue from this
behavior by application developers that they do not signal a need for most
transactions to be valid for more than a single ledger.

These qualities of the majority of use cases submitting transactions to the
network indicate that the network does not need to prevent replay using sequence
numbers forever.

Validators can efficiently check that a transaction has not occurred in the last
ledger with limited storage or memory requirements since the data set is limited
to the transactions in a single ledger.

### Sequence Number Zero

The zero (`0`) sequence number is selected because it has no meaning within the
Stellar protocol since no transaction is valid with that value. The zero value
is also the default integer value and in the Stellar protocol the zero value is
routinely used as an indicator of no value being set, as is the case in
`TimeBounds`. The zero (`0`) sequence number does have meaning in [SEP-10] as a
method for creating a Stellar transaction that is guaranteed to be invalid on
any Stellar network, however that invariance of invalidity can be maintained by
[SEP-10] transactions never setting the `ledgerBounds` field of a transaction.

### Ledger Bounds

The `ledgerBounds` precondition proposed in [CAP-21] allows a user to define a
transaction that is valid only for a fixed range of ledgers. The precondition
allows a user to specify that a transaction is valid only for the next ledger,
and is more accurate at achieving this than `timeBounds`.

of ledgers. The precondition allows a user to specify that a transaction is
valid only for the next ledger, and is more accurate at achieving this than
`timeBounds`.

### Transaction Result Code Missing Memo

The `TransactionResultCode` `txMISSING_MEMO` is introduced because submitting a
sequenceless transaction without a memo is unlikely to guarantee any uniquely
identifying data that will differentiate two conceptually unique transactions
that happen to contain the same logical operations.

### Transaction Result Code Duplicate

The `TransactionResultCode` `txDUPLICATE` is introduced because other result
codes semantics do not fit the case where the `ledgerBounds` are valid, there is
no sequence number, but a transaction is invalid due to replay. When a duplicate
transaction is submitted with the protocol today it will likely receive a
`txBAD_SEQ` result code, however in this case the sequence number is zero or not
set.

This result code will not be seen by most users because Horizon's transaction
submission system provides idempotency, identifying duplicate submissions and
returning the previous result.

## Rank 8: The Transaction Object
url: https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/transactions/object | scope: research_chunk | date: 2025-12-19 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-astra/jev/1790470813-fa45d9fb-bb7c-4ad1-863d-cdfa7ebeeab3/search-documents/0195.txt

# The Transaction Object

- 
- APIs Overview
- Horizon
- API Reference
- Resources
- Transactions
- The Transaction Object

# The Transaction Object
infoTransaction meta result_meta_xdr will be removed from the SDF hosted Horizon API (horizon.stellar.org) in Q3 2024. Instead of using Horizon to access transaction metadata, developers could access it with the getTransactions endpoint in the Stellar RPC.

When Horizon returns information about a transaction, it uses the following format:

- ATTRIBUTEDATA TYPE

DESCRIPTION

- idstring

A unique identifier for this transaction.

- paging_tokennumber

A cursor value for use in pagination.

- successfulboolean

Indicates if this transaction was successful or not.

- hashstring

A hex-encoded SHA-256 hash of this transaction’s XDR-encoded form.

- ledgernumber

The sequence number of the ledger that this transaction was included in.

- created_atISO8601 string

The date this transaction was created.

- source_accountstring

The account that originates the transaction.

- source_account_sequencestring

The source account&#x27;s sequence number that this transaction consumed.

- fee_chargednumber

The fee (in stroops) paid by the source account to apply this transaction to the ledger.

- max_feenumber

The maximum fee (in stroops) that the source account was willing to pay.

- operation_countnumber

The number of operations contained within this transaction.

- envelope_xdrstring

A base64 encoded string of the raw TransactionEnvelope XDR struct for this transaction.

- result_xdrstring

A base64 encoded string of the raw TransactionResult XDR struct for this transaction.

- result_meta_xdrstring

[To be deprecated in Q3] A base64 encoded string of the raw TransactionMeta XDR struct for this transaction

- fee_meta_xdrstring

A base64 encoded string of the raw LedgerEntryChanges XDR struct produced by taking fees for this transaction.

- memostring

The optional memo attached to a transaction.

- memo_typestring

The type of memo. Potential values include MEMO_TEXT, MEMO_ID, MEMO_HASH, MEMO_RETURN.

- signaturesstring

An array of signatures used to sign this transaction.

- preconditionsobject

A set of transaction preconditions affecting its validity.

Show child attributes- time_boundsobject

The time range for which this transaction is valid, with bounds as unsigned 64-bit UNIX timestamps

Show child attributes- min_timestring

the lower bound

- max_timestring

the upper bound

- ledger_boundsobject

The ledger range for which this transaction is valid, as unsigned 32-bit integers.

Show child attributes- min_ledgernumber

the lower bound

- max_ledgernumber

the upper bound

- min_account_sequencestring

Containing a positive, signed 64-bit integer representing the lowest source account sequence number for which the transaction is valid.

- min_account_sequence_agenumber

The minimum duration of time (in seconds as an unsigned 64-bit integer) that must have passed since the source account&#x27;s sequence number changed for the transaction to be valid.

- min_account_sequence_ledger_gapnumber

An unsigned 32-bit integer representing the minimum number of ledgers that must have closed since the source account&#x27;s sequence number changed for the transaction to be valid.

- extra_signersarray of strings

The list of up to two additional signers that must have corresponding signatures for this transaction to be valid.

## Rank 9: Lightning on Stellar: Technical Spec and Roadmap
url: https://stellar.org/blog/developers/lightning-on-stellar-roadmap | scope: research_chunk | date: 2018-03-19 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-astra/jev/1790470813-fa45d9fb-bb7c-4ad1-863d-cdfa7ebeeab3/search-documents/0317.txt

## How lightning works

Lightning is a scaling solution for distributed payment networks, originally proposed for the Bitcoin blockchain. Lightning is designed to allow users to make off-chain payments through routers and hubs. Lightning even has the potential to support cross-protocol payments, such as a payment where the sender sends Bitcoins on the Bitcoin network and the recipient receives lumens on the Stellar network, without having to trust any parties in between.

Lightning is constructed from building blocks known as payment channels. The concept behind payment channels is simple but powerful. They allow users to open a channel off-chain and transact there instead of on the public ledger. Because they&#x27;re off-chain, transactions in the channel can be extremely fast and cheap, but similar to on-chain transactions, there&#x27;s no counterparty risk. When the channel participants are ready to go their separate ways, they close the channel and settle back to the public ledger. No matter what happened in-channel, the rest of the world only sees that final transaction. It&#x27;s like showing someone the last frame of a movie; from that one still, there&#x27;s no way to unpack the rest of the film.

Developers have begun working on payment channel designs and implementations for several chains and ledgers beyond just Bitcoin, including Ethereum and Zcash. Each platform&#x27;s channels are unique and depend on the nuances of the platform, but as a rule, any implementation will support a few basic requirements:

- No transaction submitted to the network, except when parties disengage
- No loss of funds caused by cheating parties
- No vulnerability to third-party interference
- No channel-side speed bottlenecks

Stellar supports a more flexible generalization of payment channels called state channels, meaning that any operation you can execute on the Stellar network (such as not only payments, but also creating, deleting, or changing permissions on accounts), you can execute within a payment channel.

Stellar&#x27;s state channel implementation relies on the fact that every Stellar transaction specifies a source account and a sequence number. We&#x27;ve figured out how to use those sequence numbers as a natural versioning mechanism for off-chain payments; it&#x27;s similar to how your bank gets alerted for out-of-order cheques. To do the versioning, we’re taking advantage of a new operation, BUMP_SEQUENCE, which we’ll describe in complete detail below.

Our release timeline for Lightning on Stellar is:

Stellar&#x27;s creator, Jed McCaleb, first explored Lightning back in 2015; our 2018 implementation still reflects the cleverness of his original plan, but Jeremy Rubin, with the support of Nicolas Barry and David Mazières from SDF, has added the necessary improvements to make Lightning right for us. The explanation that follows is theirs.

### State Channels on Stellar
This post describes how state channels can be implemented on Stellar. In future posts, we will show how these state channels can be chained together using Hashed Timelock Contracts (HTLCs), to enable multi-hop payments and interoperability with Lightning Network implementations on other chains (to allow atomic cross-chain trades of Bitcoin for lumens, for example). This design is not finalized, and we strongly encourage feedback from other researchers and the community as we work toward a production-ready specification and implementation.

A state channel is an arrangement among n users, u1...un, who wish to perform off-chain transactions that settle back as side-effects (net payments, but also account creations/deletions, etc). The users collaborate to create a series of "snapshot transactions"—sequences of side-effects, T1, T2, . . . , Tk, such that only the last sequence, Tk, will ever be executed on the public ledger. To ensure that Tj cannot be executed once users create Tj+1, the protocol makes a synchrony assumption: it assumes that all participants can observe and respond to the ledger—including overcoming any downtime or DoS attacks—within some bounded delay D, such as a week.

To implement state channels on Stellar, we take advantage of the fact that every Stellar transaction specifies a source account and a sequence number. A transaction’s sequence number must match the monotonically increasing sequence number of its source account. Our approach will be to assign successively higher ranges of sequence numbers on an escrow account R to the transactions in each sequence Tj. The sequence Tj cannot initially execute because its sequence numbers are too high. However, once all users have signed Tj, they go on to sign a second set of "ratchet transactions," Vj, that raise account R’s sequence number to the point at which Tj can execute. Raising R’s sequence number also permanently invalidates the snapshot transactions T_i for i < j ? This is where the synchrony assumption plays in. Transactions in sets Vj and Tj are given time bounds such that the earliest time at which Tj can execute is at least D delay after the latest time at which Vj can execute. This delay allows other users to notice that Vj has been submitted and counter by submitting Vk, thereby ensuring Tk can be executed and Tj cannot.

To support state channels as well as some other applications, Stellar is adding a new operation, BUMP_SEQUENCE. The new operation enables transactions to arbitrarily increase the sequence number of a target account. Here you can see the proposed semantics of BUMP_SEQUENCE.

We begin the protocol specification with the presumption of a set of users and accounts such that:

Our state channel is set up using an escrow account R.

While this specification describes an escrow account that uses a single aggregated public key from the private keys of the participants, an alternative (used by the example implementation described below) would be to use an N-of-N multisignature account, with one key for each of the participants.

## Rank 10: Preconditions: Generalized transaction preconditions
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0021.md | scope: research_chunk | date: 2021-11-03 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-astra/jev/1790470813-fa45d9fb-bb7c-4ad1-863d-cdfa7ebeeab3/search-documents/0049.txt

## Design Rationale

Note that the maximum size of a hash pre-image on Stellar is 64
bytes. On Bitcoin, a hash preimage could potentially be up to 520
bytes.  Hence, when pairing Stellar HTLCs with transactions on other
blockchains for cross-chain operation, care must be taken to ensure
that the other blockchain does not accept preimages larger than 64
bytes.  Otherwise, a larger preimage disclosed on another blockchain
would fail to unlock an HTLC on Stellar.

### Key recovery

The owner of account A may wish for a friend with key K to gain access
to A in the event that the owner loses her keys, but not
otherwise. This scenario can be accommodated with pre-authorized
transactions as follows.

Let s be a sequence number much higher than any that will be used in
the future on A (e.g., A's current sequence number plus 2^{32}).  The
owner constructs the following 2 transactions:

* The _recovery transaction_ T_R has source account A, sequence number
  s+1, and `minSeqAge` one week.  It contains a `SET_OPTIONS`
  operation giving K signing weight on A.

* The _declaration transaction_ T_D has source account A, sequence
  number s, and `minSeqNum` 0.  It doesn't need to contain any
  operations, but since Stellar requires at least one operation per
  transaction, it contains a `BUMP_SEQUENCE` as a no-op.

The owner of A signs T_R and T_D, and gives them to the friend for
safe keeping.  If the owner loses her keys, the friend submits T_D,
then a week later submits T_R, and finally uses key K to help the user
recover her funds.

If T_D and K are ever compromised and an attacker unexpectedly submits
T_D, then the user simply submits any transaction on A to consume
sequence number s+1 and invalidate T_R.

### Parallel transaction submission

A farm of 100 servers is constantly submitting transactions on the
same source account, and wishes to coordinate use of sequence numbers.
This can be achieved by having server number N always submit
transactions with sequence numbers congruent to N modulo 100.  Sending
the transaction at s with `minSeqNum` s-99 ensures that if any of the
servers do not submit transactions, the gap will not prevent other
transactions from executing.

### Deterministic account sequence numbers at creation

The proposed `ledgerBounds` field can be used to create an account with
a predictable sequence number that is guaranteed if the account creation
succeeds.

Assuming the user plans to create the account between ledgers 0 and N,
they can specify `ledgerBounds` as 0 and N + 1, and include a
`BUMP_SEQUENCE` operation that bumps the sequence of the created account
to N<<32. The transaction will be guaranteed to only succeed with the
created account having a sequence number of N<<32.

The sequence number is guaranteed because the account is created with a
sequence number derived from the current ledger's sequence number. The
`BUMP_SEQUENCE` operation is a no-op if the account's sequence number is
greater than the `bumpTo` sequence number. The `ledgerBounds` restricts
the creation to occur only up to the `bumpTo` to ensure that creation
results with the account having the determined sequence number.

It is also possible to eliminate the `BUMP_SEQUENCE` operation from the
transaction is a subsequent transaction uses `minSeqNum` with a value
matching the `minLedger` of `ledgerBounds`.

This property makes it possible to setup contracts using pre-authorized
transactions where the pre-authorized transaction has the created
account as its source account.

