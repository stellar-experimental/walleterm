# Evidence for: What official Stellar guidance requires clients to check a transaction hash after a timeout instead of assuming failure or submitting a new transaction?

Contents (section: first line):
- Rank 1: Hosted Deposit and Withdrawal: line 18
- Rank 1 companion: (same URL): line 68
- Rank 2: Add support for smart contracts: line 210
- Rank 3: Transaction Submission, Timeouts, and Dynamic Fees FAQ: line 235
- Rank 3 companion: (same URL): line 250
- Rank 4: Submit a Transaction: line 324
- Rank 5: Timeout: line 331
- Rank 5 companion: (same URL): line 366
- Rank 6: sendTransaction: line 393
- Rank 7: Error Handling: line 412
- Rank 8: Cross-Border Payments API: line 483
- Rank 9: Automating Testnet and Futurenet reset data: line 563
- Rank 10: Submit a transaction to Stellar RPC using the JavaScript SDK: line 925

## Rank 1: Hosted Deposit and Withdrawal
url: https://developers.stellar.org/docs/build/apps/wallet/sep24 | scope: research_chunk | date: 2026-06-15 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0052.txt

## Submitting Withdrawal Transfer​

Code for submitting transactions to Stellar should be developed thoughtfully. The SDF has a documentation page dedicated to submitting transactions and handling errors gracefully. Here are a few things you need to keep in mind:

- Offer a high fee. Your fee should be as high as you would offer before deciding the transaction is no longer worth sending. Stellar will only charge you the minimum necessary to be included in the ledger -- you won&#x27;t be charged the amount you offer unless everyone else is offering the same amount or greater. Otherwise, you’ll pay the smallest fee offered in the set of transactions included in the ledger.

- Set a maximum timebound on the transaction. This ensures that if your transaction is not included in a ledger before the set time, you can reconstruct the transaction with a higher offered fee and submit it again with better chances of inclusion.

- Resubmit the transaction when you get 504 status codes. 504 status codes are just telling you that your transaction is still pending -- not that it has been canceled or that your request was invalid. You should simply make the request again with the same transaction to get a final status (either included or expired).

Finally, let&#x27;s track transaction status updates. In this example we simply check if the transaction has been completed:

- TypeScript

const watcher = sep24.watcher();

const onSuccess = (transaction) => {
 // transaction came back as completed / refunded / expired
 console.log("Transaction is completed");
};

const onError = (transaction) => {
 // runtime error, or the transaction comes back as
 // no_market / too_small / too_large / error
};

const { refresh, stop } = watcher.watchOneTransaction({
 authToken,
 assetCode: asset.code,
 id: successfulTransaction.id,
 onMessage,
 onSuccess,
 onError,
});
Edit this pageLast updated on Jun 15, 2026 by Elliot VorisPreviousStellar AuthenticationNextRecovery
- Get Anchor Information
- Interactive Flows
- Basic Flow
- Providing KYC Info
- Changing Stellar Transfer Account

- Getting Transaction Info
- Tracking Transaction
- Fetching Transaction

- Submitting Withdrawal Transfer

## Rank 1 companion: (same URL)
url: https://developers.stellar.org/docs/build/apps/wallet/sep24 | scope: published_markdown_main_content | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0324.txt

# Hosted Deposit and Withdrawal

The [SEP-24] standard defines the standard way for anchors and wallets to interact on behalf of users. Wallets use this standard to facilitate exchanges between on-chain assets (such as stablecoins) and off-chain assets (such as fiat, or other network assets such as BTC).

During the flow, a wallet makes several requests to the anchor, and finally receives an interactive URL to open in iframe. This URL is used by the user to provide an input (such as KYC) directly to the anchor. Finally, the wallet can fetch transaction information using query endpoints.

## Get Anchor Information

Let's start with getting an instance of `Sep24` class, responsible for all SEP-24 interactions:



First, let's get the information about the anchor's support for [SEP-24]. This request doesn't require authentication, and will return generic info, such as supported currencies, and features supported by the anchor. You can get a full list of returned fields in the [SEP-24 specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md#info).



## Interactive Flows

