# Evidence for: For Stellar Horizon classic transactions, what evidence resolves an unknown submission after a timeout: original transaction hash, ledger close time, time bounds, and source sequence?

Contents (section: first line):
- Rank 1: History Transactions: line 15
- Rank 2: Transaction Result Codes: line 40
- Rank 3: Error Handling: line 123
- Rank 4: Operations & Transactions: How Blockchain Actions Are Executed: line 194
- Rank 5: getTransaction: line 292
- Rank 6: The Transaction Object: line 331
- Rank 7: Timeout: line 469
- Rank 8: Migrate from Horizon to RPC: line 504
- Rank 9: Txrep: human-readable low-level representation of Stellar transactions: line 638
- Rank 10: XDR-JSON: line 670

## Rank 1: History Transactions
url: https://developers.stellar.org/docs/data/analytics/hubble/data-catalog/data-dictionary/bronze/history-transactions | scope: research_chunk | date: 2026-09-08 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-astra/jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/0075.txt

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

## Rank 2: Transaction Result Codes
url: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions | scope: research_chunk | date: 2026-09-22 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-astra/jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/0128.txt

# Transaction Result Codes

- 
- APIs Overview
- Horizon
- API Reference
- Errors
- Result Codes
- Transaction Result Codes

# Transaction Result Codes
These are Result Codes that communicate success (200) or failure (400) at the transaction level: bad sequence numbers, insufficient balances, insufficient fees, etc.

- RESULT CODESTELLAR PROTOCOL CODE

DESCRIPTION

- tx_successtxSUCCESS

The transaction succeeded.

- tx_failedtxFAILED

One of the operations failed (none were applied).

- tx_too_earlytxTOO_EARLY

The ledger closeTime was before the minTime.

- tx_too_latetxTOO_LATE

The ledger closeTime was after the maxTime.

- tx_missing_operationtxMISSING_OPERATION

No operation was specified

- tx_bad_seqtxBAD_SEQ

sequence number does not match source account

- tx_bad_authtxBAD_AUTH

too few valid signatures / wrong network

- tx_insufficient_balancetxINSUFFICIENT_BALANCE

fee would bring account below reserve

- tx_no_source_accounttxNO_ACCOUNT

source account not found

- tx_insufficient_feetxINSUFFICIENT_FEE

fee is too small

- tx_bad_auth_extratxBAD_AUTH_EXTRA

unused signatures attached to transaction

- tx_internal_errortxINTERNAL_ERROR

an unknown error occurred

Example Response for a &#x27;tx_bad_seq&#x27; Result Code{
 "type": "https://stellar.org/horizon-errors/transaction_failed",
 "title": "Transaction Failed",
 "status": 400,
 "detail": "The transaction failed when submitted to the Stellar network. The `extras.result_codes` field on this response contains further details. Descriptions of each code can be found at: https://stellar.org/developers/learn/concepts/list-of-operations.html",
 "extras": {
 "envelope_xdr": "AAAAANPRjCD1iCti3hovsrrz6aSAjmp263grVr6+mI3SQSkcAAAAZAAPRLgAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAEAAAAArki/TnIipBc7Y+Hd87mnZdtBxzm7vu6iXpwcRz6zGskAAAAAAAAAAAAHoSAAAAAAAAAAAdJBKRwAAABANWeKuRYFmBm1lrMQqMvhbSouwL270SnxcTtv1XI4Y+uVe4yw4Jq7/43EoxwLbRh/pC3V4WfOZRzDqwsTyEztAA==",
 "result_codes": {
 "transaction": "tx_bad_seq"
 },
 "result_xdr": "AAAAAAAAAAD////7AAAAAA=="
 }
}
Edit this pageLast updated on Sep 22, 2026 by RoomWithOutRoofPreviousResult CodesNextOperation Result Codes

## Rank 3: Error Handling
url: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling | scope: research_chunk | date: 2025-12-19 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-astra/jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/0019.txt

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

## Rank 4: Operations & Transactions: How Blockchain Actions Are Executed
url: https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions | scope: research_chunk | date: 2026-06-17 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-astra/jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/0154.txt

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

## Rank 5: getTransaction
url: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction | scope: research_chunk | date: 2026-07-21 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-astra/jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/0258.txt

## Result

(getTransactionResult)statusstringrequiredThe current status of the transaction by hash

Allowed values:SUCCESSNOT_FOUNDFAILEDtxHashstringrequiredThe hex-encoded hash of the transaction.

