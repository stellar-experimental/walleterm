# Evidence for: For a testnet Stellar signing companion, what protocol requirements distinguish transaction envelope signatures, Soroban G-account and C-account authorization signatures, and browser wallet integration? Identify required network binding, nonce and expiry handling, signature verification, and safe handling of unknown submission outcomes.

Contents (section: first line):
- Rank 1: Signing Soroban contract invocations: line 17
- Rank 2: Invoke and deploy smart contracts with the InvokeHostFunctionOp operation: line 151
- Rank 3: Memo Authorization for Soroban: line 287
- Rank 4: Stellar’s composable auth model: line 396
- Rank 4 companion: (same URL): line 439
- Rank 5: Authentication delegation and address-bound Soroban credentials: line 448
- Rank 6: Soroban smart contract system overview: line 536
- Rank 7: js-stellar-sdk v16.1.0: line 775
- Rank 8: js-stellar-sdk v17.0.0 — v17.0.0: Protocol 28: line 804
- Rank 9: Smart Contract Host Functionality: Secp256r1 Verification: line 821
- Rank 10: Stellar Zipper, Protocol 27 Upgrade Guide: line 922
- Rank 10 companion: (same URL): line 951

## Rank 1: Signing Soroban contract invocations
url: https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations | scope: research_chunk | date: 2026-06-17 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/central-jev/1790470394-ea614df8-cd83-4197-8cee-f00658b278bd/search-documents/0013.txt

## Method 2: Auth-entry signing​

Auth-entry signing decouples authorization from transaction submission. The authorizer signs only the specific contract invocation (an "auth entry"), while a separate account acts as the transaction source, paying fees and consuming its own sequence number. This method works for either G-account or C-account clients.

### When to use​

- The end-user has a C-account (commonly a smart wallet) — Method 2 is the only option for C-accounts, as they cannot sign transaction envelopes. G-accounts can also use this method.

- The end-user doesn&#x27;t (need to) have XLM to pay for fees

- Applications want a fine-grained control over which parts of the contract invocation (and subinvocations) are authorized by each account.

- Building smart contract protocols where the end-user doesn&#x27;t submit the transaction

- Building payment protocols where the transaction source account will be defined at a later point in time

### How it works​

- Client builds the transaction using AssembledTransaction

- Client simulates (Recording Mode) to get the authorization tree

- Client signs the auth entries using signAuthEntries

- Client optionally re-simulates (Enforcing Mode) to validate their signatures

- Client sends the transaction XDR to the fee-payer

- Fee-payer parses the XDR and rebuilds with its own G-account as source

- Fee-payer performs security verifications 🚨 to ensure the incoming transaction does not contain any malicious code.

- Fee-payer simulates (Enforcing Mode) to catch errors before paying fees

- Fee-payer signs the transaction envelope and submits

### Simulation modes: Recording vs Enforcing​

Transaction simulation has two modes that are critical to understand:

ModeWhen usedWhat it doesRecording ModeFirst simulation, before signingReturns the auth entries that need signatures. Skips require_auth validation.Enforcing ModeSecond simulation, after signingValidates signatures and executes __check_auth. Returns accurate resource estimates.
Enforcing Mode simulation is required for submissionThe first simulation (Recording Mode) does not execute the require_auth checks — it only records which auth entries are needed. This means the resource estimates from the first simulation are incomplete.

The fee-payer must simulate in Enforcing Mode, and the client is strongly recommended to simulate as well to ensure fees and auth checks are correct when the contract enforces signatures:

WhoWhyClientValidates signatures before sending to fee-payer and ensures auth enforcement succeeds before it leaves the client.Fee-payerVerifies the transaction will succeed before submitting and ensures auth enforcement will pass before paying fees.Running Enforcing Mode simulation provides two critical benefits:

- Validates signatures and execution — Catches auth errors and contract failures before submission. Failed simulations cost nothing; failed submissions cost real fees.

- Returns accurate resource estimates — Recording Mode underestimates fees because it skips auth validation.

See Transaction Simulation - Authorization for more details.

### Auth entry structure​

An auth entry signature authorizes a specific invocation tree and includes:

- Address: The account authorizing the invocation

- Signature expiration ledger: When the signature becomes invalid (ledger-based, not timestamp)

- Nonce: A unique value for replay protection

- Signature: Signs the SHA-256 hash of the ENVELOPE_TYPE_SOROBAN_AUTHORIZATION preimage

Signature expirationAuth entry signatures expire based on ledger numbers, not timestamps. A typical offset is between 12 and 60 ledgers (approximately 1-5 minutes). The signature is valid until and including the signatureExpirationLedger, but invalid at signatureExpirationLedger + 1.

Keep expiration windows as small as viable – shorter windows are safer and result in lower transaction costs.

### Code example: Using AssembledTransaction​

This example shows a token transfer where the sender (client) uses AssembledTransaction to build and sign auth entries, then sends the transaction XDR to a fee-payer for submission.

Step 1: Client builds and signs auth entries​
import { Keypair, Networks, nativeToScVal } from "@stellar/stellar-sdk";
import {
 AssembledTransaction,
 basicNodeSigner,
} from "@stellar/stellar-sdk/contract";
import { Api } from "@stellar/stellar-sdk/rpc";

const rpcUrl = "https://soroban-testnet.stellar.org";
const networkPassphrase = Networks.TESTNET;

// Client&#x27;s keypair (authorizes the transfer)
const senderKeypair = Keypair.fromSecret("S...");

