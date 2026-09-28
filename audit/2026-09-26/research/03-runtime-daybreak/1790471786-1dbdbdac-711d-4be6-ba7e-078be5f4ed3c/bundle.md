# Evidence for: What do current official Stellar sources state about Testnet resets and real asset risk, as applicable to a local testnet-only signing bridge?

Contents (section: first line):
- Rank 1: Explore Mainnet, Testnet & Futurenet: Roles, Use Cases & Connectivity: line 15
- Rank 2: Automating Testnet and Futurenet Reset Data in Stellar: line 34
- Rank 2 companion: (same URL): line 41
- Rank 3: stellar.org Terms of Service (SDF, a Delaware non-profit corporation): line 403
- Rank 4: Stellar Weekly Roundup — week of Jun 5, 2026: line 414
- Rank 5: passkey-kit: Deterministic deployer security model: line 423
- Rank 6: Protocol 23 Upgrade Guide: line 438
- Rank 7: On-chain signature & transaction sharing: line 469
- Rank 8: What do you need to do to prepare?: line 517
- Rank 9: Upcoming Testnet Reset & Trustless Work v2.0 Launch: line 592

## Rank 1: Explore Mainnet, Testnet & Futurenet: Roles, Use Cases & Connectivity
url: https://developers.stellar.org/docs/networks | scope: research_chunk | date: 2026-07-21 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-daybreak/1790471786-1dbdbdac-711d-4be6-ba7e-078be5f4ed3c/search-documents/0136.txt

## Testnet and Futurenet data reset​

Testnet and Futurenet are reset periodically to the genesis ledger to declutter the network, remove spam, reduce the time needed to catch up on the latest ledger, and help maintain the system. Resets clear all ledger entries (accounts, trustlines, offers, smart contract data, etc.), transactions, and historical data from Stellar Core, Horizon, and the Stellar RPC- which is why developers should not rely on the persistence of accounts or the state of any balances when using Testnet or Futurenet.

Futurenet resets are on a less regular cadence than Testnet resets and don&#x27;t have a set schedule.

Testnet resets typically happen 2-4 times per year at 17:00 UTC and are announced at least two weeks in advance on the Stellar Dashboard and through several developer community channels.

Here are the scheduled 2026 dates:

- December 16, 2026

If you run a Testnet or Futurenet Horizon instance, you need to re-join and re-sync to the network after a reset. Check out how to do that here: Testnet Reset.

Check out this How-To Guide on automating Testnet and Futurenet reset data.

## Rank 2: Automating Testnet and Futurenet Reset Data in Stellar
url: https://developers.stellar.org/docs/build/guides/basics/automate-reset-data | scope: research_chunk | date: 2025-10-15 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-daybreak/1790471786-1dbdbdac-711d-4be6-ba7e-078be5f4ed3c/search-documents/0049.txt

## Overview​

Stellar operates two primary testing environments: the Testnet and the Futurenet. These networks allow developers to experiment with Stellar features without risking real assets. Periodically, these networks are reset to ensure they remain clean and manageable.

## Rank 2 companion: (same URL)
url: https://developers.stellar.org/docs/build/guides/basics/automate-reset-data | scope: published_markdown_main_content | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-daybreak/1790471786-1dbdbdac-711d-4be6-ba7e-078be5f4ed3c/search-documents/0001.txt

# Automating Testnet and Futurenet reset data


## Overview