latestLedgernumberrequiredThe sequence number of the latest ledger known to Stellar RPC at the time it handled the request.

latestLedgerCloseTimestringrequiredThe unix timestamp (as a string) of the close time of the latest ledger known to Stellar RPC when it handled the request.

oldestLedgernumberrequiredThe sequence number of the oldest ledger ingested by Stellar RPC at the time it handled the request.

oldestLedgerCloseTimestringrequiredThe unix timestamp (as a string) of the close time of the oldest ledger kept in history by Stellar RPC when it handled the request.

ledgernumber(optional) The sequence number of the ledger which included the transaction. This field is only present if status is SUCCESS or FAILED.

createdAtstring(optional) The unix timestamp (as a string) of when the transaction was included in the ledger. This field is only present if status is SUCCESS or FAILED.

applicationOrdernumber(optional) The index of the transaction among all transactions included in the ledger. This field is only present if status is SUCCESS or FAILED.

feeBumpboolean(optional) Indicates whether the transaction was fee bumped. This field is only present if status is SUCCESS or FAILED.

envelopeXdrstring(optional) A base64 encoded string of the raw TransactionEnvelope XDR struct for this transaction.

resultXdrstring(optional) A base64 encoded string of the raw TransactionResult XDR struct for this transaction. This field is only present if status is SUCCESS or FAILED.

resultMetaXdrstring(optional) A base64 encoded string of the raw TransactionMeta XDR struct for this transaction.

diagnosticEventsXdrarray[string](optional) A base64 encoded slice of xdr.DiagnosticEvent. This is only present if the ENABLE_SOROBAN_DIAGNOSTIC_EVENTS has been enabled on the RPC server.

eventsobjectContains all events emitted during transaction execution.Show all...

transactionEventsXdrarray[string]An array of base64-encoded xdr.TransactionEvent. These include events such as fees being charged or refunded.

contractEventsXdrarray[array]A nested array of base64-encoded xdr.ContractEvent. Each inner array represents the contract events emitted by a single operation within the transaction.

## Rank 6: The Transaction Object
url: https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/transactions/object | scope: research_chunk | date: 2025-12-19 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-astra/jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/0102.txt

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

## Rank 7: Timeout
url: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/timeout | scope: research_chunk | date: 2025-12-19 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-astra/jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/0048.txt

# Timeout

- 
- APIs Overview
- Horizon
- API Reference
- Errors
- HTTP Status Codes
- Horizon-Specific Status Codes
- Timeout

# Timeout
The timeout error returns a 504 error code and occurs when either:

- Horizon has not received a confirmation from the Stellar Core server that the transaction you are trying to submit to the network was included in a ledger in a timely manner, or

- Horizon has not sent a response to a reverse-proxy before a specified amount of time has elapsed.

The former case may happen because there was no room for your transaction for 3 consecutive ledgers. This is because Stellar Core removes each submitted transaction from a queue. To solve this you can:

- Keep resubmitting the same transaction (with the same sequence number) and wait until it finally is added to a new ledger, or

- Increase the fee in order to prioritize the transaction.

Example Response for a &#x27;Timeout&#x27; Status Code{
 "type": "https://stellar.org/horizon-errors/timeout",
 "title": "Timeout",
 "status": 504,
 "detail": "Your request timed out before completing. Please try your request again. If you are submitting a transaction make sure you are sending exactly the same transaction (with the same sequence number)."
}
Edit this pageLast updated on Dec 19, 2025 by Elliot VorisPreviousStale HistoryNextResult Codes

## Rank 8: Migrate from Horizon to RPC
url: https://developers.stellar.org/docs/data/apis/migrate-from-horizon-to-rpc | scope: published_markdown_main_content | date: 2026-08-18 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-astra/jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/0031.txt

# Migrate from Horizon to RPC

Applications using [Horizon's REST-like API] will need to be updated to use the [RPC JSON-RPC API] when migrating from [Horizon] to [RPC]. This guide provides an overview of the key differences between the two APIs and how to migrate your application.

## Request / Response Format

Horizon's REST-like API uses HTTP methods and status codes to communicate with clients. Responses are JSON in the HAL format. See [Horizon's Response Format].

RPC's JSON-RPC API uses JSON-RPC 2.0 to communicate with clients. Requests to the API are JSON objects that contain one or more method invocations. Responses are also JSON objects that contain a result for each invocation in the request. See [JSON-RPC].