async function buildSignedAuthEntries(
 tokenContractId: string,
 recipientAddress: string,
 amount: bigint,
): Promise<string> {
 // Build transaction using AssembledTransaction
 const tx = await AssembledTransaction.build({
 contractId: tokenContractId,
 method: "transfer",
 args: [
 nativeToScVal(senderKeypair.publicKey(), { type: "address" }),
 nativeToScVal(recipientAddress, { type: "address" }),
 nativeToScVal(amount, { type: "i128" }),
 ],
 networkPassphrase,
 rpcUrl,
 parseResultXdr: (result) => result,
 });

 // Check simulation result (Recording Mode)
 if (Api.isSimulationError(tx.simulation)) {
 throw new Error(`Simulation failed: ${tx.simulation.error}`);
 }

 // Check who needs to sign
 const missingSigners = tx.needsNonInvokerSigningBy();
 if (!missingSigners.includes(senderKeypair.publicKey())) {
 throw new Error("Sender not in required signers");
 }

 // Sign auth entries using basicNodeSigner
 const signer = basicNodeSigner(senderKeypair, networkPassphrase);
 await tx.signAuthEntries({
 address: senderKeypair.publicKey(),
 signAuthEntry: signer.signAuthEntry,
 expiration: tx.simulation.latestLedger + 60, // ~5 minutes
 });

 // Re-simulate to validate signatures (📌 Enforcing Mode)
 await tx.simulate();
 if (Api.isSimulationError(tx.simulation)) {
 throw new Error(`Signature validation failed: ${tx.simulation.error}`);
 }

## Rank 2: Invoke and deploy smart contracts with the InvokeHostFunctionOp operation
url: https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction | scope: research_chunk | date: 2026-07-30 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/central-jev/1790470394-ea614df8-cd83-4197-8cee-f00658b278bd/search-documents/0084.txt

## XDR Usage​

- SOROBAN_CREDENTIALS_SOURCE_ACCOUNT - this simply uses the signature of the transaction (or operation, if any) source account and hence doesn&#x27;t require any additional payload.

- SOROBAN_CREDENTIALS_ADDRESS - contains SorobanAddressCredentials with the following structure:
struct SorobanAddressCredentials
{
 SCAddress address;
 int64 nonce;
 uint32 signatureExpirationLedger;
 SCVal signature;
};

The fields of this structure have the following semantics:

- When address is the address that authorizes invocation.

- signatureExpirationLedger the ledger sequence number on which the signature expires. Signature is still considered valid on signatureExpirationLedger, but it is no longer valid on signatureExpirationLedger + 1. It is recommended to keep this as small as viable, as it makes the transaction cheaper.

- nonce is an arbitrary value that is unique for all the signatures performed by address until signatureExpirationLedger. A good approach to generating this is to just use a random value.

- signature is a structure containing the signature (or multiple signatures) that signed the 32-byte, SHA-256 hash of the ENVELOPE_TYPE_SOROBAN_AUTHORIZATION preimage (XDR). The signature structure is defined by the account contract corresponding to the Address (see below for the Stellar account signature structure).

SorobanAuthorizedInvocation defines a node in the authorized invocation tree:

struct SorobanAuthorizedInvocation
{
 SorobanAuthorizedFunction function;
 SorobanAuthorizedInvocation subInvocations<>;
};

union SorobanAuthorizedFunction switch (SorobanAuthorizedFunctionType type)
{
case SOROBAN_AUTHORIZED_FUNCTION_TYPE_CONTRACT_FN:
 SorobanAuthorizedContractFunction contractFn;
case SOROBAN_AUTHORIZED_FUNCTION_TYPE_CREATE_CONTRACT_HOST_FN:
 CreateContractArgs createContractHostFn;
};

struct SorobanAuthorizedContractFunction
{
 SCAddress contractAddress;
 SCSymbol functionName;
 SCVec args;
};

SorobanAuthorizedInvocation consists of the function that is being authorized (either contract function or a host function) and the authorized sub-invocations that function performs (if any).

SorobanAuthorizedFunction has two variants:

- SOROBAN_AUTHORIZED_FUNCTION_TYPE_CONTRACT_FN is a contract function that includes the address of the contract, name of the function being invoked, and arguments of the require_auth/require_auth_for_args call performed on behalf of the address. Note, that if require_auth[_for_args] wasn&#x27;t called, there shouldn&#x27;t be a SorobanAuthorizedInvocation entry in the transaction.

- SOROBAN_AUTHORIZED_FUNCTION_TYPE_CREATE_CONTRACT_HOST_FN is authorization for HOST_FUNCTION_TYPE_CREATE_CONTRACT or for create_contract host function called from a contract. It only contains the CreateContractArgs XDR structure corresponding to the created contract.

Building SorobanAuthorizedInvocation trees may be simplified by using the recording auth mode in Soroban&#x27;s simulateTransaction mechanism (see the docs for more details).

Stellar Account Signatures​
signatureArgs format is user-defined for the custom accounts, but it is protocol-defined for the Stellar accounts.

The signatures for the Stellar account are a vector of the following Soroban structures in the Soroban SDK format:

#[contracttype]
pub struct AccountEd25519Signature {
 pub public_key: BytesN<32>,
 pub signature: BytesN<64>,
}

JavaScript Usage​
There are a couple of helpful methods in the SDK to make dealing with authorization easier:

- Once you&#x27;ve gotten the authorization entries from simulateTransaction, you can use the authorizeEntry helper to "fill out" the empty entry accordingly. You will, of course, need the appropriate signer for each of the entries if you are in a multi-party situation.

const signedEntries = simTx.auth.map(async (entry) =>
 // In this case, you can authorize by signing the transaction with the
 // corresponding source account.
 entry.switch() ===
 xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount()
 ? entry
 : await authorizeEntry(
 entry,
 // The `signer` here will be unique for each entry, perhaps reaching out
 // to a separate entity.
 signer,
 currentLedger + 1000,
 Networks.TESTNET,
 ),
);

- If you, instead, want to build an authorization entry from scratch rather than relying on simulation, you can use authorizeInvocation, which will build the structure with the appropriate fields.

### Transaction resources​

Every Soroban transaction has to have a SorobanTransactionData transaction extension populated. This is needed to compute the Soroban resource fee.

The Soroban transaction data is defined as follows:

struct SorobanResources
{
 // The ledger footprint of the transaction.
 LedgerFootprint footprint;
 // The maximum number of instructions this transaction can use
 uint32 instructions;

 // The maximum number of bytes this transaction can read from disk backed entries
 uint32 diskReadBytes;
 // The maximum number of bytes this transaction can write to ledger
 uint32 writeBytes;
};

struct SorobanResourcesExtV0
{
 // Vector of indices representing what Soroban
 // entries in the footprint are archived, based on the
 // order of keys provided in the readWrite footprint.
 uint32 archivedSorobanEntries<>;
};

struct SorobanTransactionData
{
 union switch (int v)
 {
 case 0:
 void;
 case 1:
 SorobanResourcesExtV0 resourceExt;
 } ext;
 SorobanResources resources;
 // Amount of the transaction `fee` allocated to the Soroban resource fees.
 int64 resourceFee;
};

This data comprises the Soroban resources and the resourceFee. The resourceFee is the portion of the transaction fee allocated to Soroban resource fees. It has a non-refundable part (fees for instructions, ledger I/O, and transaction size) and a refundable part that is charged based on actual consumption of refundable resources: the contract events emitted by the transaction, the return value of the host function invocation, and the ledger space rent.

## Rank 3: Memo Authorization for Soroban
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0064.md | scope: research_chunk | date: 2025-01-09 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/central-jev/1790470394-ea614df8-cd83-4197-8cee-f00658b278bd/search-documents/0037.txt

## Specification

### XDR Changes

This patch of XDR changes is based on the XDR files in commit `a41b2db15ea34a9f9da5326b996bb8a7ceb5740f` of stellar-xdr.

```diff mddiffcheck.ignore=true
 Stellar-ledger-entries.x |  3 ++-
 Stellar-transaction.x    | 27 ++++++++++++++++++++++++++-
 2 files changed, 28 insertions(+), 2 deletions(-)

diff --git a/Stellar-ledger-entries.x b/Stellar-ledger-entries.x
index 5bf4f9d..f0bf9ea 100644
--- a/Stellar-ledger-entries.x
+++ b/Stellar-ledger-entries.x
@@ -676,7 +676,8 @@ enum EnvelopeType
     ENVELOPE_TYPE_OP_ID = 6,
     ENVELOPE_TYPE_POOL_REVOKE_OP_ID = 7,
     ENVELOPE_TYPE_CONTRACT_ID = 8,
-    ENVELOPE_TYPE_SOROBAN_AUTHORIZATION = 9
+    ENVELOPE_TYPE_SOROBAN_AUTHORIZATION = 9,
+    ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_V2 = 10
 };
 
 enum BucketListType
diff --git a/Stellar-transaction.x b/Stellar-transaction.x
index 7d32481..763531c 100644
--- a/Stellar-transaction.x
+++ b/Stellar-transaction.x
@@ -569,10 +569,22 @@ struct SorobanAddressCredentials
     SCVal signature;
 };
 
+struct SorobanAddressCredentialsV2
+{
+    ExtensionPoint ext;
+
+    SCAddress address;
+    int64 nonce;
+    uint32 signatureExpirationLedger;
+    Memo txMemo;
+    SCVal signature;
+};
+
 enum SorobanCredentialsType
 {
     SOROBAN_CREDENTIALS_SOURCE_ACCOUNT = 0,
-    SOROBAN_CREDENTIALS_ADDRESS = 1
+    SOROBAN_CREDENTIALS_ADDRESS = 1,
+    SOROBAN_CREDENTIALS_ADDRESS_V2 = 2
 };
 
 union SorobanCredentials switch (SorobanCredentialsType type)
@@ -581,6 +593,8 @@ case SOROBAN_CREDENTIALS_SOURCE_ACCOUNT:
     void;
 case SOROBAN_CREDENTIALS_ADDRESS:
     SorobanAddressCredentials address;
+case SOROBAN_CREDENTIALS_ADDRESS_V2:
+    SorobanAddressCredentialsV2 addressV2;
 };
 
 /* Unit of authorization data for Soroban.
@@ -729,6 +743,17 @@ case ENVELOPE_TYPE_SOROBAN_AUTHORIZATION:
         uint32 signatureExpirationLedger;
         SorobanAuthorizedInvocation invocation;
     } sorobanAuthorization;
+case ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_V2:
+    struct
+    {
+        ExtensionPoint ext;
+
+        Hash networkID;
+        int64 nonce;
+        uint32 signatureExpirationLedger;
+        Memo txMemo;
+        SorobanAuthorizedInvocation invocation;
+    } sorobanAuthorizationV2;
 };
 
 enum MemoType
-- 
```

### Semantics

#### `SOROBAN_CREDENTIALS_ADDRESS_V2` credentials

A new type of of address credentials is introduced for `SorobanAuthorizationEntry`: `SOROBAN_CREDENTIALS_ADDRESS_V2` of type `SorobanAddressCredentialsV2`. The semantics of the new credentials is identical to the semantics of `SOROBAN_CREDENTIALS_ADDRESS` defined by [CAP-46-11](./cap-0046-11.md#authorization-payload-in-transaction) with the following exceptions:

- During the authorization process the value of `txMemo` field is validated against the memo of the transaction being executed. In case of a mismatch, the authorization is considered to have failed.
- SHA-256 hash of `ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_V2` envelope must be signed instead of `ENVELOPE_TYPE_SOROBAN_AUTHORIZATION` envelope used for `SOROBAN_CREDENTIALS_ADDRESS` signatures. The envelope is built using the respectively named fields from `SorobanAddressCredentialsV2`, and the target network id that the authorization has to be used for.
- No-op extension point has been added for the future extensions to both the authorization entry and the envelope

#### `SOROBAN_CREDENTIALS_ADDRESS` credentials remain supported

The first version of the credentials will still be supported by the protocol. It can be considered to be semantically equivalent to `SOROBAN_CREDENTIALS_ADDRESS_V2` with `txMemo` set to `MEMO_NONE` (i.e. it may only pass authorization check when the transaction memo is `MEMO_NONE`).

#### Muxed accounts restrictions

In order to avoid confusion between memos and muxed source accounts, transactions that contain both of:

- Muxed transaction source account and/or muxed operation source account
- At least one Soroban authorization entry with credentials that are not set to `SOROBAN_CREDENTIALS_SOURCE_ACCOUNT`

are considered invalid and thus they won't be ever included into ledger.

## Rank 4: Stellar’s composable auth model
url: https://stellar.org/blog/foundation-news/stellars-composable-auth-model | scope: research_chunk | date: 2026-05-05 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/central-jev/1790470394-ea614df8-cd83-4197-8cee-f00658b278bd/search-documents/0021.txt

## Detachable auth

In most blockchains, authorization is welded to the transaction. The person who signs the transaction is the person who pays fees, and that&#x27;s the person who authorized the entire operation.

Ethereum illustrates the tension well. The base model is msg.sender: whoever sent the transaction (and paid gas) is the authorized party. This is simple but rigid: if Alice wants Bob to act on her behalf, there&#x27;s no built-in way to express that. The ecosystem bolted on solutions over time. ERC-20 approve/transferFrom lets you pre-authorize a spender, but it&#x27;s a separate on-chain transaction with its own gas cost, and over-approval is a well-known footgun. EIP-2612 permit added off-chain signatures for approvals, which is closer to detachable auth, but it&#x27;s token-specific, not a general framework. ERC-4337 account abstraction introduced a whole parallel transaction pipeline (bundlers, paymasters, user operations) to decouple fee payment from authorization. Each of these is a point solution layered on top of a model that didn&#x27;t account for the problem originally.

Stellar handles all of these cases (msg.sender-style caller auth, permit-style detached signatures, and fee abstraction) with a mechanism built into Stellar’s smart contract runtime, Soroban.

A Stellar transaction carries an array of SorobanAuthorizationEntry items alongside the contract invocation. Each entry is independently signed by the party it represents, and is structurally separate from the transaction envelope signature. This means:

- The authorizer and the fee-payer may be different people. A user signs an auth entry covering a specific contract call. They hand that signed entry to a relayer. The relayer wraps it in a transaction, pays the fees with their own account, signs the envelope, and submits. The user never touches XLM for gas.
- Auth entries are portable. A signed auth entry can be passed around, stored, and included in a transaction by anyone. It&#x27;s bound to a specific network, a nonce (for replay prevention), an expiration ledger, and the exact auth tree, but not to a particular transaction or fee-payer.
- Multi-party transactions are natural. When a swap requires both Alice and Bob to authorize token transfers, each signs their own auth entry independently. A coordinator collects both entries, puts them in a single transaction, and submits. No multi-sig ceremony, no sequential signing.

The transaction structure looks like this:

TransactionEnvelope
 Transaction
 Operations[0]: InvokeHostFunctionOp
 hostFunction: invokeContract(swap, "execute",
 [alice, bob, token_a, 100, token_b, 50])
 auth: [
 SorobanAuthorizationEntry { // Alice&#x27;s auth
 credentials: ADDRESS { alice, nonce, expiration, signature },
 rootInvocation: swap.execute(alice, bob, token_a, 100, token_b, 50)
 └── token_a.transfer(alice, bob, 100)
 },
 SorobanAuthorizationEntry { // Bob&#x27;s auth
 credentials: ADDRESS { bob, nonce, expiration, signature },
 rootInvocation: swap.execute(alice, bob, token_a, 100, token_b, 50)
 └── token_b.transfer(bob, alice, 50)
 }
 ]
 Signatures: [envelope_sig_from_coordinator] // fee-payer
Alice and Bob each signed only the auth tree relevant to them. The coordinator signed the transaction envelope. Three independent signatures, one atomic transaction.

Note that for simple cases, when the transaction source account 

is the authorizer, you can use SOROBAN_CREDENTIALS_SOURCE_ACCOUNT credentials, which derive authorization from the envelope signature. This avoids a separate auth entry signature but sacrifices detachability. It&#x27;s useful for simple cases where the caller pays their own fees and a single authorizer is involved with the transaction.

## Rank 4 companion: (same URL)
url: https://stellar.org/blog/foundation-news/stellars-composable-auth-model | scope: ai_summary | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/central-jev/1790470394-ea614df8-cd83-4197-8cee-f00658b278bd/search-documents/0119.txt

Stellar’s composable auth model

Stellar's Soroban smart contract runtime features a composable authorization model that decouples authorization from fee payment, enabling sponsored transactions, multi-party swaps, and programmable accounts through detachable auth entries and flexible verification logic.

Stellar's authorization framework in Soroban separates what needs authorization (declared by contracts via require_auth), how it's verified (handled by the runtime), and the authorization data itself (detachable from transactions). This design enables sponsored transactions where a relayer pays fees while a user authorizes specific operations, atomic multi-party swaps where participants sign independent auth entries, and programmable contract accounts with custom verification logic like multi-sig or spending limits. Auth trees capture only the functions that call require_auth for an address, providing signers visibility into exactly what they're authorizing. Automatic invoker auth allows direct contract-to-contract calls to succeed without additional signatures, enabling frictionless composition across protocols.

## Rank 5: Authentication delegation and address-bound Soroban credentials
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071.md | scope: research_chunk | date: 2025-09-10 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/central-jev/1790470394-ea614df8-cd83-4197-8cee-f00658b278bd/search-documents/0083.txt

## Specification

The detailed specifications are split into the following sub-CAPs:

- [CAP-71-01 - Authentication delegation for custom accounts](./cap-0071-01.md)
- [CAP-71-02 - Address-bound Soroban address credentials](./cap-0071-02.md)

### XDR changes

This is the final cumulative XDR diff for the CAP-71 split, based on the XDR files in commit `cff714a5ebaaaf2dac343b3546c2df73f0b7a36e` of stellar-xdr.

```diff mddiffcheck.ignore=true
diff --git a/Stellar-ledger-entries.x b/Stellar-ledger-entries.x
index b9a9a16..348311c 100644
--- a/Stellar-ledger-entries.x
+++ b/Stellar-ledger-entries.x
@@ -664,7 +664,8 @@ enum EnvelopeType
    ENVELOPE_TYPE_OP_ID = 6,
    ENVELOPE_TYPE_POOL_REVOKE_OP_ID = 7,
    ENVELOPE_TYPE_CONTRACT_ID = 8,
-    ENVELOPE_TYPE_SOROBAN_AUTHORIZATION = 9
+    ENVELOPE_TYPE_SOROBAN_AUTHORIZATION = 9,
+    ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS = 10
 };
 
 enum BucketListType
diff --git a/Stellar-transaction.x b/Stellar-transaction.x
index c22f5b4..e6c3b10 100644
--- a/Stellar-transaction.x
+++ b/Stellar-transaction.x
@@ -569,10 +569,24 @@ struct SorobanAddressCredentials
    SCVal signature;
 };
 
+struct SorobanDelegateSignature {
+    SCAddress address;
+    SCVal signature;
+    SorobanDelegateSignature nestedDelegates<>;
+};
+
+struct SorobanAddressCredentialsWithDelegates
+{
+    SorobanAddressCredentials addressCredentials;
+    SorobanDelegateSignature delegates<>;
+};
+
 enum SorobanCredentialsType
 {
    SOROBAN_CREDENTIALS_SOURCE_ACCOUNT = 0,
-    SOROBAN_CREDENTIALS_ADDRESS = 1
+    SOROBAN_CREDENTIALS_ADDRESS = 1,
+    SOROBAN_CREDENTIALS_ADDRESS_V2 = 2,
+    SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES = 3
 };
 
 union SorobanCredentials switch (SorobanCredentialsType type)
@@ -581,6 +595,10 @@ case SOROBAN_CREDENTIALS_SOURCE_ACCOUNT:
    void;
 case SOROBAN_CREDENTIALS_ADDRESS:
    SorobanAddressCredentials address;
+case SOROBAN_CREDENTIALS_ADDRESS_V2:
+    SorobanAddressCredentials addressV2;
+case SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES:
+    SorobanAddressCredentialsWithDelegates addressWithDelegates;
 };
 
 /* Unit of authorization data for Soroban.
@@ -731,6 +749,15 @@ case ENVELOPE_TYPE_SOROBAN_AUTHORIZATION:
        uint32 signatureExpirationLedger;
        SorobanAuthorizedInvocation invocation;
    } sorobanAuthorization;
+case ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS:
+    struct
+    {
+        Hash networkID;
+        int64 nonce;
+        uint32 signatureExpirationLedger;
+        SCAddress address;
+        SorobanAuthorizedInvocation invocation;
+    } sorobanAuthorizationWithAddress;
 };
 
 enum MemoType
```

## Rank 6: Soroban smart contract system overview
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046.md | scope: research_chunk | date: 2022-10-27 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/central-jev/1790470394-ea614df8-cd83-4197-8cee-f00658b278bd/search-documents/0266.txt

## Specification

+enum HostFunctionType
+{
+    HOST_FUNCTION_TYPE_INVOKE_CONTRACT = 0,
+    HOST_FUNCTION_TYPE_CREATE_CONTRACT = 1,
+    HOST_FUNCTION_TYPE_UPLOAD_CONTRACT_WASM = 2
+};
+
+enum ContractIDPreimageType
+{
+    CONTRACT_ID_PREIMAGE_FROM_ADDRESS = 0,
+    CONTRACT_ID_PREIMAGE_FROM_ASSET = 1
+};
+ 
+union ContractIDPreimage switch (ContractIDPreimageType type)
+{
+case CONTRACT_ID_PREIMAGE_FROM_ADDRESS:
+    struct
+    {
+        SCAddress address;
+        uint256 salt;
+    } fromAddress;
+case CONTRACT_ID_PREIMAGE_FROM_ASSET:
+    Asset fromAsset;
+};
+
+struct CreateContractArgs
+{
+    ContractIDPreimage contractIDPreimage;
+    ContractExecutable executable;
+};
+
+struct InvokeContractArgs {
+    SCAddress contractAddress;
+    SCSymbol functionName;
+    SCVal args<>;
+};
+
+union HostFunction switch (HostFunctionType type)
+{
+case HOST_FUNCTION_TYPE_INVOKE_CONTRACT:
+    InvokeContractArgs invokeContract;
+case HOST_FUNCTION_TYPE_CREATE_CONTRACT:
+    CreateContractArgs createContract;
+case HOST_FUNCTION_TYPE_UPLOAD_CONTRACT_WASM:
+    opaque wasm<>;
+};
+
+enum SorobanAuthorizedFunctionType
+{
+    SOROBAN_AUTHORIZED_FUNCTION_TYPE_CONTRACT_FN = 0,
+    SOROBAN_AUTHORIZED_FUNCTION_TYPE_CREATE_CONTRACT_HOST_FN = 1
+};
+
+union SorobanAuthorizedFunction switch (SorobanAuthorizedFunctionType type)
+{
+case SOROBAN_AUTHORIZED_FUNCTION_TYPE_CONTRACT_FN:
+    InvokeContractArgs contractFn;
+case SOROBAN_AUTHORIZED_FUNCTION_TYPE_CREATE_CONTRACT_HOST_FN:
+    CreateContractArgs createContractHostFn;
+};
+
+struct SorobanAuthorizedInvocation
+{
+    SorobanAuthorizedFunction function;
+    SorobanAuthorizedInvocation subInvocations<>;
+};
+
+struct SorobanAddressCredentials
+{
+    SCAddress address;
+    int64 nonce;
+    uint32 signatureExpirationLedger;    
+    SCVal signature;
+};
+
+enum SorobanCredentialsType
+{
+    SOROBAN_CREDENTIALS_SOURCE_ACCOUNT = 0,
+    SOROBAN_CREDENTIALS_ADDRESS = 1
+};
+
+union SorobanCredentials switch (SorobanCredentialsType type)
+{
+case SOROBAN_CREDENTIALS_SOURCE_ACCOUNT:
+    void;
+case SOROBAN_CREDENTIALS_ADDRESS:
+    SorobanAddressCredentials address;
+};
+
+/* Unit of authorization data for Soroban.
+
+   Represents an authorization for executing the tree of authorized contract 
+   and/or host function calls by the user defined by `credentials`.
+*/
+struct SorobanAuthorizationEntry
+{
+    SorobanCredentials credentials;
+    SorobanAuthorizedInvocation rootInvocation;
+};
+
+/* Upload Wasm, create, and invoke contracts in Soroban.
+
+    Threshold: med
+    Result: InvokeHostFunctionResult
+*/
+struct InvokeHostFunctionOp
+{
+    // Host function to invoke.
+    HostFunction hostFunction;
+    // Per-address authorizations for this host function.
+    SorobanAuthorizationEntry auth<>;
+};
+
+/* Bump the expiration ledger of the entries specified in the readOnly footprint
+   so they'll expire at least ledgersToExpire ledgers from lcl.
+
+    Threshold: med
+    Result: BumpFootprintExpirationResult
+*/
+struct BumpFootprintExpirationOp
+{
+    ExtensionPoint ext;
+    uint32 ledgersToExpire;
+};
+
+/* Restore the expired or evicted entries specified in the readWrite footprint.
+
+    Threshold: med
+    Result: RestoreFootprintOp
+*/
+struct RestoreFootprintOp
+{
+    ExtensionPoint ext;
+};
+
 /* An operation is the lowest unit of work that a transaction does */
 struct Operation
 {
@@ -523,6 +665,12 @@
         LiquidityPoolDepositOp liquidityPoolDepositOp;
     case LIQUIDITY_POOL_WITHDRAW:
         LiquidityPoolWithdrawOp liquidityPoolWithdrawOp;
+    case INVOKE_HOST_FUNCTION:
+        InvokeHostFunctionOp invokeHostFunctionOp;
+    case BUMP_FOOTPRINT_EXPIRATION:
+        BumpFootprintExpirationOp bumpFootprintExpirationOp;
+    case RESTORE_FOOTPRINT:
+        RestoreFootprintOp restoreFootprintOp;
     }
     body;
 };
@@ -540,11 +688,25 @@
     struct
     {
         AccountID sourceAccount;
-        SequenceNumber seqNum;
+        SequenceNumber seqNum; 
         uint32 opNum;
         PoolID liquidityPoolID;
         Asset asset;
     } revokeID;
+case ENVELOPE_TYPE_CONTRACT_ID:
+    struct
+    {
+        Hash networkID;
+        ContractIDPreimage contractIDPreimage;
+    } contractID;
+case ENVELOPE_TYPE_SOROBAN_AUTHORIZATION:
+    struct
+    {
+        Hash networkID;
+        int64 nonce;
+        uint32 signatureExpirationLedger;
+        SorobanAuthorizedInvocation invocation;
+    } sorobanAuthorization;
 };

 enum MemoType
