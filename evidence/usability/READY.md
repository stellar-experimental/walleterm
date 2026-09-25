# wt-opus ready report (pane w44:p4)

Folder: /tmp/walleterm-usability-snYwFv. No signature or submission has occurred.
Pre-live checks: account and verifier WASM hashes match the skill pins. Rule 0 has A, B, C External signers. Policy threshold = 2. count(account) = 2.
Task 1 script: live1.sh (payment A->C 100 stroops, fee 100, 900 s time bound). One walleterm prompt for A.
Task 2 script: live2.sh (target.ping(account,1), payer A, rule 0, A+B). Three walleterm prompts: A auth, B auth, A envelope.
A zero-signature enforce simulation confirmed the host signature_payload and the verifier auth_digest.
Risk U1: simulation gives the legacy `address` credential, not `address_v2`. The acceptance snapshot has no live claim for `address`.
Each script journals the original hash before send, reconciles by that hash, and stops on a non-SUCCESS outcome.
Usability notes: notes/usability.md. Waiting for an explicit live-window grant.
