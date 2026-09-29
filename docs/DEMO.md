# Demo website

`walleterm demo` serves an example Stellar testnet website.
The website builds transactions in the browser, requests signatures through `walleterm tunnel`, and submits them to testnet.
The header holds the [connection component](CONNECTION-UI.md). The rest of the page belongs to the demo.
The demo is separate from the SDK. It does not add trusted transaction review to the bridge.
See [the website signing bridge](WEB-BRIDGE.md) for the steps to run both commands.

## Transaction actions

| Button | Transaction |
| --- | --- |
| Write a note | Writes a short data entry to the testnet account. |
| Pay 0.01 test XLM | Sends 0.01 test XLM to an account that the demo selects. |
| Offer 0.1 test XLM | Sells 0.1 test XLM at 10 USDC per XLM. The account needs a testnet USDC trustline. |
| Cancel newest offer | Removes the newest open offer of the account, whatever created it. |

The demo funds a new testnet account with Friendbot.
Each transaction expires 180 seconds after construction.
Use a dedicated testnet account. An offer can trade immediately.

The workspace reads the connected account from Horizon.
It shows the XLM balance, or it says that the first action funds the account.
The offer card says whether the account has an authorized USDC trustline with room for 1 USDC.
The demo reads the account again after each confirmed transaction.

## Smart account walkthrough

The walkthrough deploys a smart account and a counter, then uses the smart account to authorize a contract call.
See [contract authorization](CONTRACT-AUTHORIZATION.md) for the signatures.

| Row | Transaction | Signatures |
| --- | --- | --- |
| Contract code on testnet | Uploads the smart account code or the counter code when it is missing. Every wallet uses the same code. | 1 |
| 1. Deploy your smart account | Deploys a contract account that accepts only the connected wallet's signature. | 2 |
| 2. Deploy the counter | Deploys the counter contract for this set. | 2 |
| 3. Increase the counter | The smart account authorizes +1. The step repeats. | 2 |

The ledger is the source of truth. The demo reads it when a wallet connects, after each confirmed step, and on Refresh.
One `getLedgerEntries` request reads both code entries and the two instances of all 50 sets.
The demo then checks the smart account owner and reads the counter.
Each row shows Done, the next step, or the step that it waits for. Only the next row has a button.
A row with an unfinished transaction shows In progress and View transaction.
A done deploy row shows its contract address with Copy.
A failed read shows the error and keeps the last state. Select Refresh to read again.

Each wallet has up to 50 contract sets. A set is one smart account and one counter.
Set 1 uses the first demo salt. Each later set appends its number to the salt, so it gets new contract IDs.
Start a new set appears when both contracts of the shown set exist. It shows the next set, and a deploy makes it real.
After a reload, the demo shows the latest set that has a deployed contract.
An unfinished transaction always shows its own set.

Each step asks the ledger again before any signature request.
A step that the ledger already has closes the window and refreshes the walkthrough. It is not an error.
A step whose earlier step is missing names that step.

## Transaction window

Selecting an action opens its window before the account lookup starts.
The window shows preparation progress, errors, the transaction summary, and the next available step.
The label above the title names the action type: Demo transaction, or the walkthrough set and step.
The expandable transaction details show the complete JSON preview.
The header and footer buttons stay visible while long details scroll.

A step list shows each phase of the transaction:

| Transaction | Phases |
| --- | --- |
| Classic transaction or code upload | Sign the transaction, Submit to testnet, Confirm on the ledger |
| Deployment or counter increase | Sign the authorization, Sign the transaction, Submit to testnet, Confirm on the ledger |

A done phase has a check. The current phase shows live progress, for example the 1Password wait and the time left.
A failed phase has a cross and the reason. An uncertain phase has a question mark and the recovery instruction.
The fee of an unsigned contract call is an estimate. Simulation sets the final fee after the authorization is signed.
The summary shows short addresses. Transaction details and Activity hold the full values.

Closing the window keeps the transaction. It does not cancel the action.
The page shows View transaction while a transaction exists or preparation continues.
After a reload, an unfinished saved transaction opens in the window.
A finished transaction stays available through View transaction and Activity.

A confirmed classic transaction offers Done.
A confirmed walkthrough step offers Continue with the next step, or Increase again after a counter increase.
Continue appears only after the demo reads the result on the ledger.
If that read fails, the window keeps the confirmed hash and ledger and offers Check result again. The check sends nothing.
A failed, declined, canceled, or expired walkthrough step offers Try again.

Confirmed, canceled, denied, expired, and failed transactions permit the next action at once.
The next action replaces the finished record inside a shared journal lock.
The lock uses Web Locks. It detects changes from another tab before replacement.
A storage failure keeps the old record and stops the new build.
An unsigned review or a signed transaction requires Discard before replacement.
Open signing requests and unknown outcomes keep their recovery rules. Check an unknown submission by its original hash.