@@ -632,8 +794,40 @@
     PreconditionsV2 v2;
 };

-// maximum number of operations per transaction
-const MAX_OPS_PER_TX = 100;
+// Ledger key sets touched by a smart contract transaction.
+struct LedgerFootprint
+{
+    LedgerKey readOnly<>;
+    LedgerKey readWrite<>;
+};
+
+// Resource limits for a Soroban transaction.
+// The transaction will fail if it exceeds any of these limits.
+struct SorobanResources
+{   
+    // The ledger footprint of the transaction.
+    LedgerFootprint footprint;
+    // The maximum number of instructions this transaction can use
+    uint32 instructions; 
+
+    // The maximum number of bytes this transaction can read from ledger
+    uint32 readBytes;
+    // The maximum number of bytes this transaction can write to ledger
+    uint32 writeBytes;
+
+    // Maximum size of the contract events (serialized to XDR) this transaction
+    // can emit.
+    uint32 contractEventsSizeBytes;
+};
+
+// The transaction extension for Soroban.
+struct SorobanTransactionData
+{
+    ExtensionPoint ext;
+    SorobanResources resources;
+    // Portion of transaction `fee` allocated to refundable fees.
+    int64 refundableFee;
+};

 // TransactionV0 is a transaction with the AccountID discriminant stripped off,
 // leaving a raw ed25519 public key to identify the source account. This is used
