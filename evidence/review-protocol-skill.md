# walleterm skill review (wt-opus, w44:p4). Ownership released.

Model: Opus 5.5, effort high (CLAUDE_EFFORT=high, settings effortLevel high).
Scope: only .agents/skills/walleterm/** (the ~/.codex, ~/.claude, and ~/.agents links resolve there). No global link, Jev, shared doc, evidence, or acceptance.md edits.
quick_validate.py: "Skill is valid!". All relative links resolve.

## New references
- references/delegation.md: CAP-71 native delegation. Scheme comparison table (native address/address_v2, OZ External, OZ Delegated nested entry generalized to the delegate's own scheme with the tested G example, CAP-71 delegates).
  Covers the applicability check (account must call delegate_account_auth; simulation never emits the variant), build/sign steps (one top-level-bound payload P; each node signs under its own account rules; sorted with no duplicates; enforce simulation), replay binding, and SDK 17.1.0 helpers as version-scoped examples.
- references/contract-code.md: a conditional code check (only when a signature depends on contract code). Covers executable resolution (wasm, stellar_asset, CAP-85 external_ref -> owner tag entry -> resolved hash), tooling limits (CLI 27.1.0 XDR lacks external_ref), manager trust, and ExternalRef contract-creation approval.

## Changed files
- SKILL.md: description adds CAP-71 delegated signers. Routing adds both new references. The grant limit list adds "contract trust". Boundary: passkeys need separate support; other C formats need a matching adapter, and walleterm sign stays the same.
- classic-native.md: variant choice (the SDK useUpgradedAuth default gives address_v2; CLI 27.1.0 gave address; both are valid from p27; sign the preimage for the submitted arm). Removed the run-specific "+150" line. Coverage now points to acceptance.md.
- openzeppelin.md: code check points to contract-code.md. Duplicated test-suite coverage (E01-E03 and others) now points to acceptance.md. The CAP-71 pointer goes to delegation.md.

## Evidence (offline, no signing)
- Sources: stellar-protocol 9cd7030 CAP-71, CAP-71-01, CAP-71-02, and CAP-85. Copies are in research/pinned-cap-*.md.
- SDK 17.1.0: buildWithDelegatesEntry, buildAuthorizationEntryPreimage, authorizeEntry(forAddress), inspectAuthEntry, checkAuthEntryReadiness, ContractExecutableExternalRef, and scvExecutableTag (22) all exist.
- Offline arm check: address -> sorobanAuthorization. Its payload equals the live CLI T2 payload 78eda8e8... address_v2 and addressWithDelegates -> sorobanAuthorizationWithAddress, with the same payload.
- The live coverage in acceptance.md is unchanged. The parent will supply it.