Before getting started, make sure you have connected to the anchor and received an authentication token, as described in the [Stellar Authentication] wallet guide. We will use the `authToken` object in the examples below as the [SEP-10] authentication token, obtained earlier.

To initiate an operation, we need to know an asset. You may want to hard-code it, or get it dynamically from the anchor's info file, like shown below (for USDC):



> [!NOTE]
>
> Before starting with the deposit flow, make sure that the user account has [established a trustline](https://developers.stellar.org/docs/build/apps/wallet/stellar.md#modify-assets-trustlines) for the asset you are working with.
>

### Basic Flow

Let's start with a basic deposit:



As a result, you will get an [interactive response](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md#deposit-and-withdraw-shared-responses) from the anchor.

Open the received URL in an iframe and save the transaction ID for future reference:



Similarly to the deposit flow, a basic withdrawal flow has the same method signature and response type:



### Providing KYC Info

To improve the user experience, the [SEP-24] standard supports passing user KYC to the anchor via [SEP-9]. In turn, the anchor will pre-fill this information in the interactive popup.

> [!NOTE]
>
> While [SEP-9] supports passing binary data, the current version of the SDK doesn't offer such functionality.
>

> [!NOTE]
>
> At the time, accepted [SEP-9] is not strictly typed yet. Improved typing will be offered in future versions.
>



### Changing Stellar Transfer Account

By default, the Stellar transfer will be sent to the authenticated account (with a memo) that initiated the deposit.

While in most cases it's acceptable, some wallets may split their accounts. To do so, pass additional account (and optionally a memo):



Similarly, for a withdrawal, the origin account of the Stellar transaction could be changed:



## Getting Transaction Info

On the typical flow, the wallet would get transaction data to notify users about status updates. This is done via the [SEP-24] `GET /transaction` and `GET /transactions` endpoint.

Alternatively, some anchors support webhooks for notifications. Note that this feature is not widely adopted yet.

### Tracking Transaction

Let's look into how to use the wallet SDK to track transaction status changes. We will use `Watcher` class for this purpose. First, let's initialize watcher and start tracking a transaction.



Alternatively, we can track multiple transactions for the same asset.



} />

### Fetching Transaction

While `Watcher` class offers powerful tracking capabilities, sometimes it's required to just fetch a transaction (or transactions) once. The `Anchor` class allows you to fetch a transaction by ID, Stellar transaction ID, or external transaction ID:



It's also possible to fetch transaction by the asset



## Submitting Withdrawal Transfer

Previously, we took a look at starting the withdrawal flow. Now, let's take a look at a full example.

First, start the withdrawal:



Next, open an interactive url :



After that we need to wait until the anchor is ready to receive funds. To do so, we will be waiting until transaction reaches `pending_user_transfer_start` status. This code uses a simple watching (polling) mechanism with no bail-out condition. The application’s code should be more robust.



Next, sign and submit the Stellar transfer:



Where `keypair` is the SEP-10 authenticated account. If you want to transfer funds from a different address, refer to [Changing Stellar Transfer Account](#changing-stellar-transfer-account) section.

Code for submitting transactions to Stellar should be developed thoughtfully. The SDF has a documentation page dedicated to [submitting transactions and handling errors gracefully]. Here are a few things you need to keep in mind:

- Offer a high fee. Your fee should be as high as you would offer before deciding the transaction is no longer worth sending. Stellar will only charge you the minimum necessary to be included in the ledger -- you won't be charged the amount you offer unless everyone else is offering the same amount or greater. Otherwise, you’ll pay the smallest fee offered in the set of transactions included in the ledger.
- Set a maximum timebound on the transaction. This ensures that if your transaction is not included in a ledger before the set time, you can reconstruct the transaction with a higher offered fee and submit it again with better chances of inclusion.
- Resubmit the transaction when you get 504 status codes. 504 status codes are just telling you that your transaction is still pending -- not that it has been canceled or that your request was invalid. You should simply make the request again with the same transaction to get a final status (either included or expired).

Finally, let's track transaction status updates. In this example we simply check if the transaction has been completed:



[sep-9]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0009.md
[sep-10]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
[sep-24]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
[stellar authentication]: ./sep10.mdx
[submitting transactions and handling errors gracefully]: ../../../data/apis/horizon/api-reference/errors/error-handling.mdx

## Rank 2: Add support for smart contracts
url: https://developers.stellar.org/docs/build/guides/basics/classic-transition | scope: research_chunk | date: 2026-08-12 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0285.txt

## 3. Transaction Workflow Changes​

### Building Transactions​

Transaction construction involves specifying a call to a contract function rather than any of the built-in operations Stellar offers. When building these contract calls, it is necessary to specify the relevant contract ID and function arguments according to the contract interface. See more at Documentation for Contract Interaction - Stellar Transaction.

You can still use the libraries or tools you’re already familiar with to assemble these transactions, but keep in mind the extra steps required for contract invocation.

### Simulating Transaction​

Transactions that execute smart contracts must be simulated before sending. That is because simulation doesn’t just provide the results of executing transactions; it also provides essential information such as the transaction’s read/write footprint and authorizations needed, and clients must add this information to the transaction before sending it to the network for execution.

### Signing & Auth Entries​

Smart contracts can define their own custom authorization logic, meaning you might need additional signatures for specific authorization data to prove permission for certain contract calls. Each contract can have its own requirements, so a good practice is to leverage transaction simulations to identify specific authorization requirements for a transaction.

### Asynchronous Transaction Submission​

Unlike Horizon, RPC only queues transactions for inclusion rather than waiting for final confirmation. Therefore, it is necessary to poll the transaction’s status to determine if a transaction eventually succeeds or fails. This asynchronous model, as well as other common challenges, can be seen at the Documentation for Dapp Development - Common Pitfalls.

### Guides in this category:

## Rank 3: Transaction Submission, Timeouts, and Dynamic Fees FAQ
url: https://stellar.org/blog/developers/transaction-submission-timeouts-and-dynamic-fees-faq | scope: research_chunk | date: 2021-02-08 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0029.txt

## Why do I get a 504 timeout error?

Most people (including you, dear reader, if you&#x27;re getting this error) use Horizon, the Stellar API, to submit transactions to the network. Transaction submission — and the subsequent steps required to ratify a transaction and apply it to the ledger — is a complicated, asynchronous process. Horizon is middleware designed to make that process simpler for the user. It posts transactions to a Stellar Core node, and waits to hear results before returning an HTTP response.

When you submit a transaction to Horizon, Horizon first attempts to decode it. If it can&#x27;t — usually because there&#x27;s some structural error with the XDR — Horizon returns a 400 error, and lets you know that the transaction is malformed. If the transaction is well formed, Horizon posts it to a Stellar Core node, and that node performs a validity check. If the node discovers the transaction is invalid — say it doesn&#x27;t have the right sequence number, or the fee it offers is below the 100-stroop network minimum — Horizon returns a 400 error, and lets you know what went wrong.

If the transaction is well formed and passes the validity check, the Stellar Core node propagates it to the rest of the network for possible inclusion in the ledger. When network activity is below the ledger limit, the transaction goes through and incurs the minimum fee, Stellar Core notifies Horizon, and Horizon returns a 200 Success response. The happy path!

However, if the network is in surge pricing mode and the transaction&#x27;s fee bid is too low to make the ledger, the Stellar Core node hangs onto it, and tries to resubmit it for the next 3 ledgers. Horizon doesn&#x27;t have direct insight into that process, so it waits 30 seconds, and if it doesn&#x27;t hear back from Stellar Core, it concludes that there is no success response coming, and lets the user know that the request has timed out. That&#x27;s the best it can do.

That means that when you get a 504, there&#x27;s still a chance that your transaction will make the ledger — Horizon doesn&#x27;t know for sure whether or not Stellar Core has discarded the transaction — which is why we strongly suggest using timebounds to limit the submission window. However, if you are getting a lot of 504s, it is likely that your fee bids are generally too low. Submit higher fees.

## Rank 3 companion: (same URL)
url: https://stellar.org/blog/developers/transaction-submission-timeouts-and-dynamic-fees-faq | scope: main_visible_text | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0353.txt

Blog Article
Transaction submission, timeouts, and dynamic fees FAQ
Author
Justin Rice
Publishing date
2021-02-08T00:00:00.000Z
Transactions
Timeouts
Fees
Getting more errors than you anticipated when submitting transactions to Stellar? Unsure how to deal with them? This FAQ is for you!
The goal is to give a high-level explanation of a Horizon error several people have asked about — the 504 timeout — and along the way, to answer some fundamental questions about transaction submission, fees, and surge pricing on Stellar. It should help you, a developer or business building on Stellar, understand how to optimize your fee submission so your transactions are more likely to get processed by the network in a timely fashion.‍
Key takeaway: if you are getting a lot of 504 timeout errors from Horizon, chances are that the network is in surge pricing mode, and the fee you're submitting for your transactions is too low. The solution: submit higher fee bids. Fees on Stellar are dynamic, so the fee you submit is the maximum you're willing to pay. You will be charged the minimum necessary to make the ledger.
In addition to this FAQ, we also have a guide — Handling Errors Gracefully — that goes deep into common error types, and walks through practical suggestions for dealing with them. You should check that out to understand the nuts and bolts of transaction submission and error handling.
I'm having trouble submitting transactions. are there issues with the network?
No. The network is humming along nicely. It has processed almost 2 billion operations since its inception, and about 500 million in the past 6 months alone. Ledgers continue to close in about 5 seconds, and throughput remains high. For a quick visual, check out the network dashboard.
What is happening, however, is that there is more network activity, which is increasing competition for ledger space. When the number of operations submitted to the network exceeds the ledger limit, the network enters surge pricing mode, at which point, fees serve as bids, and transactions offering higher fees per operation are prioritized for inclusion in the transaction set that's applied to the ledger. If your fee bid is too low, you may get priced out.
What is the Ledger limit?
Currently, the public network is configured to allow 1,000 operations per ledger.
Quick reminder: in the Stellar vernacular, an operation is an individual command that modifies the ledger. At the moment, there are 18 possible operations, including the payment operation, path payment operations, and operations to place buy and sell orders on the DEX.
A transaction is a bundle of 1-100 operations. To modify the ledger — in other words, to do something on Stellar — you take operations, bundle them into a transaction, and wrap that in a transaction envelope containing necessary signatures, which you then submit to a Stellar Core node. Generally, you create and sign the transaction using a Stellar SDK, and generally, that Stellar SDK uses Horizon, the Stellar API, to submit it.
Assuming a transaction is valid, the Stellar Core node that receives it shares it with other Stellar Core nodes, who work together to create a combined set of valid transactions. Nodes that are armed to validate then ratify that transaction set via a multi-stage voting process, and apply it to change the state of the ledger. For more on that process, check out the Transaction Lifecycle doc.
Since the Protocol 11 upgrade in 2019, the maximum size of a transaction set — aka the ledger limit — has been measured in operations/ledger rather than transactions/ledger. The rationale: operations are what get applied to alter accounts, balances, and orders, and they're not variable in size like transactions, so using them to set the ledger limit allows for more consistent throughput. The protocol essentially peers into transactions, counts the number of operations inside, and tries to accommodate as many transactions as possible given the ledger limit.
What determines the Ledger limit?
The ledger limit is a network configuration, and like all network configurations, it's determined by validators, who vote on it just like they vote to apply a transaction set to the ledger. Shortly after the Protocol 11 upgrade, validators set the ledger limit to 1,000 ops/ledger, and it's remained there ever since.
When setting the ledger limit, validators attempt to strike a balance: they want to allow enough throughput to support network usage, but they also want to make sure that nodes across the world with access to lower end hardware and slower connectivity can still keep up and participate in consensus.
At any time, Stellar-network validators can vote to increase the ledger limit. However, given that a large portion of current network traffic consists of bot-submitted arbitrage transactions destined to fail (more on that below), it is unlikely that increasing the ledger limit right now would do much to reduce surge pricing. It would just give the bots more room to operate.
If you are reading this, and have an opinion about ledger limits, keep in mind that you can run your own validator to participate in the network and vote on where to set them. Who can run a Stellar validator? Anyone can. You can!
How do fees work on Stellar?
Fees on Stellar are dynamic. There is a minimum fee required for all transactions, which, like the ledger limit, is a network configuration determined by validators. Currently, it is 100 stroops per operation. That's 0.00001 XLM.
When network activity is below the ledger limit, all valid transactions make the ledger and incur the minimum fee. When the number of operations submitted exceeds the ledger limit, the network enters surge pricing mode. Since not every transaction can make the ledger, transactions are prioritized based on the fee they specify. The transactions offering the highest fee per operation make the ledger first. For more information on how that works, see the Fees doc.
Where should I set my fee?
Think of fees as bids. How much are you willing to pay to get your transaction processed? That's the fee you should bid. The maximum amount you are willing to pay. You will actually be charged the minimum amount necessary to make the ledger.
How much are people actually getting charged? To get a sense, I used the public BigQuery Stellar dataset to pull fee data for the month of January, 2021. Here's what I discovered:
The average fee/op charged in January 2021 was 1,221 stroops. That's 0.0001221 XLM (about $0.00004762 at the time of writing).
52% of transactions incurred the minimum fee of 100 stroops/op.
In other words, even though surge pricing was frequently in effect in January, fees were still a fraction of a fraction of a cent.
Generally, consumer-facing apps and other services that want to ensure their transactions make the ledger in a timely fashion specify a fee of ~100,000 stroops. That's 0.01 XLM, which most users still find incredibly cheap to move money around the world. As network activity continues to increase, you may find you need to adjust your fee bid to remain competitive, but for now, you should be able to set it around 100,000 stroops and forget it.
Why do I get a 504 timeout error?
Most people (including you, dear reader, if you're getting this error) use Horizon, the Stellar API, to submit transactions to the network. Transaction submission — and the subsequent steps required to ratify a transaction and apply it to the ledger — is a complicated, asynchronous process. Horizon is middleware designed to make that process simpler for the user. It posts transactions to a Stellar Core node, and waits to hear results before returning an HTTP response.
When you submit a transaction to Horizon, Horizon first attempts to decode it. If it can't — usually because there's some structural error with the XDR — Horizon returns a 400 error, and lets you know that the transaction is malformed. If the transaction is well formed, Horizon posts it to a Stellar Core node, and that node performs a validity check. If the node discovers the transaction is invalid — say it doesn't have the right sequence number, or the fee it offers is below the 100-stroop network minimum — Horizon returns a 400 error, and lets you know what went wrong.
If the transaction is well formed and passes the validity check, the Stellar Core node propagates it to the rest of the network for possible inclusion in the ledger. When network activity is below the ledger limit, the transaction goes through and incurs the minimum fee, Stellar Core notifies Horizon, and Horizon returns a 200 Success response. The happy path!
However, if the network is in surge pricing mode and the transaction's fee bid is too low to make the ledger, the Stellar Core node hangs onto it, and tries to resubmit it for the next 3 ledgers. Horizon doesn't have direct insight into that process, so it waits 30 seconds, and if it doesn't hear back from Stellar Core, it concludes that there is no success response coming, and lets the user know that the request has timed out. That's the best it can do.
That means that when you get a 504, there's still a chance that your transaction will make the ledger — Horizon doesn't know for sure whether or not Stellar Core has discarded the transaction — which is why we strongly suggest using timebounds to limit the submission window. However, if you are getting a lot of 504s, it is likely that your fee bids are generally too low. Submit higher fees.
How do I deal with 504 timeout errors?
As mentioned at the top of the FAQ, we will publish a technical guide to handling errors gracefully. For details and code examples, you should check that out as soon as it's available.
Generally, though, you should do three things when submitting a transaction:
Set a timebound. That way, if the transaction doesn't succeed within the time specified, you know it's not hanging around waiting to be processed. You can try again knowing you won't accidentally, say, duplicate a payment.
Set the highest maximum fee you are willing to pay. You will actually pay the minimum amount necessary to make the ledger. Under normal circumstances, even with a higher max fee set, you will pay the network minimum — currently 100 stroops.
Implement a retry loop with increasing delay (e.g. 30s, 60s, 90s). It should only execute once you've exceeded the timebound you set.
If you do those three things, you should be able to sidestep or work around timeouts, and to consistently get your transactions onto the ledger.
Are timeout errors and rate limiting the same thing?
No. If you are using the public, SDF-maintained Horizon instance, you will get a 429 error if you try to submit more than 3,600 requests per hour. It's a free, public API, and other people need to use it, too. Don't be a resource hog! If you're getting rate limited, it's time to set up your own Horizon instance.
What's the best way to submit a high volume of transactions?
If you are trying to submit a high volume of transactions, you may be experiencing issues related to sequence number management. The best practice is to use a channel account which you can read all about in the Channels doc.
What's with all the failed transactions on the Ledger?
If you look at the network dashboard, you may notice a high volume of failed transactions included in the ledger. Those are caused by a slew of trading bots attempting to take advantage of a small number of arbitrage opportunities.
Stellar has a unique set of operations called path payments, which allow the simultaneous sending and conversion of currency — I send USD; you receive NGN — and they make it incredibly easy to use the network for cross-border and cross-currency transactions.
Path payments convert currency by consuming orders in Stellar’s built-in order books, and sometimes an inefficiency in the order books gives rise to a pricing mismatch. We won’t get into the details here, but savvy developers realized that — every once in a while — you can submit a path payment and end up with a tiny bit more money than you started with, and they built bots to look for those opportunities, and to try to capitalize on them.
A lot of people built arbitrage bots, and they all look for the same opportunities. When one comes up, it’s a race: the winning bot submits a transaction that claims the opportunity and succeeds; the remaining bots submit transactions conditioned on the existence of that opportunity, and since it’s no longer available, those transactions fail.
Because those transactions met the minimum fee requirement, they fail after they’re included in the ledger rather than before, so they end up in everyone else’s way. It’s like a passel of pigeons hovering around a park bench: you drop a crumb on the sidewalk, they all dive after it. One pigeon gets the crumb, the rest stay hungry, and while the losers sit there cooing and strutting and wishing for what might have been, they block the sidewalk so pedestrians can’t use it.
Can't you just get rid of the arb bots?
Not really. Stellar is open participation: anyone can submit transactions to the network, including people who build bots that try to take advantage of arbitrage opportunities.
Back in July, there was a discussion about raising the minimum fee to try to price out the arbitrage bots, but doing so would have had an immediate impact on everyone in the ecosystem — especially market makers, who submit a high volume of DEX orders to provide liquidity — and there wasn't consistent support for the idea.
Instead, you, dear reader, should plan to outbid the bots. Remember: they get no return from failed transactions, and as fees increase, it becomes more expensive for them to continue diving after bread crumbs.
What happens with network fees?
Fees do not go to the Stellar Development Foundation or to network validators: they go into the fee pool, which is tracked in the ledger header. At the moment, that's where they remain.
In the days of yore, Stellar had an inflation operation, and the fee pool was distributed every time it ran. However, after a ton of feedback from the ecosystem, a proposal to disable inflation was implemented in Protocol 12, and when validators voted to upgrade the network to that version of the protocol on 10/28/2019, the inflation operation was officially deprecated. There is no inflation on Stellar. Also, there is no staking on Stellar.
At some point, someone could come up with a new proposal to distribute the fee pool, that proposal could be implemented in a major protocol release, and the network validators could vote to upgrade the network to that version of the protocol. That someone could be you! Remember: Stellar is open source, and anyone can contribute to the codebase.
At the moment, however, fees are so low on Stellar — even with surge pricing — that the fee pool isn't that big, and it doesn't grow that quickly. It would take a lot of time and engineering effort to redistribute it, and it's probably not worth worrying about in the short term.
While fees don't enrich anyone, they do serve a purpose: they discourage large-scale bad behavior, and they give everyone a fair chance to bid for limited ledger space.

## Rank 4: Submit a Transaction
url: https://developers.stellar.org/docs/data/apis/horizon/api-reference/submit-a-transaction | scope: research_chunk | date: 2026-06-17 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0341.txt

## /transactions

This endpoint actually submits a transaction to the Stellar network. It only takes a single, required parameter: the signed transaction. Refer to the Transactions page for details on how to craft a proper one. If you submit a transaction that has already been included in a ledger, this endpoint will return the same response as would’ve been returned for the original transaction submission. This allows for safe resubmission of transactions in error scenarios, as highlighted in the error-handling guide.

## Rank 5: Timeout
url: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/timeout | scope: research_chunk | date: 2025-12-19 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0082.txt

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

## Rank 5 companion: (same URL)
url: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/timeout | scope: published_markdown_main_content | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0209.txt

# Timeout


The `timeout` error returns a [`504` error code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/504) and occurs when either:

- Horizon has not received a confirmation from the Stellar Core server that the transaction you are trying to submit to the network was included in a ledger in a timely manner, or
- Horizon has not sent a response to a reverse-proxy before a specified amount of time has elapsed.

The former case may happen because there was no room for your transaction for 3 consecutive ledgers. This is because Stellar Core removes each submitted transaction from a queue. To solve this you can:

- Keep resubmitting the same transaction (with the same sequence number) and wait until it finally is added to a new ledger, or
- Increase the fee in order to prioritize the transaction.

**Example Response for a 'Timeout' Status Code**

```json
{
  "type": "https://stellar.org/horizon-errors/timeout",
  "title": "Timeout",
  "status": 504,
  "detail": "Your request timed out before completing.  Please try your request again. If you are submitting a transaction make sure you are sending exactly the same transaction (with the same sequence number)."
}
```

## Rank 6: sendTransaction
url: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction | scope: research_chunk | date: 2025-12-12 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0227.txt

## Result

(sendTransactionResult)Transaction status and network state. The result will include if the transaction was successfully enqueued, and information about the current ledger.

hashstringrequiredTransaction hash (as a hex-encoded string)

>= 64 characters<= 64 charactersMatch pattern:^[a-f\d]{64}$statusstringrequiredThe current status of the transaction by hash.

Allowed values:PENDINGDUPLICATETRY_AGAIN_LATERERRORlatestLedgernumberrequiredThe sequence number of the latest ledger known to Stellar RPC at the time it handled the request.

latestLedgerCloseTimenumberrequiredThe unix timestamp of the close time of the latest ledger known to Stellar RPC at the time it handled the request.

errorResultXdrstring(optional) If the transaction status is ERROR, this will be a base64 encoded string of the raw TransactionResult XDR struct containing details on why stellar-core rejected the transaction.

diagnosticEventsXdrarray[string](optional) If the transaction status is ERROR, this field may be present with an array of base64 encoded strings. Each string will decode to a raw DiagnosticEvent XDR struct containing details on why stellar-core rejected the transaction.

## Rank 7: Error Handling
url: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling | scope: research_chunk | date: 2025-12-19 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0021.txt

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

## Rank 8: Cross-Border Payments API
url: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0031.md | scope: research_chunk | date: 2024-11-05 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0031.txt

## API Endpoints

- **timestamp** is the current Unix timestamp (number of seconds since epoch)
  at the time the callback is sent. This is used to assure the freshness of the
  request and to prevent this request to be replayed in the future.
- **base64 signature** is the base64 encoding of the request signature. We
  explain below how to compute and verify this signature. The signature is
  computed using the Stellar private key linked to the `SIGNING_KEY` field of
  the Receiving Anchor's [`stellar.toml`](sep-0001.md). Note that the timestamp
  and the Sending Anchor hostname will be part of the signature to prevent
  replay and relay attacks.

It is the Sending Anchor's responsibility to:

- Verify the signature using the corresponding Stellar `SIGNING_KEY` field of
  the Receiving Anchor's [`stellar.toml`](sep-0001.md).
- Verify the freshness of the request by comparing the `timestamp` in the
  request with the current timestamp at the time of the reception and discard
  every request above a threshold of few seconds (1 or 2 minute(s) maximum).
- Send a working callback URL to the Receiving Anchor.

### VERIFY signature

- Check that callback request has `Signature` or `X-Stellar-Signature`
  (deprecated) header
- Parse the header and extract:
  - Key `t`: **timestamp**
  - Key `s`: **base64 signature**
- Verify the request freshness: _current timestamp_ - **timestamp** < few
  seconds (1-2 minute(s) max)
- Extract the **body** of the request
- Base64 decode the **base64 signature** to get the **signature**
- Prepare the payload to verify the signature:
  - The **timestamp** (as a string)
  - The character `.`
  - The Sending Anchor host to send the callback request to
  - The character `.`
  - The **body**
- Verify the signature using the correct `SIGNING_KEY`

### COMPUTE signature

- Prepare the callback body
- Prepare the payload to sign:
  - Current timestamp (as a string)
  - The character `.`
  - The Sending Anchor host to send the callback request to
  - The character `.`
  - The callback request body
- Sign the payload `<timestamp>.<host>.<body>` using the Receiving Anchor
  private key
- Base64 encode the signature
- Build the `Signature` or `X-Stellar-Signature` (deprecated) header:
  - `Signature: t=<current timestamp>, s=<base64 encoded signature>`
  - `X-Stellar-Signature : t=<current timestamp>, s=<base64 encoded signature>`

#### Response

The sending anchor must respond with a `2XX` (ex. `204 No Content`) HTTP
response code as long as the signature is correct, the transaction specified
with `id` exists and the request body adheres to the transaction object schema.

If the request is invalid, either because the transaction specified doesn't
exist, the request body is not valid or the signature is invalid, return a
`400 Bad Request` JSON response. Note that this is a bug on the the Receiving
Anchor's side, and they should be notified in this case.

It is important to note that the Receiving Anchor is not obligated, at least by
default (SLAs can be defined between the parties), to retry if an unexpected
status code is returned by the Sending Anchor. If Sending Anchors experience
unexpected downtime, it is recommended to poll all in-progress transactions to
fetch current status values.

[SEP-9]: sep-0009.md
[SEP-12]: sep-0012.md
[SEP-38]: sep-0038.md

## Rank 9: Automating Testnet and Futurenet reset data
url: https://developers.stellar.org/docs/build/guides/basics/automate-reset-data | scope: published_markdown_main_content | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0063.txt

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

## Rank 10: Submit a transaction to Stellar RPC using the JavaScript SDK
url: https://developers.stellar.org/docs/build/guides/transactions/submit-transaction-wait-js | scope: research_chunk | date: 2025-08-08 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/03-runtime-astra/jev/1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0/search-documents/0111.txt

# Submit a transaction to Stellar RPC using the JavaScript SDK

- 
- How-To Guides
- Transactions
- Submit a transaction to Stellar RPC using the JavaScript SDK

# Submit a transaction to Stellar RPC using the JavaScript SDK
Here is a simple, rudimentary looping mechanism to submit a transaction to Stellar RPC and wait for a result.

import { Transaction, FeeBumpTransaction } from "@stellar/stellar-sdk";
import { Server, Api } from "@stellar/stellar-sdk/rpc";

const RPC_SERVER = "https://soroban-testnet.stellar.org/";
const server = new Server(RPC_SERVER);

// Submits a tx and then polls for its status until a timeout is reached.
async function submitTx(
 tx: Transaction | FeeBumpTransaction,
): Promise<Api.GetTransactionResponse> {
 return server
 .sendTransaction(tx)
 .then(async (reply) => {
 if (reply.status !== "PENDING") {
 throw reply;
 }

 return server.pollTransaction(reply.hash, {
 sleepStrategy: (_iter: number) => 500,
 attempts: 5,
 });
 })
 .then((finalStatus) => {
 switch (finalStatus.status) {
 case Api.GetTransactionStatus.FAILED:
 case Api.GetTransactionStatus.NOT_FOUND:
 throw tmpStatus;
 case Api.GetTransactionStatus.SUCCESS:
 return status;
 }
 });
}

cautionRemember: You should always handle errors gracefully! This is a fail-hard and fail-fast approach that should only be used in these examples.

### Guides in this category:

