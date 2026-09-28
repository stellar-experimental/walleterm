# Evidence for: What do official Stellar RPC sources say about reconciling an uncertain transaction submission using its original hash, especially NOT_FOUND and retention limits?

Contents (section: first line):
- Rank 1: Error Handling: line 16
- Rank 2: passkey-kit: Constructor-only Secp256r1 signer provenance: line 108
- Rank 3: getTransaction: line 141
- Rank 4: Timeout: line 218
- Rank 5: Removing Ledger State from SQL Databases in 22.1: line 253
- Rank 6: RPC: Now with Infinite Scroll: line 262
- Rank 7: Data: line 278
- Rank 8: Retrieve a List of Transactions: line 689
- Rank 9: Reconciling Stellar Events: line 706
- Rank 9 companion: (same URL): line 743
- Rank 10: Debugging Contract Errors: line 752

## Rank 1: Error Handling
url: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling | scope: research_chunk | date: 2025-12-19 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev/1790473788-1dc393c6-c348-42dc-9752-4ca20924cfcd/search-documents/0014.txt

## Error Handling for Transaction Submissions​

Horizon currently supports two types of transaction submission endpoints:

- /transactions_async: Horizon submits a transaction to Stellar-Core in an asynchronous manner and passes the relevant Stellar-Core response back immediately to the client. It is then the client&#x27;s responsibility to poll for the status of that transaction.

- /transactions: Horizon submits a transaction to Stellar-Core and then waits for it to be ingested into its database. It will either return a success (200), failure (400) or a timeout response (504), after which it is the client&#x27;s responsibility to poll for the status of the transaction.

Note that polling the transaction hash will return a 404 until it gets included in the ledger, or it fails to do so. In both cases, you will get a response when Horizon has ingested it into the database.

There are some resolution strategies that are common between the 2 endpoints while others strategies are more endpoint specific.

### Request Adjustments​

Certain transaction submission failures also need adjustments to succeed.

- If the XDR is malformed, or the transaction is otherwise invalid, you’ll encounter a 400 Bad Request (for example, an invalid source account). Both transactions and their operations can be easily malformed or invalid: look at the extras.result_codes field for details and cross-reference them with the appropriate result codes documentation to determine specifics.

- Transaction fees are also a safe adjustment by modifying the fees via a fee-bump transaction if you get a tx_insufficient_fee error. Refer to the Insufficient Fees and Surge Pricing section later in this document for more information on managing fees and strategies around it.

### Polling and Retrying Transactions​

Async Transaction Submission​
Submissions using the /transactions_async endpoint return an immediate response back from Stellar-Core. There are different actions that clients can take based on the specific tx_status returned:

- PENDING: The submission is successful but the transaction is still waiting to be included in a ledger. You should use the GET /transactions/:transaction_hash endpoint to poll for the submitted transaction and check if it makes into a ledger. Note that even though the submission was successful, it can still fail to get included in the ledger.

- DUPLICATE: The submission was a duplicate of a previously submitted transaction. This could happen if the client resubmitted the same transaction multiple times.

- ERROR: The submission did not go through due to an error in Stellar-Core. Take a look at the attached error message for more details, modify your transaction if necessary, and resubmit.

- TRY_AGAIN_LATER: This indicates that the Stellar-Core instance is currently unable to process submission of this particular transaction. Clients should wait for sometime before resubmitting the transaction. This could happen due to different reasons:

- There is another transaction from same source account in memory

- It has been rejected due to too low inclusion fee and has been resubmitted too soon

- JavaScript

let server = sdk.Server("https://horizon-testnet.stellar.org");
let contractId = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
let contract = new StellarSdk.Contract(contractId);

// Right now, this is just the default fee for this example.
const fee = StellarSdk.BASE_FEE;

let transaction = new StellarSdk.TransactionBuilder(account, { fee })
 .setNetworkPassphrase(StellarSdk.Networks.TESTNET)
 .setTimeout(30) // valid for the next 30s
 // Add an operation to call increment() on the contract
 .addOperation(contract.call("increment"))
 .build();

// Sign this transaction with the secret key
// NOTE: signing is transaction is network specific. Test network transactions
// won&#x27;t work in the public network. To switch networks, use the Network object
// as explained above (look for StellarSdk.Network).
let sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecretKey);
transaction.sign(sourceKeypair);

server.submitAsyncTransaction(transaction).then((result) => {
 console.log("hash:", result.hash);
 console.log("status:", result.tx_status);
 console.log("errorResultXdr:", result.error_result_xdr);
});

// Add a small sleep duration before polling the transaction.
time.sleep(5 * time.Second);
server
 .transactions()
 .transaction(result.hash)
 .call()
 .then((txResult) => {
 console.log("Transaction status:", txResult);
 });

Synchronous Transaction Submission​
Due to the blocking nature of this endpoint, things are a little different compared to the asynchronous strategy. There are 3 possible scenarios that clients can encounter:

- The submission is successful and Horizon returns the transaction response back. This is the happy path and clients do not need to do anything but wait for Horizon&#x27;s response.

- Stellar-Core sends back an ERROR response from the submission. Clients should consult the attached error message and retry the submission again.

- Timeouts: Horizon may respond with a 504 HTTP code. This response is not an error but a warning that your transaction hasn&#x27;t been accepted by the network yet. There could be many possible reasons for the timeout, the most common of which is network congestion, but it could also be due to other transient issues.

- Polling the transaction hash: Use the transaction hash in the timeout response and poll the GET /transactions/:transaction_hash endpoint to see if it successfully makes it into a ledger.

- Resubmitting the transaction: Before attempting any resubmissions, you need to make sure your transaction has timed out based on the time bounds you specified. After your transaction has expired, you can confirm it by polling the transaction again and getting a tx_too_late response from Horizon. Rebuild the transaction by updating the timebounds and resubmit the transaction.

## Rank 2: passkey-kit: Constructor-only Secp256r1 signer provenance
url: https://github.com/stellar/passkey-kit/blob/main/docs/security-signer-provenance-v2.md | scope: research_chunk | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev/1790473788-1dc393c6-c348-42dc-9752-4ca20924cfcd/search-documents/0021.txt

