# Evidence for: What exact bytes does an Ed25519 signer sign for a Stellar transaction envelope, and how does the network passphrase enter that digest? Use primary Stellar sources.

Contents (section: first line):
- Rank 1: Fee-Bump Transactions: line 11
- Rank 2: Explore Mainnet, Testnet & Futurenet: Roles, Use Cases & Connectivity: line 223
- Rank 3: Signed-Payload: Ed25519 Signed Payload Signer for Atomic Transaction Signature Disclosure: line 242
- Rank 4: Memo Authorization for Soroban: line 367
- Rank 5: Stellar Web Authentication: line 476
- Rank 6: js-stellar-sdk v16.2.0: line 497

## Rank 1: Fee-Bump Transactions
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md | scope: research_chunk | date: 2019-12-03 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/01-signer-astra/jev/1790470549-5bb6d3ae-7911-4a6c-9229-8e72588f672e/search-documents/0223.txt

## Specification

### XDR
The new transaction, transaction envelope, and related XDR types are:
```c++
enum EnvelopeType
{
    ENVELOPE_TYPE_TX_V0 = 0,
    ENVELOPE_TYPE_SCP = 1,
    ENVELOPE_TYPE_TX = 2,
    ENVELOPE_TYPE_AUTH = 3,
    ENVELOPE_TYPE_SCPVALUE = 4,
    ENVELOPE_TYPE_TX_FEE_BUMP = 5
};

struct TransactionV1Envelope
{
    Transaction tx;
    /* Each decorated signature is a signature over the SHA256 hash of
     * a TransactionSignaturePayload */
    DecoratedSignature signatures<20>;
};

struct TransactionV0
{
    uint256 sourceAccountEd25519;
    uint32 fee;
    SequenceNumber seqNum;
    TimeBounds* timeBounds;
    Memo memo;
    Operation operations<100>;
    union switch (int v) {
    case 0:
        void;
    } ext;
};

struct TransactionV0Envelope
{
    TransactionV0 tx;
    /* Each decorated signature is a signature over the SHA256 hash of
     * a TransactionSignaturePayload */
    DecoratedSignature signatures<20>;
};

struct FeeBumpTransaction
{
    AccountID feeSource;
    int64 fee;
    union switch (EnvelopeType type)
    {
    case ENVELOPE_TYPE_TX:
        TransactionV1Envelope v1;
    } innerTx;
    union switch (int v) {
    case 0:
        void;
    } ext;
};

struct FeeBumpTransactionEnvelope
{
    FeeBumpTransaction tx;
    /* Each decorated signature is a signature over the SHA256 hash of
     * a TransactionSignaturePayload */
    DecoratedSignature signatures<20>;
};

union TransactionEnvelope switch (EnvelopeType type) {
case ENVELOPE_TYPE_TX_V0:
    TransactionV0Envelope v0;
case ENVELOPE_TYPE_TX:
    TransactionV1Envelope v1;
case ENVELOPE_TYPE_TX_FEE_BUMP:
    FeeBumpTransactionEnvelope feeBump;
};

struct TransactionSignaturePayload
{
    Hash networkId;
    union switch (EnvelopeType type)
    {
    // Backwards Compatibility: Use ENVELOPE_TYPE_TX to sign ENVELOPE_TYPE_TX_V0
    case ENVELOPE_TYPE_TX:
        Transaction tx;
    case ENVELOPE_TYPE_TX_FEE_BUMP:
        FeeBumpTransaction feeBump;
    }
    taggedTransaction;
};
```

