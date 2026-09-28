# Evidence for: For Soroban authorization, what must a wallet inspect in every nested invocation before signing a simulation result, and can the RPC supplied expiration ledger be trusted as an independent short lifetime guarantee?

Contents (section: first line):
- Rank 1: Invoke and deploy smart contracts with the InvokeHostFunctionOp operation: line 16
- Rank 2: OpenZeppelin Stellar Contracts Library — OpenZeppelin (Stellar Contracts Library v0.3.0-rc.2 Audit): line 152
- Rank 3: Soroban smart contract system overview: line 240
- Rank 4: Transaction Simulation: line 479
- Rank 5: passkey-kit: Passkey Kit: line 591
- Rank 6: Moonlight — Runtime Verification (Moonlight core): line 634
- Rank 7: Signing Soroban contract invocations: line 737
- Rank 8: Authorization: line 752
- Rank 8 companion: (same URL): line 823
- Rank 9: colibri: SEP-41 Token Contract: line 993
- Rank 10: Stellar’s composable auth model: line 1015

## Rank 1: Invoke and deploy smart contracts with the InvokeHostFunctionOp operation
url: https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction | scope: research_chunk | date: 2026-07-30 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/jev/1790482309-a4b85cf3-32a1-41db-b3cc-63d3d56535b1/search-documents/0128.txt

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

## Rank 2: OpenZeppelin Stellar Contracts Library — OpenZeppelin (Stellar Contracts Library v0.3.0-rc.2 Audit)
url: https://stellarsecurityportal.com/report/35 | scope: research_chunk | date: 2025-07-09 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/jev/1790482309-a4b85cf3-32a1-41db-b3cc-63d3d56535b1/search-documents/0230.txt

## Medium## Severity