@@ -695,6 +889,8 @@
     {
     case 0:
         void;
+    case 1:
+        SorobanTransactionData sorobanData;
     }
     ext;
 };
@@ -1588,6 +1784,67 @@
     void;
 };

## Rank 7: js-stellar-sdk v16.1.0
url: https://github.com/stellar/js-stellar-sdk/releases/tag/v16.1.0 | scope: research_chunk | date: 2026-07-22 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/central-jev/1790470394-ea614df8-cd83-4197-8cee-f00658b278bd/search-documents/0066.txt

## [v16.1.0](https://github.com/stellar/js-stellar-sdk/compare/v16.0.1...v16.1.0)

### Added
- `inspectAuthEntry(entry)`: decodes a `xdr.SorobanAuthorizationEntry` into a typed summary — credential type, authorizing address, nonce, `signatureExpirationLedger`, and a `signers` list covering top-level credentials and CAP-71 delegates. Adds the `AuthEntryInfo`, `AuthEntrySigner`, `AuthEntrySignature`, and `AuthEntryCredentialType` types ([#1529](https://github.com/stellar/js-stellar-sdk/pull/1529)).
- `checkAuthEntryReadiness(entry, currentLedgerSeq)`: reports whether an auth entry is ready to submit — `{ ready, expired, unsignedBy }` — as a pure decode with no network call ([#1529](https://github.com/stellar/js-stellar-sdk/pull/1529)).
- `Spec.nativeToScVal` now supports contract parameters typed as `Val` (`scSpecTypeVal`), so raw JS values can be passed to `Val`-typed arguments without building `xdr.ScVal` objects by hand ([#1485](https://github.com/stellar/js-stellar-sdk/pull/1485)).
- `rpc.Server.queryContract<T>(contractId, method, args?, networkPassphrase?)`: a one-line read-only contract call that returns `{ result, isReadCall }`, no transaction assembly or signing. Works for Wasm contracts and built-in Stellar Asset Contracts (SACs) ([#1502](https://github.com/stellar/js-stellar-sdk/pull/1502)).
- `rpc.Server.getContractMethods(contractId, networkPassphrase?)`: lists a contract's callable methods and their signatures. Adds the `Api.ContractMethod` and `Api.ContractMethodInput` types ([#1502](https://github.com/stellar/js-stellar-sdk/pull/1502)).
- `rpc.Server.getContractInstance(contractId)`: returns a contract's `xdr.ScContractInstance` ([#1501](https://github.com/stellar/js-stellar-sdk/pull/1501)).
- `contract.Client.from`, `fromWasm`, and `fromWasmHash` are now generic (`<T>`) and return `Client & T`, giving typed contract methods without code generation. `T` defaults to `unknown`, so untyped calls are unchanged ([#1502](https://github.com/stellar/js-stellar-sdk/pull/1502)).
- `ClientOptions.server`: pass an existing `rpc.Server` to `contract.Client.from` to reuse its transport instead of building a new one ([#1502](https://github.com/stellar/js-stellar-sdk/pull/1502)).
- `Keypair.signMessage(message)` and `Keypair.verifyMessage(message, signature)`: sign and verify arbitrary messages per [SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md), matching the Python and Java SDKs and stellar-cli ([#1513](https://github.com/stellar/js-stellar-sdk/pull/1513)).
- `TransactionFailedError`: raised by `Horizon.Server.submitTransaction` and `submitAsyncTransaction` when Horizon rejects a transaction with result codes. Extends `BadResponseError` and adds `getResultCodes()` and `getTransactionResult()` ([#1526](https://github.com/stellar/js-stellar-sdk/pull/1526)).

### Changed
- `HorizonApi.TransactionFailedResultCodes` gained the transaction result codes it was missing: `tx_bad_sponsorship`, `tx_bad_min_seq_age_or_gap`, `tx_malformed`, `tx_soroban_invalid`, and `tx_frozen_key_accessed` ([#1526](https://github.com/stellar/js-stellar-sdk/pull/1526)).
- `contract.Client.from` now supports built-in Stellar Asset Contracts (SACs), building the client from the embedded SAC spec instead of downloading Wasm ([#1501](https://github.com/stellar/js-stellar-sdk/pull/1501)).
- `rpc.Server.getContractWasmByContractId` now rejects a SAC with a structured `{ code: 400 }` error pointing to `contract.Client.from`. The not-found rejection is now `{ code: 404, message: "Could not obtain contract instance from server" }` ([#1501](https://github.com/stellar/js-stellar-sdk/pull/1501)).
- The UMD (`dist/`) build now sets `inlineDynamicImports` so the single-file bundle stays whole despite the SAC spec's lazy `import()` ([#1501](https://github.com/stellar/js-stellar-sdk/pull/1501)).

### Fixed
- `Horizon.Server.submitTransaction` and `submitAsyncTransaction` now reject with SDK error types on HTTP failures, as documented: a `TransactionFailedError` for Horizon result codes, a `BadResponseError` otherwise. The wrapping branch used to be unreachable, so failures leaked through as raw HTTP-client errors. `err.response.data` and `err.response.status` are unchanged; the original error is now preserved as `err.cause` ([#1526](https://github.com/stellar/js-stellar-sdk/pull/1526)).
- `Federation.Server` resolution methods (`resolveAddress`, `resolveAccountId`, `resolveTransactionId`, `forDomain`) had the same unreachable branch and now reject HTTP failures with `BadResponseError` ([#1526](https://github.com/stellar/js-stellar-sdk/pull/1526)).
- `contract.AssembledTransaction.needsNonInvokerSigningBy` now treats an empty `scvVec` signature as unsigned, matching the existing `scvVoid` check. Such entries used to count as already signed and were left off the list ([#1529](https://github.com/stellar/js-stellar-sdk/pull/1529)).
- `Spec.nativeToScVal` no longer misclassifies plain objects that have a `constructor` key, and handles null-prototype objects (`Object.create(null)`) ([#1485](https://github.com/stellar/js-stellar-sdk/pull/1485)).

## Rank 8: js-stellar-sdk v17.0.0 — v17.0.0: Protocol 28
url: https://github.com/stellar/js-stellar-sdk/releases/tag/v17.0.0 | scope: research_chunk | date: 2026-08-20 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/central-jev/1790470394-ea614df8-cd83-4197-8cee-f00658b278bd/search-documents/0043.txt

## [v17.0.0](https://github.com/stellar/js-stellar-sdk/compare/v16.2.0...v17.0.0): Protocol 28

* CAP-71 `SOROBAN_CREDENTIALS_ADDRESS_V2` credentials are now the default, on both ends of the auth flow. `rpc.Server.simulateTransaction`'s `useUpgradedAuth` and `authorizeInvocation`'s `authV2` both default to `true`, so simulation asks RPC to record v2 entries and `authorizeInvocation` builds them. Pass `false` to either one for the legacy `SOROBAN_CREDENTIALS_ADDRESS` format. Both flags are transitional and become no-ops when v2 is mandatory in protocol 28. Two consequences: code that reads the credential arm by hand must handle `addressV2` and not just `address` (or use `inspectAuthEntry`), and a hand-rolled signer that hardcodes the legacy `ENVELOPE_TYPE_SOROBAN_AUTHORIZATION` preimage now produces signatures the network rejects, so use `buildAuthorizationEntryPreimage` or `authorizeEntry`, which pick the address-bound payload off the entry. SDK-driven signing (`contract.Client`, `authorizeEntry`, `signAuthEntries`) needs no change ([#1562](https://github.com/stellar/js-stellar-sdk/issues/1562)).
* `simulateTransaction` now always sends `useUpgradedAuth` in the JSON-RPC request. It previously omitted the field when the flag was unset ([#1562](https://github.com/stellar/js-stellar-sdk/issues/1562)).

### Added
- `rpc.Server.getExternalRefWasmHash(ref)`: resolves a CAP-85 external executable reference to the 32-byte Wasm hash it names by reading the persistent tag entry on the owner contract ([#1577](https://github.com/stellar/js-stellar-sdk/pull/1577)).
- The XDR schema covers [CAP-83](https://stellar.org/protocol/cap-83) (empty transaction set values), adding a `stellarValueEmptyTxSet` arm to `xdr.StellarValueType` ([#1577](https://github.com/stellar/js-stellar-sdk/pull/1577)).
- The XDR schema covers [CAP-85](https://stellar.org/protocol/cap-85) (external contract executables), adding a `contractExecutableExternalRef` arm to `xdr.ContractExecutableType` — an `executableOwner` address plus a `tag` — and an `scvExecutableTag` arm to `xdr.ScValType` ([#1577](https://github.com/stellar/js-stellar-sdk/pull/1577)).
- `Operation.createCustomContract` can deploy from a [CAP-85](https://stellar.org/protocol/cap-85) external executable reference. Pass `externalRef` — either `{owner, tag}` (owner as a strkey or `Address`, tag as a string or raw bytes) or an `xdr.ContractExecutableExternalRef` pulled from an existing contract instance — instead of `wasmHash`; the two options are mutually exclusive. The owner must be a contract, since only a contract can hold the persistent tag entry that names the WASM, and a binary tag passes through undecoded ([#1665](https://github.com/stellar/js-stellar-sdk/pull/1665)).
- `contract.Client.deploy` accepts the same `externalRef` option in place of `wasmHash`. The reference is resolved on-chain (via `rpc.Server.getExternalRefWasmHash`) to fetch the contract spec for constructor arguments, while the deploy operation itself carries the external reference, so the deployed contract keeps following the tag. Generated bindings (`BindingGenerator`) emit a `deploy` method with the same option, and the `ExternalExecutableRef` type is exported from the package root and from `@stellar/stellar-sdk/contract` ([#1665](https://github.com/stellar/js-stellar-sdk/pull/1665)).
- `xdr.encodeArray` / `xdr.decodeArray`: encode or decode a whole list of XDR values as one length-prefixed blob (a 4-byte count, then the elements). This is the wire format of the array typedefs the XDR rebuild removed (see Breaking Changes), so `xdr.LedgerEntryChanges.fromXDR(feeMetaXdr, "base64")` becomes `xdr.decodeArray(xdr.LedgerEntryChange, feeMetaXdr, "base64")`. Both work with any XDR class and take an optional `XdrArrayOptions` with `maxLength` (element-count cap, for bounded arrays like `peers<25>`) and `maxDepth` ([#1660](https://github.com/stellar/js-stellar-sdk/pull/1660)).
- `rpc.Server.prepareTransaction` takes an optional `useUpgradedAuth` parameter, since its internal simulation now requests v2 credentials by default. Pass `false` for the legacy v1 format ([#1562](https://github.com/stellar/js-stellar-sdk/issues/1562)).

## Rank 9: Smart Contract Host Functionality: Secp256r1 Verification
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0051.md | scope: research_chunk | date: 2023-01-30 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/central-jev/1790470394-ea614df8-cd83-4197-8cee-f00658b278bd/search-documents/0060.txt

## Specification

In all signing algorithms the payload to sign is produced by concatenating the
webauthn authenticator data, and a SHA-256 hash of the client data JSON. The
client data JSON contains several fields, one being the `challenge` field, that
an application requesting a signature can set. The challenge provided by an
application is base64 url encoded in the `challenge` field of the client data
JSON.

For example, a client data JSON:
```json
{
  "type":"webauthn.get",
  "challenge":"hJHFvaaoU7qkcH9kML46shLL_btpYGCA6ty3ie0M1Qw",
  "origin":"http://localhost:4507",
  "crossOrigin":false
}
```

For Stellar transactions intended to be authenticated by a webauthn
signature in a Soroban custom account, this challenge can be the SHA-256 hash of
the `HashIDPreimage` `ENVELOPE_TYPE_SOROBAN_AUTHORIZATION`.

In the ed25519 algorithm the payload as-is is passed to the signature verification function.

In the ECDSA secp256r1 algorithm the payload is hashed using SHA-256, and the hash is passed to the verification function.

It could be argued that adding secp256r1 signature verification is insufficient
to implement webauthn signature verification in a contract because verification
also requires JSON and base64 url support, neither of which are supported by the
Soroban host functions.

There are some aspects of Webauthn that are discussed below by the proposal.
Even though the concerns are not critical concerns of the proposal of secp256r1
alone, the proposals is primarily motivated by Webauthn, and the concerns below
establish whether this proposal alone would be sufficient to establish a
Webauthn contract on Soroban.

##### Base64 URL Encoding

It is possible to embed a small and efficient fixed width base64 url encoder
into a contract. Therefore the lack of native base64 URL encoding in the Soroban
environmen host interface is not a limiting factor. See
[leighmcculloch/soroban-base64].

##### JSON

It is possible to embed the `serde-json-core` crate for decoding a message.
There are some limitations depending if the alloc feature of the `soroban-sdk`
is used or not. The limitations are not prohibitive. See
[leighmcculloch/soroban-json].

Also, it is reasonable to take the position that the limited verification of
client data JSON, which is discussed at length in the specification, means that
a fully fledged JSON parser is not required.

The specification says Relying Parties (RP) should handle key reordering and new
values being introduced. But the specification also goes to great length to
detail how the client data json is a subset of JSON, and a limited resource
parser can be written so as to verify the client data JSON.

Therefore, multilpe options exists appealing to different risk and costs
appetites.

##### Challenge Suitability

**The statements in this section must be verified.**

The [Webauthn] specification requires that the challenge be randomized to avoid
replay. The contract is the Relying Party (RP) in the authentication ceremony.
Therefore the RP is supposed to select a randomly generated challenge value.
However, as a contract existing on chain, this is not possible. Instead it can
be stated that the challenge will be random preventing replay because the RP by
requires that the challenge be a hash of the Soroban Authorization, and best
practice requires that any authenticating client select a random nonce for the
Soroban Authorization.

##### Signature Counters Utility

**The statements in this section must be verified.**

The [Webauthn] specification allows an authenticator to keep track of a
signature counter and to communicate that counter to the RP via the
authenticator data that is part of data that is signed.

Relying Parties (RP) are encouraged to use the signature counter as signal to
whether the authenticator has been inappropriately cloned. An RP would identify
that there exists a cloned authenticator by seeing the counter go backwards.

It's worth noting that an RP wouldn't be able to identify which authenticator
was the cloned authenticator, and only that one existed.

If a contract detected this scenario it wouldn't be able to take any independent
action such as locking the account, as it would have no way to identify which
authenticator was cloned. A contract might have a backup credential that could
be used to unlock it in this situation, but that is out-of-scope of this
proposal.

## Rank 10: Stellar Zipper, Protocol 27 Upgrade Guide
url: https://stellar.org/blog/foundation-news/stellar-zipper-protocol-27-upgrade-guide | scope: research_chunk | date: 2026-06-04 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/central-jev/1790470394-ea614df8-cd83-4197-8cee-f00658b278bd/search-documents/0068.txt

## What’s New in Zipper

The following is a brief summary of what’s included in Protocol 27.

Authentication delegation for custom accounts (CAP-0071-01)What it does. Adds a first-class protocol mechanism for custom (smart contract) accounts to delegate their authentication logic to other addresses. Two new host functions are introduced: delegate_account_auth, which may be called inside a custom account’s __check_auth function to delegate authentication to a specified address, and get_delegated_signers_for_current_auth_check, which returns the list of delegated signer addresses populated in the current authorization entry.

A new credential type, SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES, allows all delegated signers and their (potentially nested) signatures to be bundled into a single authorization entry. This eliminates the need for a separate authorization entry per delegated signer, reducing transaction size and simplifying simulation. Delegation can be nested recursively, so any account—including ones with delegated signers of their own—can serve as a delegate.

The signature payload for this credential type uses a new ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS envelope, which explicitly binds the payload to the top-level account address, preventing cross-account signature replay.

Why it matters. The underlying capability—delegating authentication from a custom account to another address—already existed in the protocol, but only as an accidental side effect of the authorization framework design. In practice it was difficult to use: simulation required manually constructing inner authorization payloads and running multiple simulation passes; every delegated signer required its own authorization entry with its own nonce, increasing transaction cost; and forwarding authorization context to delegates bloated transaction size unnecessarily. Zipper makes delegation a proper, first-class feature that is dramatically simpler to implement correctly.

Who should care. Soroban developers building smart accounts—wallets, multisig schemes, account abstraction—will see the most direct benefit. Delegation goes from being a fragile workaround to a supported, efficient pattern. Transaction sizes shrink, simulation simplifies, and the boilerplate around payload construction largely disappears.

Developers following the broader account abstraction roadmap should also pay attention. CAP-0071-01 is explicitly foundational to CAP-0072, which adds contract-based authentication to classic Stellar (G-) accounts. The delegation mechanism introduced here is the same one that more visible features in future protocols will depend on.

End users and wallet holders benefit indirectly: cheaper transactions and more flexible account designs (social recovery, delegated signing keys, modular multisig) become practical to build.

Address-bound Soroban address credentials (CAP-0071-02)What it does. Introduces SOROBAN_CREDENTIALS_ADDRESS_V2, a new credential type that uses the same ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS signature payload introduced in CAP-0071-01. Unlike the existing SOROBAN_CREDENTIALS_ADDRESS, the new payload explicitly includes the signer’s address, preventing replay attacks between accounts that share private keys when the invocation payload does not otherwise bind the signer address.

Clients have some time to adopt the new credential type after the Protocol 27 upgrade; there is no requirement to migrate immediately. The existing SOROBAN_CREDENTIALS_ADDRESS type remains valid until the Protocol 28 upgrade.

Why it matters. The existing credential type is safe for the vast majority of use cases—the vulnerability it closes is narrow, requiring both shared private keys across accounts and an invocation payload that doesn’t bind the signer address. This CAP closes that gap in a non-disruptive way, offering a migration path rather than forcing an immediate switch.

Who should care. Developers building applications where multiple accounts may share keys, or who want to adopt a more conservative security posture, should plan to migrate to SOROBAN_CREDENTIALS_ADDRESS_V2 after the Protocol 27 upgrade. For everyone else, this is a low-urgency improvement to be aware of.

## Rank 10 companion: (same URL)
url: https://stellar.org/blog/foundation-news/stellar-zipper-protocol-27-upgrade-guide | scope: ai_summary | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/central-jev/1790470394-ea614df8-cd83-4197-8cee-f00658b278bd/search-documents/0188.txt

Stellar Zipper, Protocol 27 Upgrade Guide

Protocol 27 Zipper upgrade launches July 8 with authentication delegation for smart accounts (CAP-0071), streamlining multisig implementations and reducing transaction costs. SDKs release June 5-11, testnet upgrade June 18. Developers must review breaking changes and update dependencies before mainnet vote.

Stellar Protocol 27 Zipper introduces authentication delegation for custom smart accounts via CAP-0071-01, enabling wallets and multisig schemes to delegate signing to other addresses without requiring separate authorization entries per signer. Signature payloads now explicitly bind to the top-level account address, preventing cross-account replay attacks. CAP-0071-02 adds address-bound Soroban credentials (V2), closing a narrow replay vulnerability. Release timeline: Stellar Core June 5, RPC and Galexie June 10, SDKs June 5-11, Horizon June 12, testnet upgrade June 18, mainnet protocol vote July 8. Developers should review breaking changes immediately and update SDK dependencies before mainnet vote. Key change: @stellar/stellar-base consolidates into @stellar/stellar-sdk.