## Birth verification

Birth verification is required.
Current code does not prove which code created a wallet.
The creation transaction supplies the immutable birth evidence.

The indexer returns `birthWasmHash`, `creationTransactionHash`, and `creationLedger` per candidate.
These fields are claims.
The SDK verifies them through Stellar RPC:

1. Fetch `creationTransactionHash` with `getTransaction`.
2. Recompute the transaction hash from the returned envelope.
3. Compare the recomputed hash with `creationTransactionHash`.
4. Confirm the transaction succeeded at `creationLedger`.
5. Confirm the transaction created the candidate address.
6. Confirm the operation is a direct `CreateContractV2`.
7. Confirm the birth WASM hash is in `acceptedBirthWasmHashes`.

A valid wallet can upgrade after birth.
Therefore, `acceptedBirthWasmHashes` and `acceptedWasmHashes` stay separate.

RPC retention can expire a transaction.
The SDK then fetches the same transaction through configured Horizon history.
It recomputes and verifies the hash the same way.
A transaction that fails any check disqualifies the candidate.
A transaction the SDK cannot fetch disqualifies the candidate.

The birth check runs before the stored-proof check.
A candidate with accepted birth code still needs every later check.

## Rank 3: getTransaction
url: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction | scope: research_chunk | date: 2026-07-21 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev/1790473788-1dc393c6-c348-42dc-9752-4ca20924cfcd/search-documents/0038.txt

## Examples

Successful TransactionNot Found TransactionFailed TransactionQuery for a transaction hash that returns SUCCESS from the RPC node.

### Request

- cURL
- JavaScript
- Python
- JSON

curl -X POST \
-H &#x27;Content-Type: application/json&#x27; \
-d &#x27;{
 "jsonrpc": "2.0",
 "id": 8675309,
 "method": "getTransaction",
 "params": {
 "hash": "32f7e5c3afd281fcaa99c0e990adf62f33e3bb341b1641a5c8b0b4a4dc55c487"
 }
}&#x27; \
https://soroban-testnet.stellar.org | jq
let requestBody = {
 "jsonrpc": "2.0",
 "id": 8675309,
 "method": "getTransaction",
 "params": {
 "hash": "32f7e5c3afd281fcaa99c0e990adf62f33e3bb341b1641a5c8b0b4a4dc55c487"
 }
}
let res = await fetch(&#x27;https://soroban-testnet.stellar.org&#x27;, {
 method: &#x27;POST&#x27;,
 headers: {
 &#x27;Content-Type&#x27;: &#x27;application/json&#x27;,
 },
 body: JSON.stringify(requestBody),
})
let json = await res.json()
console.log(json)
import json, requests
res = requests.post(https://soroban-testnet.stellar.org, json={
 "jsonrpc": "2.0",
 "id": 8675309,
 "method": "getTransaction",
 "params": {
 "hash": "32f7e5c3afd281fcaa99c0e990adf62f33e3bb341b1641a5c8b0b4a4dc55c487"
 }
})
print(json.dumps(res.json(), indent=4))
{
 "jsonrpc": "2.0",
 "id": 8675309,
 "method": "getTransaction",
 "params": {
 "hash": "32f7e5c3afd281fcaa99c0e990adf62f33e3bb341b1641a5c8b0b4a4dc55c487"
 }
}