functions along with a warning that these functions do not implement any authorization. 
TTL Extension-Only Policy May Exceed Intended Expiration **transfer_role ** 
The current documentation for implies that setting transfer_role live_until_ledger 
will cause the pending role entry to expire exactly at that ledger. In reality, Soroban’s 
can **only ** increase an entry’s TTL if its remaining TTL is below the given threshold. extend_ttl 
It cannot shorten or reset a larger, default TTL. As a result, when live_for = 
is smaller than the temporary entry’s default live_until_ledger – current_ledger 
TTL, the call to 
e.storage().temporary().extend_ttl(pending_key, live_for, live_fo 
has no effect. The entry will then remain active until its original TTL elapses, not at 
, causing potential user confusion. live_until_ledger 
To correct this misleading documentation, consider updating the function’s comments to explicitly 
warn that: 
is an **upper bound ** rather than a guaranteed expiration time live_until_ledger 
Soroban’s TTL policy **only extends ** a key’s TTL and **cannot reduce ** an existing TTL 
if the computed is shorter than the default minimum TTL, the entry will outlive live_for 
live_until_ledger 
Including these clariﬁcations in the documentation will help ensure developers understand that 
actual expiration may exceed the speciﬁed ledger. 
**Update: ** Resolved in pull request #323 at commit 72053cb. 
Misleading and Inaccurate Documentation 
Throughout the codebase, multiple instances of misleading and/or inaccurate documentation were 
identiﬁed: 
1. The trait’s documentation claims that a non‐allowlisted account FungibleAllowList 
cannot execute transfers or approvals. However, in practice, a non‐allowlisted spender can 

still transfer tokens on behalf of an approved holder. Likewise, the FungibleBlockList 
documentation states that blocked accounts cannot transfer or approve tokens, yet 
blocklisted spenders are able to transfer tokens they have already been approved to move. 
Consider updating both trait descriptions to clarify that these lists only restrict direct 
operations by non‐listed accounts and allow transfers performed via existing approvals. 
Alternatively, consider changing the implementation so it reﬂects the documentation. 
2. Across the codebase, is being used inconsistently. For example, caller 
does not accept a parameter, so references to enforce_admin_auth caller 
actually denote the transaction invoker. Choose one term (e.g., “invoker”) and caller 
apply it uniformly throughout the documentation to eliminate ambiguity. 
3. The Royalties trait is described as “following the ERC-2981 standard”. However, since ERC- 
2981 is EVM-speciﬁc, rephrase the comment to state that this implementation is inspired by 
ERC-2981 and adapts its logic for Stellar’s environment. 
4. The documentation for the macro shows an example expansion that #[only_owner] 
does not match the code injected by the macro. The real expansion is: 
rust stellar_ownable::enforce_owner_auth(e); 
Amend the example to reﬂect this exact injected call. 
Applying these changes will ensure that the documentation remains accurate, coherent, and 
aligned with the actual behavior of the codebase. 
**Update: ** Resolved in pull request #307 at commit 14813be and pull request #329 at commit 
68397ff. 
# Notes&Additional
# Information

Inconsistent Folder Structure 
Unlike other libraries in the project that separate implementation ( ) from tests src/*.rs 
( ), traits such as place both public functions and src/test.rs crypto hashable.rs 
tests in the same ﬁle. 

To improve the consistency and clarity of the codebase, consider aligning the directory crypto 
with the overall structure by moving the tests into a separate ﬁle. 
**Update: ** Resolved in pull request #321 at commit 79af2d9. 
Inconsistency in Panic Handling 
There is an inconsistency in how the codebase handles panics related to missing keys and 
authorization failures. 
For example, the function retrieves the key from instance storage and get_admin Admin 
panics directly if the key is not found. This function is used within , enforce_admin_auth 
which performs an implicit panic on failed authorization without surfacing a meaningful or 
structured error. In contrast, the function returns if the key is get_owner None Owner 
missing. When used in , it checks authorization and panics with a enforce_owner_auth 
error. However, this error might be misleading if the actual problem is that the NotAuthorized 
owner key does not exist. 
Consider standardizing the handling of missing keys and failed authorizations by using 
with clear and distinct error messages. panic_with_error! 
**Update: ** Resolved in pull request #326 at commit 9a396fe. 
Potentially Increasing Constants 
Currently, all TTL threshold and extension amount values are deﬁned in a single ﬁle, 
. While this works for now, as the codebase and number of libraries constants/src/lib.rs 
grow, this centralized approach may become harder to maintain. Managing all constants in one 
location can lead to readability issues. 
Consider modularizing the constants in by introducing a dedicated constants/src/lib.rs 
ﬁle at each relevant directory or module level. This would promote better constants.rs 
organization, encapsulation, and easier maintainability as the project evolves. 
**Update: ** Acknowledged, will resolve. The OpenZeppelin Stellar development team stated: 
This is a good suggestion. But we are planning to do that when the project grows. Right now, this 
will add unnecessary complexity to the project. It is more compact as it is.

## Rank 3: Soroban smart contract system overview
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046.md | scope: research_chunk | date: 2022-10-27 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/jev/1790482309-a4b85cf3-32a1-41db-b3cc-63d3d56535b1/search-documents/0073.txt

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

## Rank 4: Transaction Simulation
url: https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/transaction-simulation | scope: research_chunk | date: 2026-07-21 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/jev/1790482309-a4b85cf3-32a1-41db-b3cc-63d3d56535b1/search-documents/0101.txt

## Authorization​

Please refer to the authorization overview and transaction authorization section for general information on Soroban authorization: this section pertains specifically to how simulation works alongside authorization requirements.

Soroban&#x27;s transaction simulation mechanism can be used to precompute the SorobanAuthorizedInvocation trees that must be authorized by the Addresses for all the require_auth checks to pass. It can be invoked in two different ways:

### Recording Mode​

The Soroban host environment provides a simulation mode that records the entire context (address, contract ID, function, arguments, etc.) involved in calls to require_auth.

These records are added to a SorobanAuthorizedInvocation tree and marked as successful. Then, after the invocation has finished, transaction simulation returns all of the recorded trees, as well as randomly-generated nonce values for the expected signatures.

Given this information from simulation, the client only needs to provide these trees and nonces to the Addresses involved the invocation for signing, then build the final transaction by combining simulation output with the corresponding signatures.

Note that the "recording" auth mode never emulates authorization failures. This is because failing authorization is always an "exceptional" situation (i.e., the Addresses for which you don&#x27;t anticipate successful authorization shouldn&#x27;t be used in the first place). It is similar to how, for example, the simulateTransaction mechanism doesn&#x27;t emulate failures caused by the incorrect footprint.

If you&#x27;d like to validate signatures, you should use simulateTransaction in authorization "enforcement" mode, which will verify the signatures before executing the transaction on-chain.

### Enforcing Mode​

The recording auth mode is one option for simulateTransaction. However, when dealing with the custom account contracts, for example, it may be necessary to simulate the custom account&#x27;s __check_auth code (which is simply omitted in the recording auth mode), to get its ledger footprint.

This is called running simulation with "enforcing" auth mode. This is basically equivalent to running the transaction on-chain (with possibly a slightly stale ledger state); hence, it requires all the signatures to be valid.

From a developer&#x27;s perspective, the difference between these is whether or not authorization entries are present in the InvokeHostFunction operation submitted to simulateTransaction. The examples below highlight this distinction in detail, but the short story is that passing auth to Operation.invokeContractFunction (which is a convenience wrapper on invokeHostFunction) will imply enforcement mode.

### SDK Usage​

Below, we&#x27;ll demonstrate the various ways in which you can invoke transaction simulation as well as highlight some utilities available in the TypeScript SDK for authorization.

We&#x27;ll cover three types of invocations:

- A simple invocation in which the source account of the transaction is the only signer for the invocation tree.

- An invocation in which two accounts need to sign the invocation tree.

- An invocation run in enforcement mode to confirm that signatures are correct.

Example 1: source account authorization.​
In this variant, we will leverage the "source account authorization" variant: this is when the source account on the transaction is the only one that needs to sign for the invocation (see the "source account" variant of SorobanCredentials). In this scenario, the signature on the transaction itself directly implies signing the invocation.

- JavaScript

import {
 Asset,
 Keypair,
 Networks,
 Operation,
 authorizeEntry,
 TransactionBuilder,
 xdr,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

const s = Server("https://soroban-testnet.stellar.org");

// Pretend is is a real, funded account.
const signer = Keypair.random();
const xlmContract = Asset.native().contractId(Networks.TESTNET);

async function main() {
 const tx = new TransactionBuilder(await s.loadAccount(signer.publicKey()), {
 networkPassphrase: Networks.TESTNET,
 fee: BASE_FEE,
 })
 .addOperation(
 Operation.invokeContractFunction(
 xlmContract,
 [
 ["balance", "symbol"],
 [signer.publicKey(), "address"],
 ].map((val, type) => nativeToScVal(val, { type })),
 ),
 )
 .build();

 const preppedTx = s.prepareTransaction(tx);
 preppedTx.sign(signer);

 const sendTx = await s.sendTransaction(preppedTx);
 return s.pollTransaction(sendTx.hash);
}

main().catch((e) => console.error(e));

Notice that, in contrast to the following example, we didn&#x27;t need to do simulation separately. This is because we can sign the transaction as-is rather than needing to inspect its authorization entries.

Example 2: multi-party authentication.​
In this variant, we&#x27;ll extend the required signatures to more than one party, so the source account is no longer enough. We&#x27;ll leverage the authorizeEntry helper, which is designed specifically for making it easy to sign the entries returned by transaction simulation.

- TypeScript

import {
 Asset,
 Keypair,
 Networks,
 Operation,
 authorizeEntry,
 TransactionBuilder,
 xdr,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

const s = Server("https://soroban-testnet.stellar.org");

// Pretend these are real, funded accounts.
const signers = [Keypair.random(), Keypair.random()];
const xlmContract = Asset.native().contractId(Networks.TESTNET);

## Rank 5: passkey-kit: Passkey Kit
url: https://github.com/stellar/passkey-kit/blob/main/README.md | scope: research_chunk | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/jev/1790482309-a4b85cf3-32a1-41db-b3cc-63d3d56535b1/search-documents/0023.txt

## Contract interface

The wallet is a Soroban smart contract (`soroban-sdk 27`, `wasm32v1-none`). Every user wallet is a separate instance.

The v1.1 contract requires passkey proofs in `__constructor` and every later Secp256r1 signer write. See [the signer-provenance design](docs/security-signer-provenance-v2.md) and [deployment manifest](docs/deployments-2026-09-01.md).

**Functions:** `__constructor(signer, proof)` · `add_signer(signer)` · `add_secp256r1(signer, proof)` · `update_signer(signer)` · `remove_signer(signer_key)` · `upgrade(new_wasm_hash)` · `get_signer(signer_key)` · `get_secp256r1_binding(key_id)`.

Wallet administration functions require wallet auth through `__check_auth`.

**Signer kinds:** `Policy(Address)` · `Ed25519(BytesN<32>)` · `Secp256r1(Bytes keyId)`, each with a `SignerExpiration`, `SignerLimits`, and `SignerStorage`.

**Auth (`__check_auth`):** a flat `Signatures` map (`SignerKey → Signature`) signed over the plain signature payload. Pass 1 checks every requested context is covered by some permitted, unexpired signer; pass 2 verifies **every** entry in the map (existence, expiration, crypto/policy). Include only the signatures you need.

**Policy lifecycle:** policy signers get an `install(wallet)` hook on add (a hard call — a panic aborts the add) and a permissionless `uninstall(wallet)` self-clean entrypoint. `install` runs while the adding signer's authorization is live: anything the hook `require_auth`s against the wallet becomes a sub-invocation of the `add_signer` auth entry, covered by the adder's signature. The new policy's `SignerLimits` do not bound this. Only add policy contracts you trust. `addPolicy` refuses such entries by default. `policy__` is publicly callable — stateful policies must authenticate the caller (`source.require_auth()`).

**Events** (`#[contractevent]`, SEP-48 schema in the WASM): `signer_added` · `signer_updated` · `signer_removed` · `upgraded`. These replace the legacy `("sw_v1", …)` tuple events; indexers consume them directly.

See [`contracts/smart-wallet-interface/src/`](./contracts/smart-wallet-interface/src) for the canonical trait and types.

### Deterministic derivation

Each new wallet address derives from its constructor passkey credential ID (`keyId`).

```text
contractId = sha256(XDR(HashIdPreimage::EnvelopeTypeContractId {
    networkId:          sha256(networkPassphrase),
    contractIdPreimage: ContractIdPreimageFromAddress {
        address: G-address of the canonical deployer keypair,
        salt:    sha256(keyId),
    },
}))
```

- The canonical deployer uses `Keypair.fromRawEd25519Seed(sha256("kalepail"))`.
- Overriding `deploySource` changes derived addresses.
- The WASM hash is deliberately **not** in the preimage, so an `upgrade` never moves a wallet's address.

This tuple remains stable for address compatibility. Signer proofs provide ownership evidence; address occupancy does not.

## Rank 6: Moonlight — Runtime Verification (Moonlight core)
url: https://stellarsecurityportal.com/report/78 | scope: research_chunk | date: 2026-07-24 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/jev/1790482309-a4b85cf3-32a1-41db-b3cc-63d3d56535b1/search-documents/0072.txt

## [B6]Provider

# signature
# deadlineisnotprovider-

# signedandenforcedonlyagainst
# cooperative

# submitters

Severity: Informative Recommended Action: Document Prominently Addressed by client 
# Description

The provider check rejects a Provider entry whose valid_until_ledger is below the current ledger, but 
that field is not covered by any provider signature: 
Moonlight-Protocol/soroban-core/modules/auth/src/core.rs 
Line 215 to 222 in d65780b 
215 let (sig_variant, valid_until_ledger) = 215 let (sig_variant, valid_until_ledger) = 
216 sig_map.get(signer.clone()).ok_or(Error::MissingSignature)?; 216 sig_map.get(signer.clone()).ok_or(Error::MissingSignature)?; 
217 217 
218ifvalid_until_ledger<e.ledger().sequence(){218ifvalid_until_ledger<e.ledger().sequence(){
219 return Err(Error::SignatureExpired); 219 return Err(Error::SignatureExpired); 
220 } 220 } 
221 221 
222 verify_signature(&e, &signer, &sig_variant, &payload)?; 222 verify_signature(&e, &signer, &sig_variant, &payload)?; 
The provider signs only payload (the host authorization payload). The valid_until_ledger paired with it 
in the Signatures map is attached by the transaction submitter, who can set any value. So this check 
constrains only a submitter acting against its own interest: it cannot enforce a deadline the provider chose. 
(A P256 entry differs, as there the deadline is bound into the signed message.) 
Neither direction has security impact. Expiry and replay protection for provider signatures are enforced 
separately, at the host layer: the entry's signature_expiration_ledger is part of the signed authorization 
preimage, 
47/103 

stellar/rs-soroban-env/soroban-env-host/src/auth.rs 
Line 2030 to 2048 in cf58d53 
2030 fn get_signature_payload(&self, host: &Host) -> Result<[u8; 32], HostError> { 2030 fn get_signature_payload(&self, host: &Host) -> Result<[u8; 32], HostError> { 
2031 let (nonce, live_until_ledger) = self.nonce.ok_or_else(|| { 2031 let (nonce, live_until_ledger) = self.nonce.ok_or_else(|| { 
2032 host.err( 2032 host.err( 
2033 ScErrorType::Auth, 2033 ScErrorType::Auth, 
2034 ScErrorCode::InternalError, 2034 ScErrorCode::InternalError, 
2035 "unexpected missing nonce", 2035 "unexpected missing nonce", 
2036 &[], 2036 &[], 
2037 ) 2037 ) 
2038 })?; 2038 })?; 
2039 let payload_preimage = 2039 let payload_preimage = 
2040HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization{2040HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization{
2041 network_id: Hash(host.with_ledger_info(|li| li.network_id.metered_clone(host))?), 2041 network_id: Hash(host.with_ledger_info(|li| li.network_id.metered_clone(host))?), 
2042 nonce, 2042 nonce, 
2043 signature_expiration_ledger: live_until_ledger, 2043 signature_expiration_ledger: live_until_ledger, 
2044 invocation: self.root_invocation_to_xdr(host)?, 2044 invocation: self.root_invocation_to_xdr(host)?, 
2045 }); 2045 }); 
2046 2046 
2047 host.metered_hash_xdr(&payload_preimage) 2047 host.metered_hash_xdr(&payload_preimage) 
2048 } 2048 } 
and the host checks it and consumes the entry's nonce before the contract runs: 
48/103 

stellar/rs-soroban-env/soroban-env-host/src/auth.rs 
Line 1985 to 2015 in cf58d53 
1985 fn verify_and_consume_nonce(&mut self, host: &Host) -> Result<(), HostError> { 1985 fn verify_and_consume_nonce(&mut self, host: &Host) -> Result<(), HostError> { 
1986 if self.is_transaction_source_account { 1986 if self.is_transaction_source_account { 
1987 return Ok(()); 1987 return Ok(()); 
1988 } 1988 } 
1989 if let Some((nonce, live_until_ledger)) = &self.nonce { 1989 if let Some((nonce, live_until_ledger)) = &self.nonce { 
1990 let ledger_seq = host.with_ledger_info(|li| Ok(li.sequence_number))?; 1990 let ledger_seq = host.with_ledger_info(|li| Ok(li.sequence_number))?; 
1991ifledger_seq>*live_until_ledger{1991ifledger_seq>*live_until_ledger{
1992 return Err(host.err( 1992 return Err(host.err( 
1993 ScErrorType::Auth, 1993 ScErrorType::Auth, 
1994 ScErrorCode::InvalidInput, 1994 ScErrorCode::InvalidInput, 
1995 "signature has expired", 1995 "signature has expired", 
1996 &[ 1996 &[ 
1997 self.address.into(), 1997 self.address.into(), 
1998 ledger_seq.try_into_val(host)?, 1998 ledger_seq.try_into_val(host)?, 
1999 live_until_ledger.try_into_val(host)?, 1999 live_until_ledger.try_into_val(host)?, 
2000 ], 2000 ], 
2001 )); 2001 )); 
2002 } 2002 } 
2003 let max_live_until_ledger = host.max_live_until_ledger()?; 2003 let max_live_until_ledger = host.max_live_until_ledger()?; 
2004if*live_until_ledger>max_live_until_ledger{2004if*live_until_ledger>max_live_until_ledger{
2005 return Err(host.err( 2005 return Err(host.err( 
2006 ScErrorType::Auth, 2006 ScErrorType::Auth, 
2007 ScErrorCode::InvalidInput, 2007 ScErrorCode::InvalidInput, 
2008 "signature expiration is too late", 2008 "signature expiration is too late", 
2009 &[ 2009 &[ 
2010 self.address.into(), 2010 self.address.into(), 
2011 max_live_until_ledger.try_into_val(host)?, 2011 max_live_until_ledger.try_into_val(host)?, 
2012 live_until_ledger.try_into_val(host)?, 2012 live_until_ledger.try_into_val(host)?, 
2013 ], 2013 ], 
2014 )); 2014 )); 
2015 } 2015 } 
So a submitter-inflated valid_until_ledger cannot extend a provider signature's life past the host- 
enforced, provider-signed expiry, and a deflated one only dooms the submitter's own transaction. 
The contract-level field is therefore a second deadline that no provider signature covers, distinct from the 
host-enforced one. The residual concern is misreading: an integrator could take the in-contract check for the 
operative expiry control and reason about provider-signature lifetime from the wrong field. 
# Recommendation

49/103

## Rank 7: Signing Soroban contract invocations
url: https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations | scope: research_chunk | date: 2026-06-17 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/jev/1790482309-a4b85cf3-32a1-41db-b3cc-63d3d56535b1/search-documents/0018.txt

## Common pitfalls and gotchas​

- Using Horizon URLs: Soroban signing requires Soroban RPC, not Horizon. Refer to Soroban RPC Providers for the correct URL to use.

- Forgetting to assemble: Fee-payer flows must assembleTransaction after simulation to apply footprint + resource fees.

- Missing auth on rebuilt ops: When rebuilding, include sorobanData in the invokeHostFunction operation.

- Wrong signer: C-accounts cannot sign envelopes, only auth entries.

- Stale auth expiration: Keep signatureExpirationLedger short and aligned with expected submission time.

## Rank 8: Authorization
url: https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization | scope: research_chunk | date: 2025-12-11 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/jev/1790482309-a4b85cf3-32a1-41db-b3cc-63d3d56535b1/search-documents/0047.txt

## Soroban Authorization Framework​

For example, imagine a token contract. Its responsibilities are to manage the balances of multiple users (transfer, mint, burn etc.). There is really nothing about these responsibilities that has anything to do with how exactly the user authorized the balance-modifying transaction. The users may want to use some hardware key that supports a new generation of crypto algorithms(which don&#x27;t even have to exist today) or they may want to have bespoke multisig scheme and none of this really has anything to do with the token logic.

Account abstraction provides a convenient extension point for every contract that uses Address for authorization. It doesn&#x27;t solve all the issues automatically - client-side tooling may still need to be adapted to support different authentication schemes or different wallets. But the on-chain state doesn&#x27;t need to be modified and modifying the on-chain state is a much harder problem.

Types of Account Implementations​
Conceptually, every abstract account is a special contract that defines authentication rules and potentially some additional account-specific authorization policies. However, for the sake of optimization and integration with the existing Stellar accounts, Soroban supports 4 different kinds of the account implementations.

Below are the general descriptions of these implementations. See the transaction guide for the concrete information of how different accounts are represented.

Stellar Account​
Corresponds to Address::Account.

This is a special, built-in &#x27;account contract&#x27; that handles all the Stellar accounts. It is not a real contract and doesn&#x27;t need to be deployed.

This supports the Stellar multisig with medium threshold. See Stellar documentation for more details on multisig and thresholds.

Transaction Invoker​
Corresponds to Address::Account.

This is also a Stellar account, but its signature is inferred from the source account of the Stellar transaction (or operation, if it has one).

This is purely an optimization of the Stellar Account that can skip one signature in case the transaction source account also authorizes the contract invocation.

Contract Invoker​
Corresponds to Address::Contract.

This is a special case of an &#x27;account&#x27; that may appear only when a contract calls another contract. We consider that since the contract makes a call, then it must be authorizing it (otherwise, it shouldn&#x27;t have made that call). Hence all the require_auth calls made on behalf of the direct invoker contract Address are considered to be authorized (but not any calls on behalf of the contract deeper down the stack).

Contract Account​
Corresponds to Address::Contract.

This is the extension point of account abstraction. A contract that implements the CustomAccountInterface and __check_auth becomes a contract account. If any contract calls require_auth for the Address of this contract, the Soroban host will call __check_auth with the corresponding arguments.

__check_auth gets a signature payload, a list of signatures (in any user-defined format) and a list of the contract invocations that are being authorized by these signatures. Its responsibility is to perform the authentication via verifying the signatures and also (optionally) to apply a custom authorization policy. For example, a signature weight system similar to Stellar can be implemented, but it also can have customizable rules for the weights, e.g. to allow spending more than X units of token Y only given signature weight Z.

Contract accounts can also be treated as a custodial wallet. It holds the user&#x27;s funds (token balances, NFTs etc.) and provides the user(s) with ways to authorize operations on these funds. Nothing prevents contract accounts from authorizing operations unrelated to balances; for example, they can perform administrative functions for tokens (contract accounts define what to do when require_auth is called).

For the exact interface and more details, see the Simple Account example.

### Secp256r1, passkeys and contract accounts​

After a successful public validator vote to upgrade Stellar&#x27;s Mainnet to Protocol 21, the secp256r1 signature scheme was enabled for smart contract transactions. This allows developers to implement passkeys to sign transactions instead of using secret keys or seed phrases. For guidance, see the passkey wallet guide.

### Advanced Concepts​

Most of the contracts shouldn&#x27;t need the concepts described in this section. Refer to this when developing complex contracts that deal with deep contract call trees and/or multiple Addresses.

require_auth implementation details​
When a Soroban transaction is executed on-chain, the host collects a list of SorobanAuthorizationEntry entries from the transaction (XDR). These entries contain signed authorizer credentials and authorized invocation trees. The host uses these entries to verify authorization during the contract execution.

Every time require_auth/require_auth_for_args host function is called for non-contract-invoker account, the following steps happen:

- Find an authorized invocation tree that matches the require_auth call. The matching process is pretty involved and is described in the section below.

- If authentication hasn&#x27;t happened for this tree yet, then perform it:

- Verify signature expiration. Expired signatures are not valid.

- Verify and consume nonce. Nonce is an arbitrary number, that has to be unique among all the non-expired signatures of the address.

- Build the expected signature payload preimage and compute its SHA-256 hash to get the final signature payload

- Call __check_auth of the account contract corresponding to the Address using the signature payload and the invocations from the authorization tree

- Mark the invocation as &#x27;exhausted&#x27; in its authorized invocation tree. &#x27;Exhausted&#x27; invocations will be skipped when matching the future require_auth calls.

## Rank 8 companion: (same URL)
url: https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization | scope: published_markdown_main_content | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/jev/1790482309-a4b85cf3-32a1-41db-b3cc-63d3d56535b1/search-documents/0001.txt

# Authorization

Authorization is the process of judging which operations "should" or "should not" be allowed to occur; it is about judging _permission_.

Authorization differs from _authentication_, which is the narrower problem of judging whether a person "is who they say they are", or whether a message claiming to come from a person "really" came from them.

Authorization often uses cryptographic authentication (via signatures) to support its judgments, but is a broader, more general process.

View the [authorization starter guide](https://developers.stellar.org/docs/build/guides/auth/contract-authorization.md) to learn more about smart contract authorization on Stellar.

## Soroban Authorization Framework

Soroban aims to provide a light-weight, but flexible and extensible framework that allows contracts to implement arbitrarily complex authorization rules, while providing built-in implementation for some common tasks (such as replay prevention). The framework consists of the following components:

- Contract-specific authorization - custom authorization rules implemented by contracts using the private contract storage and abstract accounts.
- Account abstraction - allows users to customize their authentication rules and define universal authorization policies via contract account. This includes the built-in support for Stellar accounts.
- Host-based authorization library - ensures integrity between contract accounts and regular contracts. Also defines the structured signature payload format, ensures replay prevention and takes care of providing the correct signature contexts.

Soroban host also provides some cryptographic functions (signature verification, hashing) which may be useful for contract account implementations.

Contracts that use Soroban authorization framework are interoperable with each other. Also it is easier for the client applications to write generic code for interaction with Soroban authorization framework. For example, wallets can implement a generalized way to present and sign Soroban payloads.

We realize that it's not possible to cover each and every case, but we hope that the vast majority of the contracts can operate within the framework and thus contribute to building a more cohesive ecosystem. Custom authorization frameworks are still possible to implement, but are not encouraged (unless there are no alternatives).

### Contract-Specific Authorization

#### Contract storage

Contracts have an exclusive read and write access to their [storage](https://developers.stellar.org/docs/build/smart-contracts/getting-started/storing-data.md) in the ledger. This allows contracts to safely control and manage user access to their data. For example, a token contract may ensure that only the administrator can mint more of the token by storing the administrator identity in its storage. Similarly, it can make sure that only an owner of the balance may transfer that balance.

#### `Address`

The storage-based approach described in the previous section requires a way to represent the user identities and authenticate them. `Address` type is a host-managed type that performs these functions.

From the contract perspective `Address` is an opaque identifier type. The contract logic doesn't need to depend on the internal representation of the `Address` (see [Account Abstraction](#account-abstraction) section below for more details).

`Address` type has two similar methods in Soroban SDK: `require_auth` and `require_auth_for_args` (these methods call the respective Soroban host function). The only difference between the functions is the ability to customize the invocation arguments. See [auth example] that demonstrates how to use these functions.

Both functions ensure that the `Address` has authorized the call of the current function within the current context (where context is defined by `require_auth` calls in the current call stack; see more formal definition in the [section below](#require_auth-implementation-details)). The authentication rules for this authorization are defined by the `Address` and are enforced by the Soroban host. Replay protection is also implemented in the host, i.e., there is normally no need for a contract to manage its own nonces.

[auth example]: ../../../build/smart-contracts/example-contracts/auth.mdx

#### Authorizing Sub-contract Calls

One of the key features of Soroban Authorization Framework is the ability to easily make authorized sub-contract calls. For example, it is possible for a contract to call `require_auth` for an `Address` and then call `token.xfer` authorized for the same `Address` (see [timelock example] that demonstrates this pattern).

Contracts don't need to do anything special to benefit from this feature. Just calling a sub-contract that calls `require_auth` will ensure that the sub-contract call has been properly authorized.

[timelock example]: ../../../build/smart-contracts/example-contracts/timelock.mdx

#### When to `require_auth`

The main authorization-related decision a contract writer needs to make for any given `Address` is whether they need to call `require_auth` for it. While the decision needs to be made on case-by-case basis, here are some rules of thumb:

- If the access to the `Address` data in this contract is read-only, then `require_auth` is probably not needed.
- If the `Address` data in this contract is being modified in a way that's not strictly beneficial to the user, then `require_auth` is probably needed (e.g. reducing the user's token balance needs to be authorized, while increasing it doesn't need to be authorized)
- If a contract calls another contract that will call `require_auth` for the `Address` (e.g. `token.xfer`), then adding `require_auth` in the caller would ensure that the authorization for the inner call can't be reused outside of your contract. For example, if you want to do something positive for the user, but only when they have transferred some token to your contract, then the contract call itself should `require_auth`.

#### Authorizing Multiple `Address`es

There is no explicit restriction on how many `Address` entities the contract uses and how many `Address`es have `require_auth` called. That means that it is possible to authorize a contract call on behalf of multiple users, which may even have different authorization contexts (customized via arguments in `require_auth_for_args`). [Atomic swap] is an example that deals with authorization of two `Address`es.

[atomic swap]: ../../../build/smart-contracts/example-contracts/atomic-swap.mdx

Note though, that contracts that deal with multiple authorized `Address`es need a bit more complex support on the client side (to collect and attach the proper signatures).

### Account Abstraction

Account abstraction is a way to decouple the authentication logic from the contract-specific authorization rules. The `Address` defined above is in fact an identifier of an 'abstract' account. That is, the contracts know the `Address` and can require authorization from it, but they don't know how exactly it is implemented.

For example, imagine a token contract. Its responsibilities are to manage the balances of multiple users (transfer, mint, burn etc.). There is really nothing about these responsibilities that has anything to do with _how exactly_ the user authorized the balance-modifying transaction. The users may want to use some hardware key that supports a new generation of crypto algorithms(which don't even have to exist today) or they may want to have bespoke multisig scheme and none of this really has anything to do with the token logic.

Account abstraction provides a convenient extension point for every contract that uses `Address` for authorization. It doesn't solve all the issues automatically - client-side tooling may still need to be adapted to support different authentication schemes or different wallets. But the on-chain state doesn't need to be modified and modifying the on-chain state is a much harder problem.

#### Types of Account Implementations

Conceptually, every abstract account is a special contract that defines authentication rules and potentially some additional account-specific authorization policies. However, for the sake of optimization and integration with the existing Stellar accounts, Soroban supports 4 different kinds of the account implementations.

Below are the general descriptions of these implementations. See the transaction [guide](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction.md) for the concrete information of how different accounts are represented.

##### Stellar Account

Corresponds to `Address::Account`.

This is a special, built-in 'account contract' that handles all the Stellar accounts. It is not a real contract and doesn't need to be deployed.

This supports the Stellar multisig with medium threshold. See Stellar [documentation] for more details on multisig and thresholds.

[documentation]: ../transactions/signatures-multisig.mdx

##### Transaction Invoker

Corresponds to `Address::Account`.

This is also a Stellar account, but its signature is inferred from the source account of the Stellar transaction (or operation, if it has one).

This is purely an optimization of the [Stellar Account](#stellar-account) that can skip one signature in case the transaction source account also authorizes the contract invocation.

##### Contract Invoker

Corresponds to `Address::Contract`.

This is a special case of an 'account' that may appear only when a contract calls another contract. We consider that since the contract makes a call, then it must be authorizing it (otherwise, it shouldn't have made that call). Hence all the `require_auth` calls made on behalf of the **direct** invoker contract `Address` are considered to be authorized (but not any calls on behalf of the contract deeper down the stack).

##### Contract Account

Corresponds to `Address::Contract`.

This is the extension point of account abstraction. A contract that implements the `CustomAccountInterface` and `__check_auth` becomes a contract account. If any contract calls `require_auth` for the `Address` of this contract, the Soroban host will call `__check_auth` with the corresponding arguments.

`__check_auth` gets a signature payload, a list of signatures (in any user-defined format) and a list of the contract invocations that are being authorized by these signatures. Its responsibility is to perform the authentication via verifying the signatures and also (optionally) to apply a custom authorization policy. For example, a signature weight system similar to Stellar can be implemented, but it also can have customizable rules for the weights, e.g. to allow spending more than X units of token Y only given signature weight Z.

Contract accounts can also be treated as a custodial wallet. It holds the user's funds (token balances, NFTs etc.) and provides the user(s) with ways to authorize operations on these funds. Nothing prevents contract accounts from authorizing operations unrelated to balances; for example, they can perform administrative functions for tokens (contract accounts define what to do when `require_auth` is called).

For the exact interface and more details, see the [Simple Account example].

[Simple Account example]: ../../../build/smart-contracts/example-contracts/simple-account.mdx

### Secp256r1, passkeys and contract accounts

After a successful public validator vote to upgrade Stellar's Mainnet to Protocol 21, the secp256r1 signature scheme was enabled for smart contract transactions. This allows developers to implement passkeys to sign transactions instead of using secret keys or seed phrases. For guidance, see the [passkey wallet guide](https://developers.stellar.org/docs/build/guides/contract-accounts/smart-wallets.md).

### Advanced Concepts

Most of the contracts shouldn't need the concepts described in this section. Refer to this when developing complex contracts that deal with deep contract call trees and/or multiple `Address`es.

#### `require_auth` implementation details

When a Soroban transaction is executed on-chain, the host collects a list of `SorobanAuthorizationEntry` entries from the transaction ([XDR][soroban-auth-entry]). These entries contain signed authorizer credentials and authorized invocation trees. The host uses these entries to verify authorization during the contract execution.

Every time `require_auth`/`require_auth_for_args` host function is called for non-contract-invoker account, the following steps happen:

- Find an authorized invocation tree that matches the `require_auth` call. The matching process is pretty involved and is described in the section below.
- If authentication hasn't happened for this tree yet, then perform it:
  - Verify signature expiration. Expired signatures are not valid.
  - Verify and consume nonce. Nonce is an arbitrary number, that has to be unique among all the non-expired signatures of the address.
  - Build the expected [signature payload preimage] and compute its SHA-256 hash to get the final signature payload
  - Call `__check_auth` of the account contract corresponding to the `Address` using the signature payload and the invocations from the authorization tree
- Mark the invocation as 'exhausted' in its authorized invocation tree. 'Exhausted' invocations will be skipped when matching the future `require_auth` calls.

If any of the steps above fails, then the authorization is considered unsuccessful.

Notice, that authentication happens just once per tree, as the whole tree needs to be signed.

[soroban-auth-entry]: https://github.com/stellar/stellar-xdr/blob/e372df9f677961aac04c5a4cc80a3667f310b29f/Stellar-transaction.x#L570
[signature payload preimage]: https://github.com/stellar/stellar-xdr/blob/e372df9f677961aac04c5a4cc80a3667f310b29f/Stellar-transaction.x#L703

#### Matching Authorized Invocation Trees

In order for authorizations to succeed, all the `require_auth`/`require_auth_for_args` calls have to be covered by the corresponding `SorobanAuthorizedInvocation` trees in a transaction (defined in transaction [XDR][invocation-xdr]).

Formally, this correspondence is defined as follows.

Given a top-level contract invocation `I` we can build a 'contract invocation tree' `T` by tracing all the sub-contract calls (a directed edge `A->B` in the tree means 'contract function A calls contract function B). Note, that we only consider the functions that are implemented in different contracts, i.e. any function calls that don't involve a contract invocation via host `call` are considered to belong to the same node.

Let's say authorization is required from addresses `A_1..A_N`. Then for every address `A_i` there are two kinds of nodes in the invocation tree `T`: `R`-nodes that had a `require_auth` call for `A_i` and `N`-nodes that didn't have such call. Then we remove all the `N`-nodes and all the edges from `T` and add the directed edges connecting the remaining `R`-nodes such that the edge goes from `R_j` to `R_k` if there was a path between `R_j` and `R_k` in `T` that doesn't contain any other `R`-nodes. As a result we get a forest of `SorobanAuthorizedInvocation` trees for `A_i`. Notice, that these trees don't have to have their root be `I` node (i.e. the top-level contract call), so it's possible to e.g. batch the authorized call together without requiring signing the batching function.

In simpler terms, `SorobanAuthorizedInvocation` trees for an `Address` are subsets of the full invocation tree that are 'condensed' to only contain invocations that have `require_auth` call for that `Address`.

During the matching process that happens for every `require_auth` host tries to match the current path in `T` to a `SorobanAuthorizedInvocation` tree for the corresponding `Address`. The path is considered to be matched only when there is a corresponding path of _exhausted_ `R` nodes leading to the current call. This means that if the `Address` signs a sequence of calls `A.foo->B.bar->C.baz`, then its authorization check will fail in case if `A.foo` directly calls `C.baz` because `C.baz` strictly has to be called from `B.bar`.

##### Duplicate Addresses

In case if the same contract function calls `require_auth` for the same `Address` multiple times (e.g. when multiple operations from the same user are being batched), every `require_auth` call still has to have a corresponding node in the `SorobanAuthorizedInvocation` tree. Due to that, there might be multiple valid trees that make all the authorization checks pass. There is nothing wrong about that - the address still must have authorized all the invocations. The only requirement for such cases to be handled correctly is to ensure that the `require_auth` calls for an `Address` happen before the corresponding sub-contract calls.

[invocation-xdr]: https://github.com/stellar/stellar-xdr/blob/e372df9f677961aac04c5a4cc80a3667f310b29f/Stellar-transaction.x#L537

## Rank 9: colibri: SEP-41 Token Contract
url: https://github.com/fazzatti/colibri/blob/main/docs/core/asset/sep-41-token-contract.md | scope: research_chunk | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/jev/1790482309-a4b85cf3-32a1-41db-b3cc-63d3d56535b1/search-documents/0186.txt

## Allowances

The expiration name follows SEP-41 directly: `liveUntilLedger` is encoded as the
contract's `live_until_ledger` `u32` argument.

```ts
const latest = await rpc.getLatestLedger();

await token.approve({
  from: holder,
  spender,
  amount: 50_000_000n,
  liveUntilLedger: latest.sequence + 100,
  config,
});
```

The implementing contract and network enforce the valid expiration range.

## Rank 10: Stellar’s composable auth model
url: https://stellar.org/blog/foundation-news/stellars-composable-auth-model | scope: research_chunk | date: 2026-05-05 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/jev/1790482309-a4b85cf3-32a1-41db-b3cc-63d3d56535b1/search-documents/0025.txt

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