Stellar operates two primary testing environments: the [Testnet and the Futurenet](https://developers.stellar.org/docs/networks.md). These networks allow developers to experiment with Stellar features without risking real assets. Periodically, these networks are reset to ensure they remain clean and manageable.

## What is the Testnet and Futurenet reset?

Testnet and Futurenet are reset periodically to the genesis ledger to declutter the network, remove spam, reduce the time needed to catch up on the latest ledger, and help maintain the system. These resets take place approximately quarterly. Resets clear all ledger entries (accounts, trustlines, offers, smart contract data, etc.), transactions, and historical data from Stellar Core, Horizon, and the Stellar RPC, which is why developers should not rely on the persistence of accounts or the state of any balances when using Testnet or Futurenet.

You can check current reset dates [here](https://developers.stellar.org/docs/networks.md#testnet-and-futurenet-data-reset).

## Why resets are important

1. **Clean Slate:** Regular resets ensure that both Testnet and Futurenet provide a clean environment for testing. This helps in avoiding complications arising from old data or configurations.
2. **Performance:** Over time, test environments can accumulate a lot of data, which can slow down performance. Resets help in maintaining optimal performance.
3. **Protocol Updates:** Introducing new features or protocol changes often requires a reset to ensure compatibility and stability.
4. **Development Cycles:** Aligning with development cycles allows developers to plan their testing phases and ensures they have a reliable environment for their work.

## Data automation on Testnet and Futurenet

Automating blockchain state on Stellar's Testnet and Futurenet can streamline development workflows, ensuring that you can consistently test and validate your applications in these environments.

### Code walkthrough

### Prerequisites:

- [Node.js](https://nodejs.org/en) and `npm` installed.
- Stellar SDK for [JavaScript](https://www.npmjs.com/package/@stellar/stellar-sdk) and `fs` installed
- An understanding of the rudimentary, retry-enabled transaction polling function `submitTx` which we outlined in [another guide](https://developers.stellar.org/docs/build/guides/transactions/submit-transaction-wait-js.md)

### Code

```javascript
import {
  Networks,
  Keypair,
  TransactionBuilder,
  Operation,
  Address,
  StrKey,
  Contract,
  LiquidityPoolAsset,
  LiquidityPoolFeeV18,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { Server, Api } from "@stellar/stellar-sdk/rpc";
import fs from "fs";

// const networkRPC = "USE EITHER FUTERNET OR TESTNET RPC"
const networkRPC = "https://soroban-testnet.stellar.org";
// Example
// FOR FUTERENET - https://rpc-futurenet.stellar.org
// FOR TESTNET - https://soroban-testnet.stellar.org
const server = new Server(networkRPC);

// const networkURL = "USE EITHER FUTERNET OR TESTNET URL"
const networkURL = "https://friendbot.stellar.org";
// Example
// FOR FUTURENET - https://friendbot-futurenet.stellar.org
// FOR TESTNET - https://friendbot.stellar.org

const networkPassphrase = Networks.TESTNET; // or Networks.FUTURENET, PUBLIC

// Create an Account
async function createAccount(networkURL, SecretKey) {
  if (!SecretKey) {
    try {
      // Generate a keypair
      const pair = Keypair.random();
      // Fund the new account using Friendbot
      const response = await fetch(
        `${networkURL}?addr=${encodeURIComponent(pair.publicKey())}`,
      );
      const responseJSON = await response.json();
      console.log("Account created:", responseJSON);

      return pair;
    } catch (error) {
      console.error("Error creating account:", error);
    }
  } else {
    try {
      const pair = Keypair.fromSecret(SecretKey);
      console.log("Account Restored:", pair);
      return pair;
    } catch (error) {
      console.error("Error restoring account:", error);
    }
  }
}

// Issues an Asset
async function issueAsset(issuerKeys, receivingKeys, customAsset) {
  try {
    // First, the receiving account must trust the asset
    const receiver = await server.getAccount(receivingKeys.publicKey());
    let transaction = new TransactionBuilder(receiver, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        Operation.changeTrust({
          asset: customAsset,
          limit: "100000",
        }),
      )
      // setTimeout is required for a transaction
      .setTimeout(100)
      .build();
    transaction.sign(receivingKeys);
    const status = await submitTx(transaction);
    if (status !== Api.GetTransactionStatus.SUCCESS) {
      throw status;
    }
    console.log(`Receiver Trusting ${customAsset.code} Asset......`);

    // Second, the issuing account actually sends a payment using the asset
    const issuer = await server.getAccount(issuerKeys.publicKey());
    transaction = new TransactionBuilder(issuer, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: receivingKeys.publicKey(),
          asset: customAsset,
          amount: "1000", // change to desired amount you want to pay
        }),
      )
      // setTimeout is required for a transaction
      .setTimeout(100)
      .build();
    transaction.sign(issuerKeys);
    const status = await submitTx(transaction);
    if (status !== Api.GetTransactionStatus.SUCCESS) {
      throw status;
    }
    console.log(
      `Issuer Payment using ${
        customAsset.code
      } to  ${receivingKeys.publicKey()}`,
    );
  } catch (e) {
    console.error("An error occurred while issuing assets:", e);
  }
}

//Create Liquidity Pool
async function createLiquidityPool(accountKeypair, nativeAsset, customAsset) {
  try {
    const account = await server.getAccount(accountKeypair.publicKey());

    // Create the liquidity pool
    const poolIdAsset = new LiquidityPoolAsset(
      nativeAsset,
      customAsset,
      LiquidityPoolFeeV18,
    );
    const poolId = poolIdAsset.toString().split(":")[1]; // To Get the Pool ID

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: networkPassPhrase,
    })
      .addOperation(
        Operation.changeTrust({
          asset: poolIdAsset,
          limit: "100000", // Set an appropriate limit
        }),
      )
      .addOperation(
        Operation.liquidityPoolDeposit({
          liquidityPoolId: poolId,
          maxAmountA: "1000", // Amount of asset A to deposit
          maxAmountB: "500", // Amount of asset B to deposit
          minPrice: "0.5", // Minimum price ratio
          maxPrice: "2.0", // Maximum price ratio
        }),
      )
      .setTimeout(30)
      .build();
    transaction.sign(accountKeypair);
    const status = await submitTx(transaction);
    if (status !== Api.GetTransactionStatus.SUCCESS) {
      throw status;
    }
    console.log(
      `Creating Liquidity Pool for ${nativeAsset.code} and ${customAsset.code}`,
    );
  } catch (error) {
    console.error("Error creating liquidity pool:", error);
    throw error;
  }
}
//Deploy and Invoke Contract
async function deployAndInvokeContract(deployer, contractWasmFilePath) {
  try {
    // Step 1: Upload WASM
    const bytecode = fs.readFileSync(contractWasmFilePath);
    const account = await server.getAccount(deployer.publicKey());

    const uploadTransaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(Operation.uploadContractWasm({ wasm: bytecode }))
      .setTimeout(30)
      .build();

    const uploadTx = await server.prepareTransaction(uploadTransaction);
    uploadTx.sign(deployer);

    console.log("Submitting WASM upload transaction...");
    let status = await submitTx(uploadTx);
    if (status !== Api.GetTransactionStatus.SUCCESS) {
      throw status;
    }
    const wasmHash = status.returnValue.bytes();

    const deployerAddress = new Address(deployer.publicKey());

    // Deploy the Contract
    const createContractTransaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        Operation.createCustomContract({
          address: deployerAddress,
          wasmHash,
        }),
      )
      .setTimeout(30)
      .build();

    const createContractTx = await server.prepareTransaction(
      createContractTransaction,
    );
    createContractTx.sign(deployer);
    status = await submitTx(createContractTx);
    if (status !== Api.GetTransactionStatus.SUCCESS) {
      throw status;
    }
    console.log(`Contract Deployed...`);

    const contractAddr = Address.fromScAddress(
      returnContractResponse.returnValue.address(),
    );
    const contractId = contractAddr.toString();
    const contract = new Contract(contractId);

    // Invoke Contract
    const invokeContractTransaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call("hello", nativeToScVal("World", { type: "symbol" })),
      )
      .setTimeout(30)
      .build();

    const invokeContractTx = await server.prepareTransaction(
      invokeContractTransaction,
    );
    invokeContractTx.sign(deployer);
    const returnInvokeContractResponse = await submitTx(invokeContractTx);
    console.log(`Invoke Contract.`);

    const returnValues = scValToNative(
      returnInvokeContractResponse.returnValue,
    ).filter(Boolean);

    return { contractId, returnValues };
  } catch (error) {
    console.error("Error in contract deployment and invocation:", error);
    throw error;
  }
}

async function automateSetup() {
  try {
    //Check Network Status
    console.log("Checking network health...");
    const health = await server.getHealth();
    console.log("Network health:", health);

    // Flexible Account Configuration
    const secretkey =
      "SBGGNMUPVF2SDN4KZOJQFVFX7VDR4Q4NK3FMEFRQC64D3UBMFELKF5GC"; // This is an example of a user's secret key

    const accountOne = await createAccount(networkURL, secretkey);
    const accountTwo = await createAccount(networkURL);

    console.log("Issuing an Asset...");
    // Issue assets to these accounts
    const customAsset = new Asset("Boya", accountOne.publicKey());
    await issueAsset(accountOne, accountTwo, customAsset);

    // Create liquidity pool
    console.log("Creating liquidity pool...");
    const nativeAsset = Asset.native();
    await createLiquidityPool(accountTwo, nativeAsset, customAsset);

    // Deploy a contract
    console.log("Deploying contract...");
    // Ensure you have the contract Wasm file compiled and saved in the specified path.
    // Adjust this path as necessary
    const contractWasmFilePath =
      "./target/wasm32v1-none/release/hello_world.wasm";
    const ContractData = await deployAndInvokeContract(
      accountOne,
      contractWasmFilePath,
    );

    console.log("Contract ID:", ContractData.contractId);
    console.log("Return Values:", ContractData.returnValues.join(", "));
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

automateSetup();
```

The code defines several asynchronous functions:

1. `createAccount(networkURL)`:

Generates a new Stellar keypair (public and secret keys). Uses FriendBot to fund the new account on the test network. Returns the created keypair.

2. `issueAsset(issuerKeys, receivingKeys, customAsset)`:

Sets up a trust line for the receiving account to accept the custom asset, Issues the custom asset from the issuer account to the receiving account.

3. `createLiquidityPool(accountKeypair, nativeAsset, customAsset)`:

Creates a liquidity pool asset, Sets up a trust line for the pool and Deposits initial liquidity into the pool.

4. `deployAndInvokeContract(deployer, contractWasmFilePath)`:

Uploads the contract's WebAssembly (Wasm) code, creates and deploys the contract on the network, invokes the contract function and returns the contract ID and function return values

5. `automateSetup()`:

Initializes the Stellar server connection, Creates two accounts, Issues a custom asset, Creates a liquidity pool, Deploys a smart contract and returns the contract ID and function values.

**Helper functions**

`sleep(ms)`: A utility function to introduce delays in asynchronous operations.

`submitTx(tx)`: a retry-enabled transaction submission function `submitTx` outlined in [another guide](https://developers.stellar.org/docs/build/guides/transactions/submit-transaction-wait-js.md)

### Conclusion

Automating the setup of data on the Stellar Testnet and Futurenet can significantly enhance your development workflow, ensuring that you can quickly return to testing after a network reset. By following the above steps and using the provided code samples, you can streamline your processes and maintain consistency across resets.

## Rank 3: stellar.org Terms of Service (SDF, a Delaware non-profit corporation)
url: https://stellar.org/terms-of-service | scope: research_chunk | date: 2026-03-23 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-daybreak/1790471786-1dbdbdac-711d-4be6-ba7e-078be5f4ed3c/search-documents/0282.txt

## Use of lumens

Lumens are the native asset of the Stellar Network and are used to submit operations, create accounts, and as a bridge currency. Lumens are not legal tender, are not backed by any government, and are not subject to protections or insurance provided by the Federal Deposit Insurance Corporation or the Securities Investor Protection Corporation.

The fiat value of lumens is highly volatile, and lumens could lose all value. SDF does not control and is not responsible for the value of lumens and makes no guarantee, express or implied, of its value. You agree and acknowledge that any purchase of lumens by you or on your behalf is made voluntarily, willfully, and exclusively at your own risk.

We do not hold, store, or take custody of any user’s lumens, Stellar tokens, or related private keys. You agree and acknowledge that you are solely responsible for the secure storage of any lumens, Stellar tokens, and related private keys in your possession. You agree that in no event will SDF be liable for the security or control of any user’s lumens or related private keys.

## Rank 4: Stellar Weekly Roundup — week of Jun 5, 2026
url: https://lumenloop.com/research/stellar-weekly-roundup-week-jun-5-2026 | scope: research_chunk | date: 2026-06-12 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-daybreak/1790471786-1dbdbdac-711d-4be6-ba7e-078be5f4ed3c/search-documents/0022.txt

## Developer Infrastructure

SDF published the Quantum Preparedness Plan, a three-stage roadmap to migrate Stellar to post-quantum cryptography. Stage 1 (2026) brings quantum-safe signature verification to Soroban contract accounts. Stage 2 (2027) adds quantum-safe signers as first-class accounts on the classic network. Stage 3 deprecates Ed25519 based on quantum computing advances. Decrypt noted that Stellar&#x27;s separation of account identity from signing keys means existing addresses migrate without creating new accounts, unlike Bitcoin and Ethereum.

The June 17 Testnet reset is cancelled. SDF cut reset frequency to reduce developer burden, with the only remaining scheduled reset of 2026 set for December 16. Developer Kaan Kacar released stellar-build, an experimental bundle of 42 skills, AI devrel personas, and curated data on 700+ live projects and 9,000+ repos. James Bachini published a three-part SoroPG Academy series covering Soroban from first deploy to MCP-connected AI agent workflows.

## Rank 5: passkey-kit: Deterministic deployer security model
url: https://github.com/stellar/passkey-kit/blob/main/docs/security-deterministic-deployer.md | scope: research_chunk | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-daybreak/1790471786-1dbdbdac-711d-4be6-ba7e-078be5f4ed3c/search-documents/0142.txt

## Operational follow-ups (outside this change)

Open ops tasks, not SDK defects. The sign-only SDK works without them; they
reduce operational risk on testnet.

- Harden the testnet deployers (`0/0/0` today) and make post-reset provisioning
  fail closed, so a network reset cannot recreate an unhardened `AccountEntry`
  that address authorization then depends on. The relayer proxy already refuses
  to Friendbot-fund a shared deployer.
- Sweep or retire the superseded testnet deployer listed above. Like every shared
  deployer its key is publicly derivable, so it must not hold a balance.

## Rank 6: Protocol 23 Upgrade Guide
url: https://stellar.org/blog/developers/protocol-23-upgrade-guide | scope: research_chunk | date: 2025-06-10 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-daybreak/1790471786-1dbdbdac-711d-4be6-ba7e-078be5f4ed3c/search-documents/0027.txt

## What do you need to do to prepare?

The August 14 Testnet reset will clear all Testnet ledger entries including account, asset, and contract data, so please be prepared to recreate any you need to persist! For tips and more info, see the Testnet docs.

Also, after the August 14 Testnet reset, you will need to upgrade to new versions of Stellar-related software including Stellar Core, RPC, Horizon, and Stellar SDKs as soon as possible to ensure Testnet compatibility even if you installed new versions prior to the July 17 Testnet upgrade.

Apologies for the inconvenience, and for the short notice: normally, we don&#x27;t reset Testnet as part of a protocol upgrade, but this time it&#x27;s necessary due to some updates to Stellar Core. The August 14 Testnet reset will replace the previously scheduled Q3 Testnet reset.

If you use a Stellar SDK

For your Testnet integration, upgrade to the latest version of the relevant Stellar SDK on August 14.

For your Mainnet integration, upgrade to the latest version of relevant Stellar SDKs before September 3.

We will update the releases section below to indicate when an SDK release with Protocol 23 support is available, so check back if an SDK you use isn’t listed yet.

If you run Stellar infrastructure

If you use Docker images, pull the Protocol 23 builds from the Docker registry. If you build from source or our Debian packages, make sure to also update your stellar-core, stellar-horizon, and stellar-rpc binaries to the Protocol 23 builds.

If you don’t run your own infrastructure but still need access to a Horizon or RPC instance, you can use an infrastructure provider. Here are lists for Horizon and RPC.

If you run a validator

The Protocol 23 upgrade vote is scheduled for September 3, 2025 at 1700 UTC. You should arm your validator with the following command:

upgrades?mode=set&upgradetime=2025-09-03T17:00:00Z&protocolversion=23

## Rank 7: On-chain signature & transaction sharing
url: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0021.md | scope: research_chunk | date: 2018-08-31 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-daybreak/1790471786-1dbdbdac-711d-4be6-ba7e-078be5f4ed3c/search-documents/0089.txt

## Specifications

```
(on **collection network**)
source: **mirror account**
memo: (rethash) {transaction_hash}
operations:
  - Send 0.0000001 XLM to **collection account**
  - Set data entry 'Send' to '{signature1_value}'
  - Set data entry 'Send' to '{signature2_value}'
```

Implementators must only send signatures that haven't been shared yet.

### Fetching signatures for a specific transaction

**collection account** transaction history is scanned backward for **sharing
transactions** with _rethash memo_ equal to the hash **main transaction** and
source being one of the **legit signers**. Each matched **sharing transaction**
is scanned for _manageData_ operations which set an account entry named 'Send',
and retrieve the associated value as a possible signature. A signature is
considered legit and must be used only when it is from a **legit signer**.

### Default **collection network**

Specifying a default **collection network** allow to skip setting
'conf:multisig:network' in most case. The default **collection network** have
to be specified in the present SEP so that every implementation use the same.

At that time the reference implementation is set to use test network by
default. The advantage of using test network are: it exists, it is free to use,
it is maintained by the SDF. The disadvantage is that it may get reset at some
point.

Using public network as the default have the advantage of robustness, but come
with a cost and would burden the network. It seems better to only leave the
option open for when it is really meaningful (smart contracts).

Running a custom network seems ideal, however this makes sense only if we can
keep it running smoothly on the long run. It means a core of validator have to
take on this task. It also imply a cost in money and time.

Reviewers are welcome to discuss this issue so we can make a clever decision in
the coming month.

## Rank 8: What do you need to do to prepare?
url: https://stellar.org/blog/developers/protocol-21-upgrade-guide | scope: main_visible_text | date: 2024-05-07 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-daybreak/1790471786-1dbdbdac-711d-4be6-ba7e-078be5f4ed3c/search-documents/0035.txt

Protocol 21 upgrade guide
Author
Nicole Adair
Publishing date
2024-05-07T09:05:00.000Z
Soroban, the smart contract platform on Stellar, launched on Mainnet following a successful validator vote on February 20, 2024. On June 18, 2024, Stellar public network validators voted to upgrade the network to Protocol 21, which activates five new Core Advancement Proposals (CAPs) on Stellar Mainnet.
These five CAPs introduce some exciting new features, such as passkey signing support and an improvement to state archival (authored by community member, tdep), as well as a few overall cost improvements for smart contract transactions.
This guide is designed to help businesses and developers who have not done so already to upgrade to Protocol 21 now that it’s live on Mainnet. To ensure that your project, protocol, product or service is compatible with Protocol 21, please check that your Stellar-related software is up to date.
You can read all about what's included in Protocol 21 in the announcement blog, and stay up to date on any and all Protocol 21-related announcements in the #protocol-21 channel in the Stellar Developer Discord, where the ecosystem coordinates and shares information about the upgrade, or join the dev-mailing list.
Key dates
May 14: Testnet upgrade. Complete!
May 30: Stable releases of Stellar Core, Horizon, RPC. Complete!
June 11: Testnet reset. Complete!
June 18: Mainnet upgrade vote. Complete!
What do you need to do to prepare?
Now that the network has upgraded to Protocol 21, you must install up-to-date versions of any and all Stellar-related software you use to ensure continued compatibility with the network!
Also, be sure to re-upload your existing Wasms that were created in Protocol 20 to reduce the cost of invoking them and make further executions cheaper, especially as the cost of the re-upload is much lower than the cost of initial upload. To do this re-upload, use the soroban contract install CLI command.
Context: The semantics of CAP-0054 are important to note specifically for existing Wasms uploaded in Protocol 20. CAP-0054 introduces ContractCodeCostInputs that are written along with the Wasm entries uploaded starting in protocol 21 which will tighten the cost model for VM instantiation, but Wasm uploaded in Protocol 20 will be missing ContractCodeCostInputs. Due to the missing inputs, Protocol 20 code will not be able to take advantage of the tightened cost model until they are re-uploaded in Protocol 21, which will write the ContractCodeCostInputs to the existing Wasm entry.
If you use Testnet
The list of releases required to support Protocol 21 on Testnet has been updated on the release page of the docs. At this point, stable releases of Stellar Core, Horizon, RPC, the JS SDK, several other SDKs, and the CLI are available. Make sure to install up-to-date versions of any and all Stellar-related software, using the following command:
cargo install --locked soroban-cli --version 21.0.0-rc.1
If you use a Stellar SDK
You should be running the latest version of the SDK. We will update the releases section below to indicate when an SDK release with Protocol 21 support is available, so check back if an SDK you use isn’t listed yet.
If you run Stellar infrastructure
Upgrade to the latest release of Stellar Core and/or Horizon. If you use Docker images, pull the latest from the Docker registry. You should be on Stellar Core v21.0.0 or above.
If you use the Soroban RPC
If you run your own, make sure to upgrade your software! If you don’t, please be aware that the Stellar Development Foundation does not offer a free RPC instance for Mainnet, so you may need to choose an infrastructure provider to use. Here’s a list.
If you run a validator
Be sure to upgrade Stellar Core to v21.0.0, if you have not done so already.
You should also make sure to set the DEPRECATED_SQL_LEDGER_STATE flag when you deploy the package.
Context: Stellar-core version 21.0 introduces a new config flag called DEPRECATED_SQL_LEDGER_STATE. If this flag is not set, stellar-core will not be able to start. This flag must be set when a node upgrades to the stellar-core 21.0 package. This flag must be set when the package is deployed, not when the network actually upgrades to Protocol 21.
This flag’s default setting, and the setting that most validator operators should use, is DEPRECATED_SQL_LEDGER_STATE=false. If DEPRECATED_SQL_LEDGER_STATE=true, the node may experience performance degradation and fall behind the rest of the network. DEPRECATED_SQL_LEDGER_STATE should only be set to true if you either:
Must run stellar-core with the “in-memory” mode flag.
Directly query data from stellar-core’s SQL backend, and the data being queried is not supported by BucketListDB (see the “Deprecated Features” listed in the Upcoming Database Changes in Protocol 21 blog).
Operators running a captive-core as part of Horizon or RPC will have the flag set automatically, unless they are still using "in-memory" mode (configured via CAPTIVE_CORE_USE_DB=false), in which case they must set CAPTIVE_CORE_USE_DB=true. Note that this means "in-memory" mode is effectively disallowed by captive-cores starting in Protocol 21.
For additional information, context, and instructions related to the BucketListDB update, please read the Upcoming Database Changes in Protocol 21 blog and join the Stellar Dev Discord #validators channel.
To view current network settings, see a history of protocol upgrades, and see pending proposals for future upgrades, take a look at https://stellar.expert/explorer/public/protocol-history
In the future, there will be more votes to adjust network settings based on network usage as well as subsequent protocol upgrades, so please make sure to stay up to date on the #validators channel on the Stellar Dev Discord. It’s crucial for validators to stay informed and participate in network governance!
If you are interested in learning more about Soroban network settings, see the docs: https://github.com/stellar/stellar-core/blob/master/docs/software/soroban-settings.md
Protocol 21 releases
Below are up-to-date links to all available releases relevant to Protocol 21. In general, please make sure to check release notes for specific instructions and requirements, and unless otherwise indicated, opt for the “Latest Release.”
Stellar infrastructure
Stellar Core
Horizon
Soroban RPC
SDKs
JavaScript Base
JavaScript SDK (now includes Soroban RPC client)
Go (horizonclient & txnbuild)
Java
Python
iOS
PHP
C# .NET
Flutter
Elixir Stellar SDK
Reminder: The soroban-client was updated along with Protocol 20 JavaScript SDK releases, but will no longer be maintained. Users should use the JavaScript SDK for their app needs, including communicating with the Soroban RPC, as future changes will only be made there. Please read the Migration Guide for how to upgrade to that package.
Context
On February 20, 2024, validators voted to upgrade to Protocol 20, introducing Soroban smart contracts to Stellar’s public network. Since then, developers all over the world have been successfully deploying smart contracts to the Stellar Mainnet.
On June 18, validators voted to upgrade the network to Protocol 21, which brings five CAPs introducing new features, such as passkey signing support and an improvement to state archival, to Mainnet. To read more about each of the CAPs included in Protocol 21, see the Protocol 21 announcement blog post and the following links:
CAP-0051 Smart Contract Host Functionality: Secp256r1 Verification
CAP-0053 Separate host functions to extend the TTL for contract instance and contract code
CAP-0054 Soroban refined VM instantiation cost model
CAP-0055 Soroban streamlined linking
CAP-0056 Soroban intra-transaction module caching
To stay informed, ask questions, make suggestions, or share intel, make sure to join the Stellar Dev Discord and check out the #protocol-21 channel, which is where the ecosystem is coordinating and sharing information about the upgrade.
Changelog
06/18/2024 — Validators voted to upgrade the public network to Protocol 21, activating five new CAPs that bring exciting new features to Stellar Mainnet. Context, updates, and additional instructions were added following the Mainnet upgrade vote that occurred on June 18.
06/11/2024 — Testnet reset is complete.
05/30/2024 — Stellar Core, Horizon, RPC stable releases have been released! Instructions and context around stable releases have been added.
05/14/2024 — The Testnet successfully upgraded to Protocol 21 today. Key dates were updated to reflect this upgrade, and version numbers were added to Protocol 21 release links to reflect the minimum supported versions.

## Rank 9: Upcoming Testnet Reset & Trustless Work v2.0 Launch
url: https://trustlesswork.com/escrow-times/news-v2-testnet-reset | scope: ai_summary | date: 2025-06-04 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-daybreak/1790471786-1dbdbdac-711d-4be6-ba7e-078be5f4ed3c/search-documents/0036.txt

Upcoming Testnet Reset & Trustless Work v2.0 Launch

The Stellar Q2 testnet will reset on June 18 at 17:00 UTC, wiping all contracts, assets, accounts, and data. Simultaneously, Trustless Work v2.0 will launch on the main branch with major upgrades including multi-release escrows, API changes, and new escrow logic. Developers should prepare for breaking changes with upcoming guides and documentation.

Stellar's Q2 testnet reset is scheduled for June 18 at 17:00 UTC, as per the status page, which will erase all network data including contracts, assets, accounts, and escrows, requiring users to recreate configurations. Coinciding with this reset, the Trustless Work project will update its core repositories' main branch to v2.0, introducing breaking changes such as multi-release escrow integration, API structure modifications, new escrow logic, and an upgraded demo app and dApp interface. This version is pre-audit for mainnet release. Developers using the demo, API, or SDK should anticipate further updates, while contributors via Only Dust can expect new issues for the OD Hack. Upgrade guides and documentation are forthcoming, with minimal downtime of 1-2 days, though full usability awaits restoration of testnet assets like USDC.

