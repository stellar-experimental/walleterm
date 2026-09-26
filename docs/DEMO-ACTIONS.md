# Demo transaction modal

Selecting an action opens its modal before account lookup starts.
The modal shows preparation progress, errors, the transaction summary, and the available next action.
The expandable transaction details retain the complete existing JSON preview.
The header and action buttons stay visible while long details scroll.

Closing the modal preserves the transaction and does not cancel an action.
The workspace shows View transaction while a transaction exists or preparation continues.
A saved transaction opens in the modal after a reload.
Discard and Start another request retain the existing transaction recovery rules.
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