The new transaction result XDR types are:
```c++
enum TransactionResultCode
{
    txFEE_BUMP_INNER_SUCCESS = 1, // fee bump inner transaction succeeded
    // .... txSUCCESS, ..., txINTERNAL_ERROR unchanged ....
    txNOT_SUPPORTED = -12,  // transaction type not supported
    txFEE_BUMP_INNER_FAILED = -13 // fee bump inner transaction failed
};

struct InnerTransactionResult
{
    int64 feeCharged;

    union switch (TransactionResultCode code)
    {
    // txFEE_BUMP_INNER_SUCCESS is not included
    case txSUCCESS:
    case txFAILED:
        OperationResult results<>;
    case txTOO_EARLY:
    case txTOO_LATE:
    case txMISSING_OPERATION:
    case txBAD_SEQ:
    case txBAD_AUTH:
    case txINSUFFICIENT_BALANCE:
    case txNO_ACCOUNT:
    case txINSUFFICIENT_FEE:
    case txBAD_AUTH_EXTRA:
    case txINTERNAL_ERROR:
    case txNOT_SUPPORTED:
        // txFEE_BUMP_INNER_FAILED is not included
        void;
    }
    result;

    // reserved for future use
    union switch (int v)
    {
    case 0:
        void;
    }
    ext;
};

struct InnerTransactionResultPair
{
    Hash transactionHash;          // hash of the inner transaction
    InnerTransactionResult result; // result for the inner transaction
};

struct TransactionResult
{
    int64 feeCharged; // actual fee charged for the transaction

    union switch (TransactionResultCode code)
    {
    case txFEE_BUMP_INNER_SUCCESS:
    case txFEE_BUMP_INNER_FAILED:
        InnerTransactionResultPair innerResultPair;
    case txSUCCESS:
    case txFAILED:
        OperationResult results<>;
    default:
        void;
    }
    result;

    // reserved for future use
    union switch (int v)
    {
    case 0:
        void;
    }
    ext;
};
```

### Semantics

### How does the TransactionEnvelope transformation work?
In order to create multiple types of transaction envelopes, we needed to perform
a clever transformation of the XDR. We split the discriminant off
`Transaction.sourceAccount` leaving a raw ed25519 public key (this type is
`TransactionV0`), then used the discriminant as the discriminant for the
`TransactionEnvelope` union. We then added a new type of transaction envelope,
which just contains a `Transaction`, to support new account types should we add
them in the future. The third type of transaction is the fee-bump transaction,
which can wrap a new-style transaction envelope of type ENVELOPE_TYPE_TX.

#### Fee Rate
A fee-bump transaction has an effective number of operations equal to one plus
the number of operations in the inner transaction. Correspondingly, the minimum
fee for the fee-bump transaction is one base fee more than the minimum fee for
the inner transaction. Similarly, the fee rate (see CAP-0005) is normalized by
one plus the number of operations in the inner transaction rather than the
number of operations in the inner transaction alone.

#### Validity
Prior to the protocol version in which this proposal is implemented,
only a `TransactionEnvelope` of type `ENVELOPE_TYPE_TX_V0` can be valid whereas
a `TransactionEnvelope` of any other type will be invalid with result
`txNOT_SUPPORTED`. Starting in the protocol version in which this proposal is
implemented, only a `TransactionEnvelope` of type `ENVELOPE_TYPE_TX` or
`ENVELOPE_TYPE_TX_FEE_BUMP` can be valid whereas a `TransactionEnvelope` of any
other type will be invalid with result `txNOT_SUPPORTED`. Because
`ENVELOPE_TYPE_TX_V0` and `ENVELOPE_TYPE_TX` require the same signatures,
`TransactionEnvelope` of type `ENVELOPE_TYPE_TX_V0` can simply be converted to
`ENVELOPE_TYPE_TX`.

Validity requirements for a `TransactionEnvelope` of type `ENVELOPE_TYPE_TX` are
identical to the existing validity requirements for a `TransactionEnvelope` of
type `ENVELOPE_TYPE_TX_V0`.

To validate a `TransactionEnvelope E` of type `ENVELOPE_TYPE_TX_FEE_BUMP` with
inner transaction envelope `F = E.feeBump().tx.innerTx`, check that

## Rank 2: Explore Mainnet, Testnet & Futurenet: Roles, Use Cases & Connectivity
url: https://developers.stellar.org/docs/networks | scope: research_chunk | date: 2026-07-21 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/01-signer-astra/jev/1790470549-5bb6d3ae-7911-4a6c-9229-8e72588f672e/search-documents/0040.txt

## Network passphrases​

Stellar’s Mainnet, Testnet, and Futurenet each have their own unique passphrase. These are used when validating signatures on a given transaction. If you sign a transaction for one network but submit it to another, it won’t be considered valid. By convention, the format of a passphrase is ‘[Network Name] ; [Month of Creation] [Year of Creation]’.