### Result
{
 "jsonrpc": "2.0",
 "id": 8675309,
 "result": {
 "latestLedger": 490314,
 "latestLedgerCloseTime": "1752722132",
 "oldestLedger": 369355,
 "oldestLedgerCloseTime": "1752115873",
 "status": "SUCCESS",
 "txHash": "32f7e5c3afd281fcaa99c0e990adf62f33e3bb341b1641a5c8b0b4a4dc55c487",
 "applicationOrder": 3,
 "feeBump": false,
 "envelopeXdr": "AAAAAgAAAADuBg+afmvWN9+nlruudR93UO1rDpTe8i6yxgPgBKoBVwExLQAAAA2lAAAfvQAAAAEAAAAAAAAAAAAAAABoeGmwAAAAAAAAAAEAAAABAAAAAO4GD5p+a9Y336eWu651H3dQ7WsOlN7yLrLGA+AEqgFXAAAAGAAAAAAAAAABpSceYV7WS1BBCQPWpKLTlFiL/HWIhKMrikJgApyrKdYAAAAJc2V0X3ByaWNlAAAAAAAAAgAAABAAAAABAAAACQAAAAoAAAAAAAAAAAAAaahaRp+AAAAACgAAAAAAAAAAAAB5y+SQiwAAAAAKAAAAAAAAAAAAAHFdMEkwAAAAAAoAAAAAAAAAAAAAQkvPyHAAAAAACgAAAAAAAAAAAAAE2U+ba4AAAAAKAAAAAAAAAAAAAAASetIWgAAAAAoAAAAAAAAAAAAAEFgo8D+AAAAACgAAAAAAAAAAAAACzFTXmwAAAAAKAAAAAAAAAAAEoxZECi8uAAAAAAUAAAGYFlw7QAAAAAEAAAAAAAAAAAAAAAGlJx5hXtZLUEEJA9akotOUWIv8dYiEoyuKQmACnKsp1gAAAAlzZXRfcHJpY2UAAAAAAAACAAAAEAAAAAEAAAAJAAAACgAAAAAAAAAAAABpqFpGn4AAAAAKAAAAAAAAAAAAAHnL5JCLAAAAAAoAAAAAAAAAAAAAcV0wSTAAAAAACgAAAAAAAAAAAABCS8/IcAAAAAAKAAAAAAAAAAAAAATZT5trgAAAAAoAAAAAAAAAAAAAABJ60haAAAAACgAAAAAAAAAAAAAQWCjwP4AAAAAKAAAAAAAAAAAAAALMVNebAAAAAAoAAAAAAAAAAASjFkQKLy4AAAAABQAAAZgWXDtAAAAAAAAAAAEAAAAAAAAAAQAAAAfaZ5h4OOy0NoTgqFsSMHHBZ2BWo+ttPZwC2FftqORNwwAAAAoAAAAGAAAAAaUnHmFe1ktQQQkD1qSi05RYi/x1iISjK4pCYAKcqynWAAAACQAAAZgWXDtAAAAAAAAAAAAAAAAAAAAABgAAAAGlJx5hXtZLUEEJA9akotOUWIv8dYiEoyuKQmACnKsp1gAAAAkAAAGYFlw7QAAAAAAAAAABAAAAAAAAAAYAAAABpSceYV7WS1BBCQPWpKLTlFiL/HWIhKMrikJgApyrKdYAAAAJAAABmBZcO0AAAAAAAAAAAgAAAAAAAAAGAAAAAaUnHmFe1ktQQQkD1qSi05RYi/x1iISjK4pCYAKcqynWAAAACQAAAZgWXDtAAAAAAAAAAAMAAAAAAAAABgAAAAGlJx5hXtZLUEEJA9akotOUWIv8dYiEoyuKQmACnKsp1gAAAAkAAAGYFlw7QAAAAAAAAAAEAAAAAAAAAAYAAAABpSceYV7WS1BBCQPWpKLTlFiL/HWIhKMrikJgApyrKdYAAAAJAAABmBZcO0AAAAAAAAAABQAAAAAAAAAGAAAAAaUnHmFe1ktQQQkD1qSi05RYi/x1iISjK4pCYAKcqynWAAAACQAAAZgWXDtAAAAAAAAAAAYAAAAAAAAABgAAAAGlJx5hXtZLUEEJA9akotOUWIv8dYiEoyuKQmACnKsp1gAAAAkAAAGYFlw7QAAAAAAAAAAHAAAAAAAAAAYAAAABpSceYV7WS1BBCQPWpKLTlFiL/HWIhKMrikJgApyrKdYAAAAJAAABmBZcO0AAAAAAAAAACAAAAAAAAAAGAAAAAaUnHmFe1ktQQQkD1qSi05RYi/x1iISjK4pCYAKcqynWAAAAFAAAAAEAmJaAAACcQAAAC7gAAAAAAJiWgAAAAAHMpdlgAAAAQI1Wv1nG8+GPa2KOs99Rc3DPDYwypIPeKBa9Po4AN/VLSkjpqhIf2Tvli73MZYQlVmxsF2dROm2LPlgFPep8ZA0=",
 "resultXdr": "AAAAAAAHNm8AAAAAAAAAAQAAAAAAAAAYAAAAABAjuTEVbQCbk5bRhjZsSNvqYe1R+oSFTzqCtsrEM/Z/AAAAAA==",

## Rank 4: Timeout
url: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/timeout | scope: research_chunk | date: 2025-12-19 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev/1790473788-1dc393c6-c348-42dc-9752-4ca20924cfcd/search-documents/0104.txt

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

## Rank 5: Removing Ledger State from SQL Databases in 22.1
url: https://stellar.org/blog/developers/removing-ledger-state-from-sql-databases-in-22-1 | scope: research_chunk | date: 2024-11-25 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev/1790473788-1dc393c6-c348-42dc-9752-4ca20924cfcd/search-documents/0236.txt

## Transaction and transaction set history

While the `getledgerentryraw` can be used to query for ledger state, stellar-core will no longer store or expose transaction and transaction set history. If this information is required, it is recommended to either run an RPC or Horizon node or query public history archives.

Questions? Comments? Please raise them on the Stellar Dev Discord #validator channel.

## Rank 6: RPC: Now with Infinite Scroll
url: https://stellar.org/blog/developers/rpc-now-with-infinite-scroll | scope: research_chunk | date: 2025-08-14 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev/1790473788-1dc393c6-c348-42dc-9752-4ca20924cfcd/search-documents/0195.txt

# RPC: Now with Infinite Scroll

# RPC: now with infinite scroll
Author

Urvi Savla

Publishing date

Ever wished you could access any Stellar ledger, no matter how old, directly through RPC? Until now, that wasn’t possible due to RPC’s retention policy, which limited access to recent data only.

Good news! We are excited to introduce a new feature that changes that: RPC integration with the ledger data lake. Fulfilling the vision outlined in our earlier proof of concept, this integration makes it possible to retrieve any historical ledger, from genesis to the latest, directly through your RPC queries.

## Rank 7: Data
url: https://skills.stellar.org/skills/data/SKILL.md | scope: skill_markdown_entrypoint | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev/1790473788-1dc393c6-c348-42dc-9752-4ca20924cfcd/search-documents/0219.txt

---
name: data
description: Querying Stellar chain data via Stellar RPC (preferred) and Horizon (legacy). Covers RPC JSON-RPC methods, Horizon REST endpoints, streaming, pagination, historical queries, Hubble/Galexie for deep history, and the RPC/Horizon migration story. Use when reading balances, transactions, operations, ledgers, contract events, or building any indexer/analytics workflow.
user-invocable: true
argument-hint: "[data task]"
---

# Stellar Data: RPC + Horizon

API access for reading chain state. Stellar RPC is the preferred entry point for new projects; Horizon remains for legacy and historical-query workflows. For deeper history beyond RPC's 7-day window, use Hubble/Galexie.

## When to use this skill
- Calling Stellar RPC methods (`getLatestLedger`, `getLedgerEntries`, `getEvents`, `simulateTransaction`, `sendTransaction`)
- Querying Horizon endpoints (accounts, transactions, operations, effects, ledgers)
- Streaming live events or operations
- Pulling historical data beyond RPC's 7-day window (Hubble, Galexie)
- Choosing between RPC and Horizon for a given workflow

## Related skills
- Building transactions to send → `../dapp/SKILL.md`
- Smart contract simulation and event emission → `../smart-contracts/SKILL.md`
- Asset balance and trustline lookups → `../assets/SKILL.md`
- Standards (SEP-7 deeplinks, SEP-10 auth) → `../standards/SKILL.md`

---


## Overview

Stellar provides two API paradigms:

| API | Status | Use Case |
|-----|--------|----------|
| **Stellar RPC** | Preferred | Smart contracts, real-time state, new projects |
| **Horizon** | Legacy-focused | Historical data, legacy applications |

**Recommendation**: Use Stellar RPC for all new projects. Use Horizon mainly for historical queries and legacy compatibility paths.

## Read the file that matches the task

| Task | File |
|------|------|
| RPC methods and usage | [Stellar RPC](#stellar-rpc) (below) |
| Horizon endpoints, common operations, streaming, pagination | [horizon.md](horizon.md) |
| Migration strategy | [Migration: Horizon to RPC](#migration-horizon-to-rpc) (below) |
| Data history/indexing options | [Historical Data Access](#historical-data-access) (below) |
| Environment setup and endpoints | [Network Configuration](#network-configuration) (below) |

## Stellar RPC

### Endpoints

> Note: SDF directly provides Futurenet public RPC. For Mainnet RPC, select a provider from the [RPC providers directory](https://developers.stellar.org/docs/data/apis/rpc/providers).

| Network | RPC URL |
|---------|---------|
| Mainnet | Provider-specific endpoint (see [RPC providers directory](https://developers.stellar.org/docs/data/apis/rpc/providers)) |
| Testnet | `https://soroban-testnet.stellar.org` |
| Futurenet | `https://rpc-futurenet.stellar.org` |
| Local | `http://localhost:8000/soroban/rpc` |

### Setup

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";

const rpc = new StellarSdk.rpc.Server("https://soroban-testnet.stellar.org");
```

### Key Methods

#### Get Account

```typescript
const account = await rpc.getAccount(publicKey);
// Returns account with sequence number for transaction building
```

#### Get Health

```typescript
const health = await rpc.getHealth();
// { status: "healthy" }
```

#### Get Latest Ledger

```typescript
const ledger = await rpc.getLatestLedger();
// { id: "...", sequence: 123456, protocolVersion: 25 }
```

#### Get Ledger Entries

```typescript
// Read contract storage
const key = StellarSdk.xdr.LedgerKey.contractData(
  new StellarSdk.xdr.LedgerKeyContractData({
    contract: new StellarSdk.Address(contractId).toScAddress(),
    key: StellarSdk.xdr.ScVal.scvSymbol("Counter"),
    durability: StellarSdk.xdr.ContractDataDurability.persistent(),
  })
);

const entries = await rpc.getLedgerEntries(key);
if (entries.entries.length > 0) {
  const value = StellarSdk.scValToNative(
    entries.entries[0].val.contractData().val()
  );
}
```

#### Simulate Transaction

```typescript
const simulation = await rpc.simulateTransaction(transaction);

if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
  console.error("Simulation failed:", simulation.error);
} else if (StellarSdk.rpc.Api.isSimulationSuccess(simulation)) {
  console.log("Cost:", simulation.cost);
  console.log("Result:", simulation.result);
}
```

#### Send Transaction

```typescript
const response = await rpc.sendTransaction(signedTransaction);

if (response.status === "PENDING") {
  // Poll for result
  let result = await rpc.getTransaction(response.hash);
  while (result.status === "NOT_FOUND") {
    await new Promise(r => setTimeout(r, 1000));
    result = await rpc.getTransaction(response.hash);
  }

  if (result.status === "SUCCESS") {
    console.log("Success:", result.returnValue);
  } else {
    console.error("Failed:", result.status);
  }
}
```

#### Get Transaction

```typescript
const tx = await rpc.getTransaction(txHash);
// status: "SUCCESS" | "FAILED" | "NOT_FOUND"
// returnValue: ScVal (for contract calls)
// ledger: number
```

#### Get Events

```typescript
const events = await rpc.getEvents({
  startLedger: 1000000,
  filters: [
    {
      type: "contract",
      contractIds: [contractId],
      topics: [
        ["*", StellarSdk.xdr.ScVal.scvSymbol("transfer").toXDR("base64")],
      ],
    },
  ],
});

for (const event of events.events) {
  console.log("Event:", event.topic, event.value);
}
```

### RPC Limitations

- **7-day history for most methods**: `getTransaction`, `getEvents`, etc. only cover recent data
- **`getLedgers` exception**: on a data-lake-backed provider, "Infinite Scroll" pages back past the retention window — as far as that provider's data lake reaches (potentially genesis). On a plain RPC instance it is bounded by `getHealth().oldestLedger`; requests older than that fail with `-32600`. Check before assuming depth.
- **No streaming**: Poll for updates (no WebSocket)
- **Contract-focused**: Limited classic Stellar data


## Migration: Horizon to RPC

### Account Loading

```typescript
// Horizon (old)
const account = await horizonServer.loadAccount(publicKey);

// RPC (new)
const account = await rpc.getAccount(publicKey);
// Note: RPC returns less data, just what's needed for transactions
```

### Transaction Submission

```typescript
// Horizon (for classic transactions)
const result = await horizonServer.submitTransaction(tx);

// RPC (for smart contract transactions)
const response = await rpc.sendTransaction(tx);
const result = await pollForResult(response.hash);
```

### Historical Data

```typescript
// Horizon - full history
const allTxs = await horizonServer
  .transactions()
  .forAccount(publicKey)
  .call();

// RPC - most methods limited to the retention window (~7 days)
// Exception: getLedgers can page further back (Infinite Scroll), but only as far
// as the chosen provider's retention or data-lake integration reaches.
// Always check the floor of the instance you're talking to first:
const { oldestLedger } = await rpc.getHealth();
// For guaranteed full history, use:
// 1. Hubble (SDF's BigQuery dataset)
// 2. Galexie (data pipeline)
// 3. Your own indexer
```

### Streaming Replacement

```typescript
// Horizon - native streaming
server.payments().stream({ onmessage: handlePayment });

// RPC - polling (no native streaming)
async function pollForUpdates() {
  const lastLedger = await rpc.getLatestLedger();
  // Check for new events/transactions
  // Repeat on interval
}
setInterval(pollForUpdates, 5000);
```

## Historical Data Access

For data older than the RPC retention window (~7 days — not available via most RPC methods; `getLedgers` reaches further only on data-lake-backed providers, see [Data Lake](#data-lake) below):

### Hubble (BigQuery)

```sql
-- Query Stellar data in BigQuery
SELECT *
FROM `crypto-stellar.crypto_stellar.history_transactions`
WHERE source_account = 'G...'
ORDER BY created_at DESC
LIMIT 100
```

### Galexie

Self-hosted data pipeline for processing Stellar ledger data:
- https://github.com/stellar/galexie

### Data Lake

RPC "Infinite Scroll" is powered by the Stellar data lake — a cloud-based object store (SEP-0054 format). Deep `getLedgers` history is a property of the **provider**, not the method: an instance only serves history past its retention window if its operator wired a data lake in. Instances without one (the public SDF testnet RPC included) reject older start ledgers with JSON-RPC `-32600` — compare your target against `getHealth().oldestLedger` before paging back.
- **Public access**: `s3://aws-public-blockchain/v1.1/stellar/ledgers/pubnet` (AWS Open Data)
- **Self-host**: Use Galexie to export to AWS S3 or Google Cloud Storage
- **Hosted**: [Quasar (Lightsail Network)](https://quasar.lightsail.network) provides hosted Galexie Data Lake + Archive RPC endpoints
- **Size**: ~3.8TB, growing ~0.5TB/year
- **Cost**: ~$160/month self-hosted ($60 compute + $100 storage)
- **Docs**: https://developers.stellar.org/docs/data/apis/rpc/admin-guide/data-lake-integration

### Third-Party Indexers

For complex queries, event streaming, or custom data pipelines beyond what RPC/Horizon provide:

- **Mercury** — Stellar-native indexer with Retroshades, GraphQL API (https://mercurydata.app)
- **SubQuery** — Multi-chain indexer with Stellar support, event handlers (https://subquery.network)
- **Goldsky** — Real-time data replication pipelines and subgraphs (https://goldsky.com)
- **StellarExpert API** — Free, no-auth REST API for assets, accounts, ledger resolution (https://stellar.expert/openapi.html)

See the full indexer directory: https://developers.stellar.org/docs/data/indexers

## Network Configuration

> For a React/Next.js-specific setup, see the [dapp skill](../dapp/SKILL.md).
> For mainnet RPC, set `STELLAR_MAINNET_RPC_URL` from a provider in the [RPC providers directory](https://developers.stellar.org/docs/data/apis/rpc/providers).

### Environment-Based Setup

```typescript
// lib/stellar-config.ts
import * as StellarSdk from "@stellar/stellar-sdk";

type NetworkConfig = {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  friendbotUrl: string | null;
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

// Lazy per-network factories: requireEnv only runs for the selected network,
// so testnet/local work without the mainnet env var set.
const configs: Record<string, () => NetworkConfig> = {
  mainnet: () => ({
    rpcUrl: requireEnv("STELLAR_MAINNET_RPC_URL"),
    horizonUrl: "https://horizon.stellar.org",
    networkPassphrase: StellarSdk.Networks.PUBLIC,
    friendbotUrl: null,
  }),
  testnet: () => ({
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: StellarSdk.Networks.TESTNET,
    friendbotUrl: "https://friendbot.stellar.org",
  }),
  local: () => ({
    rpcUrl: "http://localhost:8000/soroban/rpc",
    horizonUrl: "http://localhost:8000",
    networkPassphrase: "Standalone Network ; February 2017",
    friendbotUrl: "http://localhost:8000/friendbot",
  }),
};

const network = process.env.STELLAR_NETWORK || "testnet";
const makeConfig = configs[network];
if (!makeConfig) throw new Error(`Unknown network: ${network}`);
export const config = makeConfig();

export const rpc = new StellarSdk.rpc.Server(config.rpcUrl);
export const horizon = new StellarSdk.Horizon.Server(config.horizonUrl);
```

## Best Practices

### Use RPC for:
- New application development
- Smart contract interactions
- Transaction simulation and submission
- Real-time account state

### Use Horizon for:
- Historical transaction queries
- Payment streaming
- Legacy application maintenance
- Rich account metadata

### Error Handling

```typescript
// RPC errors
try {
  const result = await rpc.sendTransaction(tx);
} catch (error) {
  if (error.code === 400) {
    // Invalid transaction
  } else if (error.code === 503) {
    // Service unavailable
  }
}

// Horizon errors
try {
  const result = await horizon.submitTransaction(tx);
} catch (error) {
  const extras = error.response?.data?.extras;
  if (extras?.result_codes) {
    // Detailed error codes
    console.log("Transaction:", extras.result_codes.transaction);
    console.log("Operations:", extras.result_codes.operations);
  }
}
```

### Rate Limiting

Both RPC and Horizon have rate limits:
- Use exponential backoff for retries
- Cache responses where appropriate
- Consider running your own nodes for high-volume applications

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error.response?.status === 429) {
        // Rate limited - exponential backoff
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}
```

## Rank 8: Retrieve a List of Transactions
url: https://developers.stellar.org/docs/platforms/anchor-platform/api-reference/platform/transactions/get-transactions | scope: research_chunk | date: 2026-07-16 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev/1790473788-1dc393c6-c348-42dc-9752-4ca20924cfcd/search-documents/0229.txt

## Responses​

- 200
- 400
- 404

Transaction found.

Bad Request

Transaction not found.

Last updated on Jul 16, 2026 by John WootenPreviousRetrieve a TransactionNextJSON-RPC API

## Rank 9: Reconciling Stellar Events
url: https://stellar.org/blog/developers/reconciling-stellar-events | scope: research_chunk | date: 2025-11-13 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev/1790473788-1dc393c6-c348-42dc-9752-4ca20924cfcd/search-documents/0089.txt

## If you run Stellar Infrastructure

The recommendation varies depending on the specific infrastructure product that you run.

GalexieOperators that host a Galexie Data Lake (S3 or GCS) should plan to re-export all ledgers that occurred between Protocols 23 and 24 in order to ensure that they have a complete history of all Stellar Events that occurred on the network.

The Galexie v24.1.0 release added a new replace feature in order to ease this process. It enables you to overwrite existing files in your data lake seamlessly and without downtime, like so:

$ galexie replace --start 58762517 --end 59501299

This job will take roughly 80 hours to run on the recommended hardware. It’s possible to parallelize this if you’d like to expedite the process.

HorizonOperators hosting Horizon that set any of the following configuration values should consider ingesting history between Protocols 23 and 24 in order to ensure a complete history of all Stellar Events that occurred on the network.

- SKIP_TXMETA = false
- EMIT_CLASSIC_EVENTS = true
- BACKFILL_STELLAR_ASSET_EVENTS = true

Note that if you do not explicitly set either of these values in your configuration, then the default behavior is that you do not need to take any action.

Should you identify that you do need to reingest the history in your Horizon database, it can be done like so:

- Check HISTORY_RETENTION_COUNT to ensure that you’ll be at least retaining enough ledgers to reach back ledger sequence 58762517
- Stop your live Horizon instance; reingestion cannot be performed at the same time as live ingestion. For this reason, it is best to perform this process offline or on a standby/secondary instance.
- Perform the reingestion. If desired, this command can be parallelized.

$ stellar-horizon db reingest range 58762517 59501299

- Restart your live Horizon instance.

Stellar RPCThe default historical retention window for RPC is 7 days. As such, all Stellar Events that weren’t emitted in real-time have already occurred outside of RPC’s retention window. Therefore, it is not recommended that RPC operators take any action.

Providers may consider expanding their offering to include an archival RPC node, as the consumer demand to reingest historical data may increase given this issue.

## Rank 9 companion: (same URL)
url: https://stellar.org/blog/developers/reconciling-stellar-events | scope: ai_summary | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev/1790473788-1dc393c6-c348-42dc-9752-4ca20924cfcd/search-documents/0005.txt

Reconciling Stellar Events

Stellar Core v24.1.0 addresses a state archival issue that caused some Stellar Events to be omitted from ledger metadata between Protocol 23 and 24. Infrastructure operators running Galexie, Horizon, or RPC need to take specific remediation steps to ensure complete historical data, while consumers of Stellar Events should audit affected ledger keys.

The Whisk protocol release introduced Stellar Events (CAP-67) to track all token movements across the network, but a state archival bug caused some events to be omitted between Protocol 23 (ledger 58762517) and Protocol 24 (ledger 59501299). Stellar Core v24.1.0, released November 11, 2025, guarantees complete event history for new replays from genesis. However, operators already live during the issue missed these events. Remediation varies by infrastructure: Galexie operators should re-export affected ledgers using the new replace feature (approximately 80 hours); Horizon operators with specific event configurations should reingest history; RPC operators need not act due to 7-day retention. Consumers of Stellar Events should audit the affected ledger keys list and coordinate with their infrastructure providers for complete data recovery.

## Rank 10: Debugging Contract Errors
url: https://developers.stellar.org/docs/learn/fundamentals/contract-development/errors-and-debugging/debugging-errors | scope: published_markdown_main_content | date: 2026-05-01 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev/1790473788-1dc393c6-c348-42dc-9752-4ca20924cfcd/search-documents/0093.txt

# Debugging Contract Errors

To understand how to debug Soroban errors, first we must understand how the errors are associated with each step of the transaction flow, and the likely and common errors in each step of the transaction flow.

## General Transaction Flow

The typical transaction submission process can be broken down into the following sequential steps, excluding external interactions like wallet interactions. Each step has its own set of potential errors:

1. **Transaction Simulation (optional):**
   - **What happens:** This step involves executing the RPC endpoint [`simulateTransaction`](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/simulateTransaction.md). The endpoint executes a transaction in 'simulation' mode of host and records the necessary ledger entries, CPU instructions, required authorizations. The end result is akin to running transactions in Core with maxed-out resources, unrestricted ledger access, and no fees.
   - **Common failures:** Errors typically involve exceeding the network limit or encountering contract logic issues.

2. **Core Accepts the Transaction:**
   - **What happens:** Core evaluates each transaction to decide whether to accept or reject it. Rejected transactions are usually invalid or have insufficient fees, especially during high traffic periods.
   - **Common failures:** Invalid transactions, such as those with incorrect resource fees or overly high resource values, and invalid footprint are rejected. Other common errors include bad transaction signatures or insufficient funds in the source account. Valid transactions may only be rejected due to a low inclusion fee.

3. **Core Includes the Transaction in the Ledger:**
   - **What happens:** Accepted transactions remain in Core’s memory until they are either included in the ledger or evicted.
   - **Common failures:** Transactions may fail to be included in the ledger if they have a low inclusion fee and need to be evicted during traffic surges to accommodate more transactions.

4. **Core Applies the Transaction to the Ledger:**
   - **What happens:** Core executes the included transaction.
   - **Common failures:** This step has the widest range of potential errors. Failures could include accessing archived entries, resource depletion, accessing entries outside the specified footprint, or encountering logic failures within the contract.

_For more information about fees, please visit [Fees, Resource Limits, and Metering](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering.md#inclusion-fee)._

## Detailed Soroban Errors

### 1. Transaction Simulation

Errors here are returned by the host and propagated through RPC. This doesn’t cover other possible errors (e.g. network errors, errors in RPC itself etc.)

| Error | Explanation | Fix |
| --- | --- | --- |
| `HostError(Budget, LimitExceeded)` | A network-defined resource limit has been exceeded (either instructions, or memory). Refer to diagnostic events to check which limit has been exceeded (99% of the time this will be instructions). | Optimize the contract to consume fewer resources. |
| `HostError(Storage, MissingValue)` | Trying to access a ledger entry that does not exist. 99.9% of the time this means that either contract, or Wasm does not exist in the ledger (the remaining cases can only appear when the developer doesn’t use the Soroban SDK for contracts). Diagnostic events should indicate which entry is missing. | Deploy the respective contract or Wasm. |
| `HostError(WasmVm, InvalidAction)` | There was a failure in some Wasm contract, typically a `panic!()`. Diagnostic events might provide more detailed information, but not always, as the `panic!()` messages are not included in the Wasm builds. | Fix the contract logic or invocation arguments. Since the most typical reason for encountering this is `panic!()`, it might be a good idea to use `panic_with_error!()` instead of `panic!()` everywhere. Writing more unit tests is recommended. |
| `HostError(<some other code>)` | An arbitrary execution error, like accessing a value out of container bounds, overflow in i128 arithmetics, incorrect invocation argument type etc. The error code should provide a general idea of what is failing, but refer to diagnostic events for details. | Fix the contract logic or invocation arguments. Additional debugging can be done via unit tests. |

### 2. Core Accepts the Transaction

The error is returned by the core immediately as a response to the transaction being sent and surfaced to the user through RPC. There are a few error-related fields in the Core’s response:

- `status` contains one of the few coarse codes: it’s either “ERROR” for any transaction validation error, or one of the few special non-validation-related statuses.
- `result` contains the encoded TransactionResult XDR that, in case of “ERROR” status, will contain the transaction-level error code starting with “tx”, such as `txMALFORMED`.
- `txFAILED` transaction errors at this stage correspond to the operation-specific validation errors, so the operation result code should be examined.
- `diagnostics` will contain additional error information in the Soroban diagnostic event format. This typically will be returned for `txSOROBAN_INVALID` transaction errors but may be used more extensively in the future.

| Error from Core | Explanation | Fix |
| --- | --- | --- |
| status: `TRY_AGAIN_LATER` | There is already a transaction from the same source account in memory. The transaction has been rejected due to too low inclusion fee and has been resubmitted too soon. | Wait for the previous transaction to be applied and resubmit, or switch to channel accounts if higher throughput is needed. Wait more time before re-submitting the transaction. Build a transaction within the network limits. |
| status: `ERROR`, error: `txMALFORMED` | Transaction is fundamentally wrong: Soroban operation is not the only operation in the transaction; Soroban extension is missing; Fee or resource fee is negative; Resource fee is greater than tx fee; Declared resources are higher than network-wide limits (e.g. it wants to use 200M instructions, while the ledger-wide limit is just 100M). | Make sure the transaction is well-formed and the total transaction fee is high enough. |
| status: `ERROR`, error: `txINSUFFICIENT_FEE` | Most likely: The inclusion fee is too low during the traffic surge. Unlikely: The inclusion fee is lower than the network minimum (i.e., lower than 100 stroops). | Bump the transaction fee or wait until there is less traffic. |
| status: `ERROR`, error: `txSOROBAN_INVALID`, diagnostics: “transaction $RESOURCE_NAME resources exceed network config limit” or similar | Some resource value specified in the transaction exceeds the network limit. For example, this would trigger if the transaction specifies 200M instructions, while the network limit is just 100M. Note, that this has nothing to do with what the transaction actually does. Only resource declarations are examined at this point. | Optimize the contract to fit into the resource limit and specify the respective value in transaction (typically by running [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction)). In the case if there is just too big a ‘safety margin’ for the resources (e.g. +20% given that the transaction already needs 90% of the network limit), reduce the resource declaration to fit the limit. |
| status: `ERROR`, error: `txSOROBAN_INVALID`, diagnostics: footprint-related message | There are a number of footprint requirements, such as it shouldn’t contain duplicate keys, shouldn’t contain entries unsupported by Soroban etc. Diagnostic message will specify the details of which requirement has been violated. | Fix the footprint. This should only occur if the footprint has been built or modified manually; footprints included in the [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) response should always pass all checks. |
| status: `ERROR`, error: `txSOROBAN_INVALID`, diagnostics: "transaction sorobanData.resourceFee is lower than the actual Soroban resource fee" | The resource fee specified in the transaction is not sufficient to cover the resources specifiedin the transaction. Note, that this has nothing to do with what the transaction actually does. Only resource declarations are examined at this point. | Increase the resource fee. This should normally only occur when resources are computed or modified manually. [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) always computes the sufficient resource fee. |
| status: `ERROR`, error: `txFAILED`, operation error: `EXTEND_FOOTPRINT_TTL_MALFORMED` | One of the footprint requirements for ExtendFootprintTTL operation has not been fulfilled: - Only Soroban ledger entries can be extended. - Only readOnly footprint should be populated. - The TTL extension should be not larger than the maximum allowed TTL extension. | Make sure that footprints conform to the requirements. Ideally, client-side libraries should ensure that the TTL extension transactions are well-formed. |
| status: `ERROR`, error: `txFAILED`, operation error: `RESTORE_FOOTPRINT_MALFORMED` | One of the footprint requirements for RestoreFootprint operation has not been fulfilled: Only persistent Soroban ledger entries can be restored; Only readWrite footprint should be populated. | Make sure that footprints conform to the requirements. Ideally, client-side libraries should ensure that the restoration transactions are well-formed. |
| status: `ERROR`, error: `tx$CODE` | The remaining error codes have the same semantics for Soroban as they do for Stellar; these include errors like insufficient account balance, bad seq num, etc. These errors are usually straightforward to interpret according to the name. | Fix the issue corresponding to the code. There is nothing Soroban specific here. |

### 3. Core Includes the Transaction in the Ledger

There are instances when the Core does not appear to include the transaction in the ledger, The following best practice is recommended:

| Error | Explanation | Fix |
| --- | --- | --- |
| Transaction appears ‘stuck’ and is never applied | There is no direct error reporting here because the network can’t reasonably communicate which transaction that it drops (E.g. Node A has dropped the transaction doesn’t necessarily mean that some other Node B has dropped it). When querying against a data endpoint, the transaction might be reported as ‘pending’. | Introduce transaction time bounds on the client side. If a transaction hasn’t been applied within 1-2 minutes it’s highly unlikely that the network still remembers it. _It is strongly recommended thus that all transactions should include a time bound or ledger bound._ Having a bound allows the developer to re-submit the transaction after the time bound is exceeded and optionally bump the fee if the error persists. |

> [!NOTE]
>
> It is strongly recommended that all transactions should include a time bound or ledger bound.
>

### 4. Core Applies the Transaction to the Ledger

The errors and diagnostic events are recorded in the transaction meta stream emitted by the Core instance when the ledger is being closed. Then, the RPC ingests the transaction metadata (tx meta) and allows developers to query the tx meta.

When an error occurs, the Core stores a few error-related fields in the transaction result meta:

- The transaction result (error) will be `txFAILED` for Soroban-related failures (or any operation failures in general). It is sometimes possible to get other `tx$ERROR` errors (such as `txBAD_AUTH`), but these are not related to Soroban and are more of an edge case.
- The operation error will be one of `INVOKE_HOST_FUNCTION_$ERROR`, `RESTORE_FOOTPRINT_$ERROR`, and `EXTEND_FOOTPRINT_TTL_$ERROR` (corresponding to InvokeHostFunction, RestoreFootprint, and ExtendFootprintTTL operations). The operation errors are not very granular, and diagnostic events should typically be used to understand the exact error.
- If the Core instance producing meta has Soroban diagnostics enabled (which it usually should), the meta will also contain diagnostic events with more detailed error information.
- Note that there might be a few gaps in diagnostic event coverage. Since this is not a protocol change, Core may add more diagnostic events in future releases.

> [!NOTE]
>
> `$OPERATION` here refers to any one of the Soroban operations: `INVOKE_HOST_FUNCTION`, `RESTORE_FOOTPRINT`, and `EXTEND_FOOTPRINT_TTL`.
>

| Error and Diagnostics | Explanation | Fix |
| --- | --- | --- |
| `$OPERATION_RESOURCE_LIMIT_EXCEEDED`, diagnostics: message specifying which resource limit has been exceeded | The transaction has exceeded the resource limit during execution. For most resources (instructions, read bytes, write bytes), this has nothing to do with the network limit; it's the transaction-specified limit. For example, a transaction has 10M instructions specified but consumes at least 10M + 1 instruction and immediately fails. Diagnostic events specify which limit has been exceeded and contain both the limit itself and the value transaction tried to consume. | If exceeding the transaction-specified limit, increase the respective resource declared in the transaction. If [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) determined the resource limits, likely reason for exceeding is logic dependent on volatile ledger state (e.g., RNG or ledger sequence). Ensure logic is estimated sufficiently by [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction). If exceeding network limits (entry size, memory), modify/ optimize the contract. |
| `$OPERATION_INSUFFICIENT_REFUNDABLE_FEE` | The refundable resource fee was not sufficient to cover the consumed refundable resources, i.e., not enough to pay for emitted events or TTL extensions. | The simplest fix is to increase the resource fee unconditionally; unspent fees are refunded. [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) estimates refundable fees but can't predict TTL extensions' actual cost due to ledger state volatility. Thus [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) can’t always predict the fee that will actually be charged. |
| `INVOKE_HOST_FUNCTION_ENTRY_ARCHIVED` | Transaction tries to access an archived ledger entry, e.g. when the footprint contains a ledger key for an archived persistent Soroban ledger entry. Note, this failure happens before the Soroban host is even created, so this is unrelated to contract logic. | Restore the archived entry using RestoreFootprintOp operation. [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) usually reports archived entries, but an entry may be archived after the transaction simulation happened. |
| `INVOKE_HOST_FUNCTION_TRAPPED`, diagnostics: HostError(Storage, LimitExceeded). | Host function tried to access a ledger entry outside of the footprint. Diagnostic events specify the exact missing entry. [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) should usually return the valid footprint, so in the case when [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) is being used, it’s likely that: a) Contract generates non-deterministic keys (e.g. derives them from RNG or ledger sequence), b) Contract has non-deterministic logic that results in access to a different entry set (e.g. a ‘lottery’ contract that non-deterministically performs transfer to either address A or address B). | If [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) is not used, fix client code to build the correct footprint. If using [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction), fix contract or footprint: avoid non-deterministic keys , and add all keys that can be accessed in any scenario, (e.g. balance entries for both A and B in the ‘lottery’ contract example). |
| `INVOKE_HOST_FUNCTION_TRAPPED`, diagnostics: HostError(WasmVm, InvalidAction) | Failure in a Wasm contract, typically a `panic!()`. Diagnostic events might provide more detailed information, but not always, as the `panic!()` messages are not included in the Wasm builds. | Fix contract logic. Consider using `panic_with_error!()` and increase [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) runs and unit testing. |
| `INVOKE_HOST_FUNCTION_TRAPPED`, diagnostics: HostError(Auth, InvalidAction) "Unauthorized function call for address \<'ADDRESS'>" | The transaction didn’t have an authorization payload necessary to satisfy the `require_auth` host function call for a given \<’ADDRESS’>. This is unlikely to occur when [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) is being used, but still possible if the `require_auth` arguments depend on volatile ledger state (e.g. if `require_auth` contains the ledger sequence number) | Attach proper authorization payload to the transaction, usually via [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction). Ensure auth payloads are deterministic and depend only on invocation arguments. |
| `INVOKE_HOST_FUNCTION_TRAPPED`, diagnostics: HostError(Auth, \<'error code'>) | Authentication error, like missing/expired/invalid signature or reused nonce. These errors won’t always appear in the [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) response unless the whole signed auth payload is used in the [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) request. The diagnostic events will also have a more detailed explanation of what the error was. | Fix authentication payload according to error (e.g. use proper signature, new nonce etc.). Consider running [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) with all signatures for faster debugging. |
| `INVOKE_HOST_FUNCTION_TRAPPED`, HostError(\<'some other code'>) | An arbitrary execution error, like accessing a value out of container bounds, overflow in i128 arithmetics, incorrect invocation argument type etc. The error code should provide a general idea of what is failing, but refer to diagnostic events for more details. | Fix contract logic or invocation arguments. Additional debugging can be done via more [`simulateTransaction`](../../../../data/apis/rpc/api-reference/methods/simulateTransaction) runs and unit tests. |

