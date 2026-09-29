# Demo website

`walleterm demo` serves an example Stellar testnet website.
The website builds transactions in the browser, requests signatures through `walleterm tunnel`, and submits them to testnet.
The header holds the [connection component](CONNECTION-UI.md). The rest of the page belongs to the demo.
The demo is separate from the SDK. It does not add trusted transaction review to the bridge.
See [the website signing bridge](WEB-BRIDGE.md) for the steps to run both commands.

## Actions

| Button | Transaction |
| --- | --- |
| Write a note | Writes a short data entry to the testnet account. |
| Pay 0.01 test XLM | Sends 0.01 test XLM to an account that the demo selects. |
| Offer 0.1 test XLM | Sells 0.1 test XLM at 10 USDC per XLM. The account needs a testnet USDC trustline. |
| Cancel newest offer | Removes the newest open offer of the account, whatever created it. |
| Set up contract demo | Deploys the contract account and counter. See [contract authorization](CONTRACT-AUTHORIZATION.md). |
| Increment counter | Signs a contract authorization entry, then the transaction envelope. |

The demo funds a new testnet account with Friendbot.
Each transaction expires 180 seconds after construction.
Use a dedicated testnet account. An offer can trade immediately.

## Transaction modal

Selecting an action opens its modal before the account lookup starts.
The modal shows preparation progress, errors, the transaction summary, and the next available step.
The expandable transaction details show the complete JSON preview.
The header and footer buttons stay visible while long details scroll.

Closing the modal keeps the transaction. It does not cancel the action.
The workspace shows View transaction while a transaction exists or preparation continues.
After a reload, an unfinished saved transaction opens in the modal.
A finished transaction stays available through View transaction and Activity.

Confirmed, canceled, denied, expired, and failed transactions permit the next action at once.
The next action replaces the finished record inside a shared journal lock.
The lock uses Web Locks. It detects changes from another tab before replacement.
A storage failure keeps the old record and stops the new build.
An unsigned review or a signed transaction requires Discard before replacement.
Open signing requests and unknown outcomes keep their recovery rules. Check an unknown submission by its original hash.

Changing wallets keeps a saved transaction and its original signer.
The demo enables Sign only when the connected wallet matches that signer.

## Activity log

The activity log sits below the transaction actions.

- Expand an event with data to read its JSON.
- Search for an action, wallet address, transaction hash, or signature.
- Filter events by type.
- Copy JSON, hashes, signatures, or XDR from an expanded event.
- Select Export JSON to save all events, including events outside the current filter.
- Select Show more activity to display older events.

Events without data are plain rows. They have no expansion control and no JSON details.

The log records demo actions, status messages, connection changes, and transaction state changes.
It also records wallet requests and responses, Horizon requests, and Friendbot requests.
Repeated signing polls with unchanged responses produce one event.
Signed responses include the transaction hash, public signatures, and signed XDR.
Each event is a snapshot. Later changes do not replace earlier results.

The log redacts connection codes, session tokens, grant identifiers, and credential fields.
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
| Loading saved activity | Status text | Export JSON is disabled until the history loads. |
| Copying data | A status message after completion | The button keeps its label and size. |

A missing wallet, a connection change, a pending transaction, or a blocked journal disables new transaction actions.
Missing signed XDR disables Submit to testnet.
Search, filtering, and export use local data. They show no progress state.
