---
workflow: general-video
flow: automation
storyboard: no
message: "Set up 1Password once, and Walleterm can ask for your approval without ever seeing your private key."
destination: website
aspect: 1920x1080
language: en
audience: "A developer or agent user on macOS who has not set up the 1Password SSH agent."
length: 90-120s
---

## Intent

A narrated explainer that mocks a screen recording. Simplified 1Password panels walk a new user through the SSH agent setting, a demo vault, an Ed25519 key, the agent entry, the optional `op` CLI, and the first `walleterm list` with its approval prompt.

## Assets

- assets/voice/scene-N.mp3 — ElevenLabs narration, one clip for each scene. Made by `scripts/voice.mjs` from `docs/1PASSWORD-NARRATION.txt`.
- assets/art/*.svg — Walleterm mascot art copied from `site/art/`.
- assets/fonts/ — Atkinson Hyperlegible, copied from `site/fonts/`.

## Notes

- Real screens were observed on 2026-09-29. See `docs/1PASSWORD-VIDEO.md`.
- Show no real vault names, key names, public keys, fingerprints, or `agent.toml` entries.
- The mock 1Password panels are simplified. They do not copy the 1Password logo.
