# Demo transaction modal

Selecting an action opens its modal before account lookup starts.
The modal shows preparation progress, errors, the transaction summary, and the available next action.
The expandable transaction details retain the complete existing JSON preview.
The header and action buttons stay visible while long details scroll.

Closing the modal preserves the transaction and does not cancel an action.
The workspace shows View transaction while a transaction exists or preparation continues.
An unfinished saved transaction opens in the modal after a reload.
A finished transaction stays available through View transaction and Activity.
Confirmed, canceled, denied, expired, and failed transactions allow the next action without a separate reset.
The next action replaces the finished record inside the existing journal lock.
Activity retains the previous result and transaction hash.
Unsigned reviews and signed transactions still require an explicit discard before replacement.
Open signing requests and unknown outcomes retain their existing recovery rules.
Unknown submissions still require checking the original transaction.

This modal belongs to the demo website. It is separate from the connection SDK.
It does not add trusted transaction review or change the bridge signing policy.

## Design reference

The [Whop payment details modal](https://mobbin.com/screens/4a188cb3-f820-4fb5-89ad-23e11a884d92) separates transaction fields from its footer actions.
The Mobbin MCP returned this reference on 2026-09-26, with four other transaction detail screens.
The demo retains its existing white, blue, and gray palette and Avenir/system typography.
The modal uses a scrolling content area between a fixed header and footer.

## Verification

The targeted connection, scanner, and demo suite passed 26 tests.
Tests cover opening before lookup, visible preparation errors, closing without record changes, reopening, and recovery after reload.
The existing test still confirms that building a transaction does not request a signature.

Browser checks covered 390 × 844 and 1440 × 1000 viewports.
Expanded details scrolled while the mobile footer stayed within the viewport.
Escape closed the modal. Keyboard focus cycled within it.
The transaction remained available after closing during signing.
The mock flow completed signing, submission, and clearing.
An offer without a trustline showed its error inside the modal.

The browser fixture used isolated local mock keys and mock Horizon responses.
These checks requested no live 1Password signatures and used no live funds.
The browser accessibility check reported no confirmed WCAG A or AA violations.
It left the status text contrast for manual inspection.

## Finished transaction follow-up

The completed record previously disabled every action, even after a wallet switch.
The new state check allows another action after the prior transaction finishes.
A shared journal lock still checks for changes from another tab before replacing the record.
A storage failure preserves the old record and stops the new build.

The full suite passed 197 Node tests and three contract self-tests.
New regression tests cover finished states, unfinished states, wallet switching, another tab, and storage failure.
The browser check connected two local mock wallets and switched between them without signing.
All four actions stayed enabled beside the completed transaction.
Selecting Write a note created a fresh review for the second wallet.
Activity retained the previous completion and hash.
The browser requested zero signatures and performed no live funding or submission.

Screenshots: [Desktop](screenshots/code-display/next-action-desktop.png) and [Phone](screenshots/code-display/next-action-mobile.png).