The passphrases for the Stellar Mainnet, Testnet, and Futurenet are:

- Mainnet: &#x27;Public Global Stellar Network ; September 2015&#x27;

- Testnet: &#x27;Test SDF Network ; September 2015&#x27;

- Futurenet: &#x27;Test SDF Future Network ; October 2022&#x27;

Passphrases serve two main purposes: (1) used as the seed for the root account (master network key) at genesis and (2) used to build hashes of transactions, which are ultimately what is signed by each signer’s secret key in a transaction envelope; this allows you to verify that a transaction was intended for a specific network by its signers.

Many SDKs have the passphrases hardcoded for Stellar&#x27;s networks. If you’re running a private network, you’ll have to manually pass in a passphrase to be used whenever transaction hashes are generated. All of Stellar’s official SDKs allow you to use a network with a custom passphrase.

## Rank 3: Signed-Payload: Ed25519 Signed Payload Signer for Atomic Transaction Signature Disclosure
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0040.md | scope: research_chunk | date: 2021-07-14 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/01-signer-astra/jev/1790470549-5bb6d3ae-7911-4a6c-9229-8e72588f672e/search-documents/0014.txt

## Specification

### XDR Changes

This patch of XDR changes is based on the XDR files in tag `v17.2.0` of
[stellar-core].

```diff mddiffcheck.base=v17.3.0
diff --git a/src/xdr/Stellar-types.x b/src/xdr/Stellar-types.x
index 8f7d5c20..03149f3d 100644
--- a/src/xdr/Stellar-types.x
+++ b/src/xdr/Stellar-types.x
@@ -19,6 +19,7 @@ enum CryptoKeyType
     KEY_TYPE_ED25519 = 0,
     KEY_TYPE_PRE_AUTH_TX = 1,
     KEY_TYPE_HASH_X = 2,
+    KEY_TYPE_ED25519_SIGNED_PAYLOAD = 3,
     // MUXED enum values for supported type are derived from the enum values
     // above by ORing them with 0x100
     KEY_TYPE_MUXED_ED25519 = 0x100
@@ -33,7 +34,8 @@ enum SignerKeyType
 {
     SIGNER_KEY_TYPE_ED25519 = KEY_TYPE_ED25519,
     SIGNER_KEY_TYPE_PRE_AUTH_TX = KEY_TYPE_PRE_AUTH_TX,
-    SIGNER_KEY_TYPE_HASH_X = KEY_TYPE_HASH_X
+    SIGNER_KEY_TYPE_HASH_X = KEY_TYPE_HASH_X,
+    SIGNER_KEY_TYPE_ED25519_SIGNED_PAYLOAD = KEY_TYPE_ED25519_SIGNED_PAYLOAD
 };
 
 union PublicKey switch (PublicKeyType type)
@@ -52,6 +54,13 @@ case SIGNER_KEY_TYPE_PRE_AUTH_TX:
 case SIGNER_KEY_TYPE_HASH_X:
     /* Hash of random 256 bit preimage X */
     uint256 hashX;
+case SIGNER_KEY_TYPE_ED25519_SIGNED_PAYLOAD:
+    struct {
+        /* Public key that must sign the payload. */
+        uint256 ed25519;
+        /* Payload to be raw signed by ed25519. */
+        opaque payload<64>;
+    } ed25519SignedPayload;
 };
 
 // variable size as the size depends on the signature scheme used

```

### Semantics

This proposal introduces one new type of signer, the ed25519 signed payload
signer, that is defined as a variable length opaque payload with a maximum size
of 64 bytes and an ed25519 public key. A signature for the signer is the result
of signing the payload with the private key that the public key is derived.

The ed25519 signed payload signer is usable everywhere existing signers may be
used, including in the `extraSigners` transaction precondition added in
[CAP-21].

#### Signature

The signature of an ed25519 signed payload signer is the raw ed25519 signature
of the signer's payload using the private key that derives the signer's ed25519
public key.

For example, given:
- A private key `Ks` and its derived public key `Kp`.
- A ed25519 signed payload signer `S` that contains:
  - Payload `P`.
  - Public key `Kp`.

A signature that satisfies signer `S` is produced by:
- Ed25519 signing `P` with `Ks`.