Changing wallets keeps a saved transaction and its original signer.
The demo enables Sign only when the connected wallet matches that signer.

## Activity log

The activity log sits below the walkthrough.

- Expand an event with data to read its JSON.
- Search for an action, wallet address, transaction hash, or signature.
- Filter events by type.
- Copy JSON, hashes, signatures, or XDR from an expanded event.
- Select Export JSON to save all events, including events outside the current filter.
- Select Show more activity to display older events.

Events without data are plain rows. They have no expansion control and no JSON details.

The log records each fact once:

| Type | Events |
| --- | --- |
| Action | Each action or step that you start, a new contract set, and camera scans. |
| Walkthrough | A changed walkthrough state, and each verified step result. |
| Transaction | Each journal state, named with its action. A contract call names its authorization signature separately. |
| Walleterm | Bridge requests, and wallet connection changes. |
| Testnet | Horizon, Friendbot, and Soroban RPC requests. RPC events use the method name. |
| Status | Facts that no other event holds, such as an offer that traded immediately or a hash that is not found yet. |
| Error | Failed requests, failed actions, and failed walkthrough checks. |

Each request is one event with its request, response, status, and duration.
A request that changes something gets its event when it starts. The event completes when the response arrives.
A read gets its event when the response arrives.
An identical read with the same result adds a count to its earlier event. The event keeps the last time.
Ledger position fields and JSON-RPC IDs do not make two reads different.
A JSON-RPC error, a failed simulation, and a rejected or failed transaction are errors, also with HTTP 200.
A missing account or transaction is an answer, not an error.
Signed responses include the transaction hash, public signatures, and signed XDR.

The log redacts connection codes, session tokens, grant identifiers, and credential fields. It keeps numeric error codes.
It does not inspect request headers or read private key fields.
It observes response copies. It does not delay delivery or consume the original response.

The log stores events in IndexedDB for the current browser and website origin.
A reload or a cleared transaction keeps the history. A new tunnel origin has separate browser storage.
A storage failure leaves the tab usable and shows an export notice.
The transaction recovery record is separate from the activity log.

## Code panels

The activity JSON, the transaction JSON, and the connection command use syntax highlighting.
`demo/site/code-view.ts` renders them. The tokenizer is Twinkleplop, in `demo/site/syntax.ts`.
The build pins `@twinkleplop/json` and `@twinkleplop/bash` at `0.1.5`, with `@twinkleplop/core` at `0.2.2`.
`walleterm demo` embeds the generated modules and `vendor/syntax.LICENSE`.

Code keeps its original lines. Each JSON panel scrolls in both directions within a fixed height.
A language label, a line count, and a scroll hint identify each panel.
The scroll region accepts keyboard focus and arrow keys.

The renderer creates text nodes from token offsets. It never inserts source through `innerHTML`.
HTML in a JSON value stays inert text. Highlighting does not validate hashes, signatures, or XDR.
A closed panel loads the tokenizer only when it opens. Unchanged content keeps its DOM and scroll position.
Copy and export use the original event data.

Source above 50,000 UTF-16 units stays plain text. Source above 12,000 tokens also stays plain text.
The label shows "Plain text" in these cases and when the tokenizer fails to load.
These limits never truncate the displayed, copied, or exported data.

## Progress and controls

Progress indicators are small rotating arcs with visible status text.
An indicator stops when its request finishes, fails, or stops.
Reduced-motion mode stops the rotation and keeps the text.

| State | Feedback | Controls |
| --- | --- | --- |
| Loading the account | Transaction progress | New transaction actions are disabled. |
| Funding a new account | Friendbot progress | New transaction actions are disabled. |
| Finding a recipient or loading offers | Preparation progress | New transaction actions are disabled. |
| Waiting for a signature | Signature progress and a countdown | Cancel signing request stays available. |
| Canceling a signature request | Cancellation progress | Cancel signing request is disabled. |
| Submitting | Submission progress | Check transaction status and Start another request are unavailable. |
| Checking the original result | Check progress | Duplicate checks are disabled. |
| Stopped or unknown result | The result and recovery instructions | No indicator runs. Recovery rules apply. |
| Reading the walkthrough state | Checking… in the walkthrough header | Walkthrough buttons are disabled. Refresh is disabled. |
| Loading saved activity | Status text | Export JSON is disabled until the history loads. |
| Copying data | A status message after completion | The button keeps its label and size. |

A missing wallet, a connection change, a pending transaction, or a blocked journal disables new transaction actions.
Missing signed XDR disables Submit to testnet.
Search, filtering, and export use local data. They show no progress state.