Both formats utilise JSON for the overall structure which are relatively simple and do not require any special client code, although there are client [SDKs] available. Some values contained within are XDR encoded and can be decoded using Stellar [SDKs].

## Endpoint Mapping

Applications that use the following Horizon endpoints can typically migrate directly to the RPC using the referenced methods.

Endpoints without mappings do not have a direct replacement in the RPC API. To build similar functionality in an application, please consider partnering with an indexer or using the information listed below to build your own indexed representation of horizon endpoints. Consider using other [Data] products for analytics use cases.

| Horizon Endpoint | Corresponding RPC Method(s) | Indexer Equivalent | Analytics Resources |
| --- | --- | --- | --- |
| [`GET /`] | [`getLatestLedger`] [`getVersionInfo`] [`getHealth`] [`getNetwork`] | Not applicable | [Analyst Guide](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide.md) |
| [`GET /ledgers`] | [`getLedgers`] | Create a [`getLedgers`] with full history, using [Galexie](https://developers.stellar.org/docs/data/indexers/build-your-own/galexie.md), to build a historical ledger view. | [Ledgers](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#ledgers) |
| [`GET /ledgers/{seq}`] | [`getLedgers`] (with filter for sequence) | Use a [`getLedgers`] view with full history, filtered by ledger sequence | [Ledgers](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#ledgers) |
| [`GET /ledgers/{seq}/transactions`] | [`getTransactions`] (with filter for ledger sequence) | Use [`getTransactions`] with ledger sequence filtering to retrieve transactions for a specific ledger | [Transactions](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#transactions) |
| [`GET /ledgers/{seq}/operations`] | [`getTransactions`] | Use [`getTransactions`] for the given ledger, then parse the transaction's XDR for individual operations. | [Operations](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#operations) |
| [`GET /ledgers/{seq}/payments`] | [`getEvents`] [`getTransactions`] ⚠️ | Use [`getEvents`] (CAP-67 asset events, available since Protocol 23 on nodes that emit classic events) and parse [`getTransactions`] meta XDR to tie those events back to individual operations. | [Payments](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#payments) |
| [`GET /ledgers/{seq}/effects`] | [`getEvents`] [`getTransactions`] ⚠️ | Use [`getEvents`] for the effects CAP-67 models (asset movement and trustline authorization), and parse [`getTransactions`] meta XDR for every other effect type. | [Effects](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#effects) |
| [`POST /transactions`] | [`sendTransaction`] | Not applicable | Not applicable |
| [`POST /transactions_async`] | [`sendTransaction`] | Not applicable | Not applicable |
| [`GET /transactions`] | [`getTransactions`] | Use [`getTransactions`] to build a historical transaction list | [Transactions](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#transactions) |
| [`GET /transactions/{hash}`] | [`getTransaction`] | Use getTransaction to retrieve a specific transaction by its hash | [Transactions](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#transactions) |
| [`GET /transactions/{hash}/operations`] | [`getTransaction`] | Filter [`getTransaction`] by hash and then parse its XDR for operations | [Operations](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#operations) |
| [`GET /transactions/{hash}/payments`] | No direct RPC equivalent; use [`getEvents`] or parse [`getTransactions`] | Filter [`getTransaction`] by hash and analyze its events and operation types to identify payments. | [Payments](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#payments) |
| [`GET /transactions/{hash}/effects`] | No direct RPC equivalent; use [`getEvents`] or parse [`getTransactions`] | Filter [`getTransaction`] by hash and analyze its events and metadata for relevant data. | [Effects](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#effects) |
| [`GET /operations`] | [`getTransactions`] | Ingest all historical ledgers/transactions and build and build a view of operations for filtering. | [Operations](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#operations) |
| [`GET /operations/{id}`] | No direct RPC equivalent | Store Horizon's operation ID and map it back to the ledger sequence and transaction index to retrieve the relevant transaction via [`getTransactions`]. | [Operations](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#operations) |
| [`GET /operations/{id}/effects`] | No direct RPC equivalent | Retrieve the operation by ID (as above) and then parse its associated transaction and events for effects. | [Effects](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#effects) |
| [`GET /fee_stats`] | [`getFeeStats`] [`simulateTransaction`] | Indexed data not recommended. | [Fee Stats](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#fee-stats) |
| [`GET /accounts`] | No direct RPC equivalent | Ingest all ledger history via [`getLedgers`] to build and maintain a complete list of accounts. | [Accounts](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#accounts) |
| [`GET /accounts/{address}`] | [`getLedgerEntries`] | Use [`getLedgerEntries`] for a specific account address. Note: RPC will not provide trust line information associated with the account directly, as Horizon does. You will need to derive this from ledger entries. | [Accounts](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#accounts) |
| [`GET /claimable_balances`] | No direct RPC equivalent | Ingest all ledger history via [`getLedgers`] to build and maintain a complete list of claimable balances. | [Claimable Balances](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#claimable-balances) |
| [`GET /claimable_balances/{id}`] | [`getLedgerEntries`] | Use [`getLedgerEntries`] to retrieve a specific claimable balance by ID. | [Claimable Balances](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#claimable-balances) |
| [`GET /claimable_balances/{id}/transactions`] | No direct RPC equivalent | Trace transactions that interact with the specific claimable balance ID from their historical ledger data. | [Claimable Balances](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#claimable-balances) |
| [`GET /claimable_balances/{id}/operations`] | No direct RPC equivalent | trace operations related to the specific claimable balance ID from your historical ledger data. | [Claimable Balances](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#claimable-balances) |
| [`GET /liquidity_pools`] | No direct RPC equivalent | ingest all ledger history via [`getLedgers`] to build and maintain a complete list of liquidity pools. | [Liquiditity Pools](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#liquidity-pools) |
| [`GET /liquidity_pools/{id}`] | [`getLedgerEntries`] | Use [`getLedgerEntries`] to retrieve a specific liquidity pool by ID. | [Liquiditity Pools](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#liquidity-pools) |
| [`GET /liquidity_pools/{id}/transactions`] | No direct RPC equivalent | Trace transactions that interact with the specific liquidity pool ID from their historical ledger data. | [Liquiditity Pools](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#liquidity-pools) |
| [`GET /liquidity_pools/{id}/operations`] | No direct RPC equivalent | Trace operations related to the specific liquidity pool ID from their historical ledger data. | [Liquiditity Pools](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#liquidity-pools) |
| [`GET /liquidity_pools/{id}/effects`] | No direct RPC equivalent | Trace effects related to the specific liquidity pool ID from their historical ledger data. | [Liquiditity Pools](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#liquidity-pools) |
| [`GET /liquidity_pools/{id}/trades`] | No direct RPC equivalent | Infer trades related to the specific liquidity pool ID from historical ledger data (e.g., from [`getEvents`] and [`getTransactions`] metadata). | [Liquiditity Pools](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#liquidity-pools) |
| [`GET /offers`] | No direct RPC equivalent | Ingest all ledger history via [`getLedgers`] to build and maintain a complete list of offers. | [Offers](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#offers) |
| [`GET /offers/{id}`] | [`getLedgerEntries`] | Use [`getLedgerEntries`] to retrieve a specific offer by ID. | [Offers](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#offers) |
| [`GET /offers/{id}/trades`] | No direct RPC equivalent | Infer trades related to the specific offer ID from historical ledger data (e.g., from [`getEvents`] and [`getTransactions`] metadata). | [Offers](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#offers) |
| [`GET /payments`] | [`getEvents`] [`getTransactions`] ⚠️ | Use [`getEvents`] (CAP-67 asset events) and process [`getTransactions`] metadata for payment-like operations across all history. | [Payments](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#payments) |
| [`GET /effects`] | [`getEvents`] [`getTransactions`] ⚠️ | Use [`getEvents`] for the effects CAP-67 models, and process [`getTransactions`] metadata to derive the remaining effect types across all history. | [Effects](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#effects) |
| [`GET /trades`] | [`getEvents`] [`getTransactions`] ⚠️ | Infer trades from [`getEvents`] and [`getTransactions`] metadata across all history, as there is no direct "trade event" in RPC. | [Trades](https://developers.stellar.org/docs/data/analytics/hubble/analyst-guide/queries-for-horizon-like-data.md#trades) |

> [!TIP]
>
> The [`getTransactions`] method can be used to retrieve events batched by transaction. The events are contained in the meta XDR of the transaction (field `resultMetaXdr`).
>

> [!WARNING]
>
> The [`getEvents`] method is not a direct replacement for Horizon's endpoints.
>
> Since [CAP-67] shipped in Protocol 23, the method can return events from classic operations as well as from contracts. Those unified asset events are emitted as `transfer`, `mint`, `burn`, `clawback`, `fee`, and `set_authorized`, so a single stream can cover the movement of assets and changes to trustline authorization.
>
> Classic events are not on by default. They are only present if the Stellar Core instance backing the RPC runs with `EMIT_CLASSIC_EVENTS=true`. If you also need to cover ledgers from Protocol 22 and earlier, that additionally requires `BACKFILL_STELLAR_ASSET_EVENTS=true`. If you run your own RPC, set what your history range needs before relying on this mapping. If you use a provider, confirm with them. See [Events](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/events.md) for more detail.
>
> That is still narrower than Horizon's effects. Anything CAP-67 does not model, such as signer updates, data entry changes, sequence number bumps, and offer management, has to come from the meta XDR of the transaction. The [`getTransactions`] method returns that meta XDR (field `resultMetaXdr`), which also contains events from contracts.
>

[CAP-67]: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md
[Horizon]: ./horizon/README.mdx
[RPC]: ./rpc/README.mdx
[Horizon's REST-like API]: ./horizon/api-reference/README.mdx
[Horizon's Response Format]: ./horizon/api-reference/structure/response-format.mdx
[RPC JSON-RPC API]: ./rpc/api-reference/README.mdx
[JSON-RPC]: ./rpc/api-reference/structure/json-rpc.mdx
[Data]: ../analytics/README.mdx
[SDKs]: ../../tools/sdks/README.mdx
[`GET /`]: ./horizon/api-reference/README.mdx
[`GET /ledgers`]: ./horizon/api-reference/list-all-ledgers.api.mdx
[`GET /ledgers/{seq}`]: ./horizon/api-reference/retrieve-a-ledger.api.mdx
[`GET /ledgers/{seq}/transactions`]: ./horizon/api-reference/retrieve-a-ledgers-transactions.api.mdx
[`GET /ledgers/{seq}/operations`]: ./horizon/api-reference/retrieve-a-ledgers-operations.api.mdx
[`GET /ledgers/{seq}/payments`]: ./horizon/api-reference/retrieve-a-ledgers-payments.api.mdx
[`GET /ledgers/{seq}/effects`]: ./horizon/api-reference/retrieve-a-ledgers-effects.api.mdx
[`POST /transactions`]: ./horizon/api-reference/submit-a-transaction.api.mdx
[`POST /transactions_async`]: ./horizon/api-reference/submit-async-transaction.api.mdx
[`GET /transactions`]: ./horizon/api-reference/list-all-transactions.api.mdx
[`GET /transactions/{hash}`]: ./horizon/api-reference/retrieve-a-transaction.api.mdx
[`GET /transactions/{hash}/operations`]: ./horizon/api-reference/retrieve-a-transactions-operations.api.mdx
[`GET /transactions/{hash}/payments`]: ./horizon/api-reference/retrieve-a-transactions-payments.api.mdx
[`GET /transactions/{hash}/effects`]: ./horizon/api-reference/retrieve-a-transactions-effects.api.mdx
[`GET /operations`]: ./horizon/api-reference/list-all-operations.api.mdx
[`GET /operations/{id}`]: ./horizon/api-reference/retrieve-an-operation.api.mdx
[`GET /operations/{id}/effects`]: ./horizon/api-reference/retrieve-an-operations-effects.api.mdx
[`GET /fee_stats`]: ./horizon/api-reference/README.mdx
[`GET /accounts`]: ./horizon/api-reference/list-all-accounts.api.mdx
[`GET /accounts/{address}`]: ./horizon/api-reference/retrieve-an-account.api.mdx
[`GET /claimable_balances`]: ./horizon/api-reference/list-all-claimable-balances.api.mdx
[`GET /claimable_balances/{id}`]: ./horizon/api-reference/retrieve-a-claimable-balance.api.mdx
[`GET /claimable_balances/{id}/transactions`]: ./horizon/api-reference/cb-retrieve-related-transactions.api.mdx
[`GET /claimable_balances/{id}/operations`]: ./horizon/api-reference/cb-retrieve-related-operations.api.mdx
[`GET /liquidity_pools`]: ./horizon/api-reference/list-liquidity-pools.api.mdx
[`GET /liquidity_pools/{id}`]: ./horizon/api-reference/retrieve-a-liquidity-pool.api.mdx
[`GET /liquidity_pools/{id}/transactions`]: ./horizon/api-reference/lp-retrieve-related-transactions.api.mdx
[`GET /liquidity_pools/{id}/operations`]: ./horizon/api-reference/lp-retrieve-related-operations.api.mdx
[`GET /liquidity_pools/{id}/effects`]: ./horizon/api-reference/retrieve-related-effects.api.mdx
[`GET /liquidity_pools/{id}/trades`]: ./horizon/api-reference/retrieve-related-trades.api.mdx
[`GET /offers`]: ./horizon/api-reference/get-all-offers.api.mdx
[`GET /offers/{id}`]: ./horizon/api-reference/get-offer-by-offer-id.api.mdx
[`GET /offers/{id}/trades`]: ./horizon/api-reference/get-trades-by-offer-id.api.mdx
[`GET /payments`]: ./horizon/api-reference/list-all-payments.api.mdx
[`GET /effects`]: ./horizon/api-reference/list-all-effects.api.mdx
[`GET /trades`]: ./horizon/api-reference/get-all-trades.api.mdx
[`getLatestLedger`]: ./rpc/api-reference/methods/getLatestLedger.mdx
[`getVersionInfo`]: ./rpc/api-reference/methods/getVersionInfo.mdx
[`getHealth`]: ./rpc/api-reference/methods/getHealth.mdx
[`getNetwork`]: ./rpc/api-reference/methods/getNetwork.mdx
[`getLedgers`]: ./rpc/api-reference/methods/getLedgers.mdx
[`getTransactions`]: ./rpc/api-reference/methods/getTransactions.mdx
[`getTransaction`]: ./rpc/api-reference/methods/getTransaction.mdx
[`getEvents`]: ./rpc/api-reference/methods/getEvents.mdx
[`sendTransaction`]: ./rpc/api-reference/methods/sendTransaction.mdx
[`getFeeStats`]: ./rpc/api-reference/methods/getFeeStats.mdx
[`simulateTransaction`]: ./rpc/api-reference/methods/simulateTransaction.mdx
[`getLedgerEntries`]: ./rpc/api-reference/methods/getLedgerEntries.mdx

## Rank 9: Txrep: human-readable low-level representation of Stellar transactions
url: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0011.md | scope: research_chunk | date: 2021-10-09 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-astra/jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/0029.txt

## Test Cases

The following binary transaction:

AAAAAgAAAAArFkuQQ4QuQY6SkLc5xxSdwpFOvl7VqKVvrfkPSqB+0AAAAGQApSmNAAAAAQAAAAEAAAAAW4nJgAAAAABdav0AAAAAAQAAABZFbmpveSB0aGlzIHRyYW5zYWN0aW9uAAAAAAABAAAAAAAAAAEAAAAAQF827djPIu+/gHK5hbakwBVRw03TjBN6yNQNQCzR97QAAAABVVNEAAAAAAAyUlQyIZKfbs+tUWuvK7N0nGSCII0/Go1/CpHXNW3tCwAAAAAX15OgAAAAAAAAAAFKoH7QAAAAQN77Tx+tHCeTJ7Va8YT9zd9z9Peoy0Dn5TSnHXOgUSS6Np23ptMbR8r9EYWSJGqFdebCSauU7Ddo3ttikiIc5Qw=

Can be rendered like this (note that comments are optional and may contain
implementation-dependent information):

    type: ENVELOPE_TYPE_TX
    tx.sourceAccount: GAVRMS4QIOCC4QMOSKILOOOHCSO4FEKOXZPNLKFFN6W7SD2KUB7NBPLN
    tx.fee: 100
    tx.seqNum: 46489056724385793
    tx.timeBounds._present: true
    tx.timeBounds.minTime: 1535756672 (Fri Aug 31 16:04:32 PDT 2018)
    tx.timeBounds.maxTime: 1567292672 (Sat Aug 31 16:04:32 PDT 2019)
    tx.memo.type: MEMO_TEXT
    tx.memo.text: "Enjoy this transaction"
    tx.operations.len: 1
    tx.operations[0].sourceAccount._present: false
    tx.operations[0].body.type: PAYMENT
    tx.operations[0].body.paymentOp.destination: GBAF6NXN3DHSF357QBZLTBNWUTABKUODJXJYYE32ZDKA2QBM2H33IK6O
    tx.operations[0].body.paymentOp.asset: USD:GAZFEVBSEGJJ63WPVVIWXLZLWN2JYZECECGT6GUNP4FJDVZVNXWQWMYI
    tx.operations[0].body.paymentOp.amount: 400004000 (40.0004e7)
    tx.ext.v: 0
    signatures.len: 1
    signatures[0].hint: 4aa07ed0 (GAVRMS4QIOCC4QMOSKILOOOHCSO4FEKOXZPNLKFFN6W7SD2KUB7NBPLN)
    signatures[0].signature: defb4f1fad1c279327b55af184fdcddf73f4f7a8cb40e7e534a71d73a05124ba369db7a6d31b47cafd118592246a8575e6c249ab94ec3768dedb6292221ce50c

## Rank 10: XDR-JSON
url: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0051.md | scope: research_chunk | date: 2025-05-13 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-astra/jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/0111.txt

## Examples

### `TransactionEnvelope`

XDR Binary:

```b
00000000: 0000 0002 0000 0000 e699 2664 c18d f5eb  ..........&d....
00000010: 74cc a2e0 764d 8f0c 963a 97c3 6231 5584  t...vM...:..b1U.
00000020: c6ca f0eb 47a6 2d00 002a 9a64 0000 1a6e  ....G.-..*.d...n
00000030: 0000 0001 0000 0000 0000 0000 0000 0001  ................
00000040: 0000 0000 0000 0018 0000 0001 0000 0001  ................
00000050: 0000 0000 0000 0001 0000 0000 0000 0001  ................
00000060: 0000 0000 0000 0000 0000 0001 0000 0006  ................
00000070: 0000 0001 d792 8b72 c270 3ccf eaf7 eb9f  .......r.p<.....
00000080: f4ef 4d50 4a55 a8b9 79fc 9b45 0ea2 c842  ..MPJU..y..E...B
00000090: b4d1 ce61 0000 0014 0000 0001 0002 3d7d  ...a..........=}
000000a0: 0000 0000 0000 00f8 0000 0000 002a 9a00  .............*..
000000b0: 0000 0001 47a6 2d00 0000 0040 2b0e dc5b  ....G.-....@+..[
000000c0: a942 3e0a c764 4665 7494 5855 b74c 3207  .B>..dFet.XU.L2.
000000d0: b7f2 ae69 a433 a16b df9c 293d c2bc 58a7  ...i.3.k..)=..X.
000000e0: 1778 a4e5 e014 3e6a 4135 e0c6 6da5 a79a  .x....>jA5..m...
000000f0: f4b3 1d85 7a29 696d e924 0d04            ....z)im.$..
```

XDR Binary Base64 Encoded:

```base64
AAAAAgAAAADmmSZkwY3163TMouB2TY8MljqXw2IxVYTGyvDrR6YtAAAqmmQAABpuAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAAYAAAAAQAAAAEAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAAAAAABAAAABgAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQAAABQAAAABAAI9fQAAAAAAAAD4AAAAAAAqmgAAAAABR6YtAAAAAEArDtxbqUI+CsdkRmV0lFhVt0wyB7fyrmmkM6Fr35wpPcK8WKcXeKTl4BQ+akE14MZtpaea9LMdhXopaW3pJA0E
```

JSON:

```json
{
  "tx": {
    "tx": {
      "source_account": "GDTJSJTEYGG7L23UZSROA5SNR4GJMOUXYNRDCVMEY3FPB22HUYWQBZIA",
      "fee": 2792036,
      "seq_num": "29059748724737",
      "cond": "none",
      "memo": "none",
      "operations": [
        {
          "source_account": null,
          "body": {
            "invoke_host_function": {
              "host_function": {
                "create_contract": {
                  "contract_id_preimage": {
                    "asset": "native"
                  },
                  "executable": "stellar_asset"
                }
              },
              "auth": []
            }
          }
        }
      ],
      "ext": {
        "v1": {
          "ext": "v0",
          "resources": {
            "footprint": {
              "read_only": [],
              "read_write": [
                {
                  "contract_data": {
                    "contract": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
                    "key": "ledger_key_contract_instance",
                    "durability": "persistent"
                  }
                }
              ]
            },
            "instructions": 146813,
            "disk_read_bytes": 0,
            "write_bytes": 248
          },
          "resource_fee": "2791936"
        }
      }
    },
    "signatures": [
      {
        "hint": "47a62d00",
        "signature": "2b0edc5ba9423e0ac764466574945855b74c3207b7f2ae69a433a16bdf9c293dc2bc58a71778a4e5e0143e6a4135e0c66da5a79af4b31d857a29696de9240d04"
      }
    ]
  }
}
```