Unlike transaction signatures in the Stellar protocol, the payload of this
signer is not combined with the network ID or hashed before passing it to the
ed25519 signing algorithm.

#### Signature Hint

The signature hint of an ed25519 signed payload signer is the last 4 bytes of
the ed25519 public key XORed with last 4 bytes of the payload. If the payload
has a length less than 4 bytes, then 1 to 4 zero bytes are appended to the
payload such that it has a length of 4 bytes, for calculating the hint.

#### Transaction Envelopes

This proposal makes no structural changes to transaction envelopes other than
the signature of an ed25519 signed payload signer may be included in the list of
decorated signatures.

#### Signature Checking

Signature checking is changed to include verifying that any ed25519 signed
payload signer's have matching signatures.

Ed25519 signed payload signer signatures are verified by performing ed25519
signature verification using the signature, the payload from the signer, and the
ed25519 public key from the signer.

#### Signer Verification Order

The current protocol validates signers in this order :
`SIGNER_KEY_TYPE_PRE_AUTH_TX` -> `SIGNER_KEY_TYPE_HASH_X` ->
`SIGNER_KEY_TYPE_ED25519`. This CAP will verify
`SIGNER_KEY_TYPE_ED25519_SIGNED_PAYLOAD` last after `SIGNER_KEY_TYPE_ED25519`.
The order can matter in the context of `txBAD_AUTH_EXTRA`, because we stop
checking signatures once we have matched enough signatures to meet the required
weight. If there are any signatures that have not been used, the transaction
fails with `txBAD_AUTH_EXTRA`.

#### Transaction Validity

If a payload signer is used in the `extraSigners` precondition specified in
[CAP-21], and the payload is empty, the transaction will fail with `txMALFORMED`
(also specified in [CAP-21]).

#### SetOptionsOp

`SetOptionsOp` will fail validation with `SET_OPTIONS_BAD_SIGNER` if the new
signed payload signer is used prior to the protocol upgrade, or if the payload
is empty.

## Rank 4: Memo Authorization for Soroban
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0064.md | scope: research_chunk | date: 2025-01-09 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/01-signer-astra/jev/1790470549-5bb6d3ae-7911-4a6c-9229-8e72588f672e/search-documents/0109.txt

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

## Rank 5: Stellar Web Authentication
url: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md | scope: research_chunk | date: 2024-03-20 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/01-signer-astra/jev/1790470549-5bb6d3ae-7911-4a6c-9229-8e72588f672e/search-documents/0049.txt

## A convention for signatures

Signatures in Stellar involve both the secret key of the signer and the
passphrase of the network. SEP-10 clients and servers must use the following
convention when deciding what network passphrase to use for signing and
verifying signatures in SEP-10:

- If the server is for testing purposes or interacts with the Stellar testnet,
  use the Stellar testnet passphrase.
- Otherwise, use the Stellar pubnet passphrase.

This convention ensures that SEP-10 clients and servers can use the same
passphrase as they're using for interacting with the Stellar network.

The client can examine the `network_passphrase` (if defined) that the server
includes in its response from the challenge endpoint to be sure it's using the
correct passphrase and is connecting to the server that it expected.

## Rank 6: js-stellar-sdk v16.2.0
url: https://github.com/stellar/js-stellar-sdk/releases/tag/v16.2.0 | scope: research_chunk | date: 2026-07-29 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/01-signer-astra/jev/1790470549-5bb6d3ae-7911-4a6c-9229-8e72588f672e/search-documents/0069.txt

## [v16.2.0](https://github.com/stellar/js-stellar-sdk/compare/v16.1.0...v16.2.0)

