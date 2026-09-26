# Demo activity log

The demo keeps an activity log below its transaction actions.
The connection SDK remains separate from this log.

## Use

- Expand an event with data to read its JSON.
- Search for an action, wallet address, transaction hash, or signature.
- Filter events by type.
- Copy JSON, hashes, signatures, or XDR from an expanded event.
- Export JSON to keep all events, including events outside the current filter.
- Select **Show more activity** to display older events.

Events without data use plain rows. They have no expansion control or JSON details.

The log stores events in IndexedDB for the current browser and website origin.
Reloading the page or clearing a transaction keeps the activity history.
A new tunnel origin has separate browser storage.
The log does not import actions from before this feature was installed.
The recovery journal remains separate from the activity log.

## Recorded events

The log records demo actions, status messages, connection changes, and transaction state changes.
It also records wallet requests, wallet responses, Horizon requests, and Friendbot requests.
Repeated signing polls with unchanged responses produce one event.
Signed responses include the transaction hash, public signatures, and signed XDR.
The log snapshots each event, so later changes do not replace earlier results.

Connection codes, session tokens, grant identifiers, and credential fields are redacted.
The log does not inspect request headers or read private key fields.
Activity storage failures leave the current tab usable and show an export notice.
The log observes response copies without delaying delivery or consuming the original response.
It preserves the request options, caller cancellation signal, and original errors.

## Design references

The log uses compact event rows with expandable details.
These Mobbin references informed the layout:

- [Stripe event history](https://mobbin.com/screens/5423e185-8374-4b6c-a4a0-2d3ae9adc1d0): separate event summaries and JSON.
- [WorkOS event details](https://mobbin.com/screens/a5b50327-60e0-4075-9cfd-7f383d18265c): readable structured responses.
- [7shifts activity](https://mobbin.com/screens/8b845427-b403-4eb7-87c9-aa771a00d378): concise actions with details.
- [Deputy timeline](https://mobbin.com/screens/fd1a02ca-3bc4-47eb-bd05-a63926f531a3): expandable event history.
- [Railway audit details](https://mobbin.com/screens/3668d9f6-d6bb-4fdf-a4a8-97087947c044): event details kept outside the main workflow.

## Validation — 2026-09-26

- `npm test`: 179 Node tests and three contract self-tests passed.
- Eight activity tests cover redaction, request preservation, polling, history restoration, storage failure, and response decoding failure.
- Existing tests cover wallet switching, signing cancellation, unknown results, and transaction recovery.
- Installer tests confirm that both activity assets reach the installed release.
- Local browser checks used `bridge/browser-fixture.mjs` with isolated mock keys.
- Mock Horizon responses covered account loading, signing, submission, and confirmation.
- Browser checks confirmed hash search, signature copying, JSON export, and history after clearing and reloading.
- Expanded events stayed open when new activity arrived.
- Layout checks covered 390-pixel and 1440-pixel viewports without horizontal page overflow.
- The expanded activity section passed the WCAG 2 A/AA axe check with no violations or incomplete checks.

The later plain-row checks covered empty objects, empty arrays, null, and empty strings.
These events had no JSON details, buttons, or expansion indicators.
Numeric zero, false, and populated JSON remained expandable.
Hash JSON and Copy hash remained available.
The 390-pixel and 1440-pixel layouts had no horizontal overflow.
The refinement passed eight activity tests, the syntax check, and axe with no violations or incomplete checks.

These checks requested no live signatures, account funding, or network submissions.
Mock confirmation does not establish testnet acceptance.

## Installation check

`make install` installed release `2cb158e83bb4d1ed059a358e`.
The installed demo serves the same activity and app assets as the source files.
The public demo also serves matching asset hashes and displays the activity log without browser errors.
Only the demo service restarted. The existing wallet tunnel kept its release and vault selection.
The SDK files and `requestSignature` function match commit `bcb250c`.

## Changed files

- `demo/site/activity.js`
- `demo/site/activity.css`
- `demo/site/app.js`
- `demo/site/index.html`
- `demo/server.mjs`
- `bridge/activity.test.mjs`
- `scripts/install.mjs`
- `scripts/install.test.mjs`
- `docs/DEMO-ACTIVITY.md`