### Added
- `rpc.Server.simulateTransaction` accepts an optional `useUpgradedAuth` flag, and `contract.AssembledTransaction` accepts it as a method option (`useUpgradedAuth`) or per-call (`tx.simulate({ useUpgradedAuth: true })`). When set, RPC simulation records v2 address credentials (CAP-71) instead of the legacy v1 credentials. It only affects the recording auth modes and is silently ignored on hosts that cannot emit v2 credentials. The flag is deprecated from the start: it is transitional and becomes a no-op once the network returns v2 credentials by default (protocol 28) ([#1562](https://github.com/stellar/js-stellar-sdk/issues/1562)).
- `@stellar/stellar-sdk/base` subpath export: import offline primitives like `StrKey` and `Keypair` without loading Horizon, RPC, or the SEP helpers and their networking dependencies ([#1550](https://github.com/stellar/js-stellar-sdk/pull/1550)).
- `authorizeEntry` / `authorizeInvocation` signing callbacks now receive the 32-byte signing payload (`hash(preimage.toXDR())`) as a second argument alongside the preimage, so signers — including HSMs and remote signers that only accept a digest — never have to re-derive it. Existing single-argument callbacks are unaffected ([#1532](https://github.com/stellar/js-stellar-sdk/issues/1532)).
- `authorizeEntry` / `authorizeInvocation` now support non-Ed25519 signers: the signing callback may return `{ signatureScVal: xdr.ScVal, address?: string }`, and the given `ScVal` is written verbatim as the credentials' signature — no Ed25519 verification, no `{public_key, signature}` map, no `scvVec` wrapping. This lets smart-wallet / custom-account contracts (whose `__check_auth` expects its own signature structure) use the helper instead of hand-rolling preimage construction and credential assembly. The optional `address` routes the signature to a specific credential node, like `forAddress` ([#1530](https://github.com/stellar/js-stellar-sdk/issues/1530)).
- `contract.Signer`: an interface pairing an `address` with the SEP-43 `signTransaction` and optional `signAuthEntry` methods, plus `contract.KeypairSigner`, a `Keypair`-backed implementation. The `signTransaction` and `signAuthEntry` options — on `ClientOptions`, `MethodOptions`, and `AssembledTransaction`'s `sign` / `signAndSend` / `signAuthEntries` — now accept a `Signer` or a bare `Keypair` in addition to a callback. Adds the `contract.SignTransactionLike` and `contract.SignAuthEntryLike` types. When `signAuthEntries` gets a `Signer` or `Keypair`, its default target `address` is now the signer's own address rather than `publicKey`. Existing callbacks work unchanged; one type-only caveat: the option fields are no longer plain function types, so derive callback shapes from `contract.SignTransaction` / `contract.SignAuthEntry` instead of the option field ([#1567](https://github.com/stellar/js-stellar-sdk/pull/1567)).
- `contract.Spec` now reads SEP-48 event declarations: `events()` and `findEvent(name, occurrence?)` list a contract's declared events, `parseEvent(topics, data)` decodes a fired event into `{ name, data }`, with topic-carried params merged into `data` (returns `undefined` when nothing matches), and `eventTopicFilter(name, topicValues?, occurrence?)` builds a `getEvents` filter row, with `"*"` for any topic param left unset. Generated client bindings gain a typed `<Name>Event` interface per event, a `ContractEvent` union, a `parseEvent()` method, and per-event `<name>EventFilter()` methods. A contract may declare the same event name more than once (composed modules each emitting their own `transfer`); each declaration gets its own interface and filter method, and `occurrence` — a 0-based index in declaration order — selects among them. Generated names receive a numeric suffix when needed to avoid a collision, and `stellar-sdk bindings` warns about duplicate declarations and renames. Adds the `contract.ParsedEvent` type ([#1556](https://github.com/stellar/js-stellar-sdk/pull/1556), [#1565](https://github.com/stellar/js-stellar-sdk/pull/1565), [#1572](https://github.com/stellar/js-stellar-sdk/pull/1572)).

### Fixed
- `Spec.scValToNative` now handles contract values typed as `Val`
 (`scSpecTypeVal`) by delegating to the generic `scValToNative` converter,
 mirroring the encoding-side support added in [#1485]. Decoding a response
 containing a `Val`-typed string, symbol, vec, or map — e.g. a struct with a
 `Vec<Val>` field — no longer throws
 `ScSpecType scSpecTypeVal was not string or symbol`; each value decodes to
 its natural native representation (`Address` → string, `u32` → number,
 `Symbol` → string, vecs/maps recurse).
 ([#1551](https://github.com/stellar/js-stellar-sdk/pull/1551))


**Full Changelog**: https://github.com/stellar/js-stellar-sdk/compare/v16.1.0...v16.2.0

