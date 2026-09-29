# 1Password Setup Video

This video shows a new user how to prepare 1Password for Walleterm.
It does not use a screen recording. Simplified mock panels copy the real 1Password screens.
The project is in `video/`. It uses HyperFrames, which renders HTML to MP4.

## Format

- 1920 × 1080, 30 frames each second, about 70 seconds.
- Walleterm look: cream paper, moss, and tomato colors. Atkinson Hyperlegible fonts. The wallet mascot.
- Voice: ElevenLabs `eleven_v4`, voice Jeremy B. (`btaSeNTVh1pGx4pjFzub`), one continuous take. The word times from the voice set the start of each action.

## Scenes

| Scene | Screen | Narration |
| --- | --- | --- |
| 1 | Title. | Get 1Password ready for Walleterm. |
| 2 | Settings, Developer. Check *Use the SSH Agent*. | Open Settings, then Developer. Check the box. |
| 3 | New Vault dialog. The example name is `Wallace`. | Create a vault. Any name works. |
| 4 | New Item, SSH Key, Add Private Key, Generate, name, Save. The key is `My Testnet Key`. | Add the key. |
| 5 | The *Enable key for SSH agent* banner, then `agent.toml` with one entry. | Open the config file. Add the vault and the key name. |
| 6 | Optional. `walleterm tunnel --vault Wallace`, `brew install --cask 1password-cli`, *Integrate with 1Password CLI*. | Optional CLI. The install command is on screen. |
| 7 | `walleterm list --human`, then the *1Password Access Requested* prompt. | Run `walleterm list`. Approve with Touch ID. |
| 8 | Done. | That is it. |

## Rules

- Show no real vault names, key names, public keys, fingerprints, account names, or `agent.toml` entries.
- Draw private-key fields closed.
- Do not read long flags or verbose terms aloud. Show the command on screen and say "the install command".
- Keep the narration on the task. No marketing lines.
- Every focus box is measured from its target with `fit()` in `video/assets/scene.js`. Never place a box by hand.

## Real screens

The panels copy screenshots of the 1Password Mac app from 2026-09-29: Settings Developer, the main window,
the New Vault dialog, the New Item picker and form, the Key Type panel, the saved key banner, and the approval prompt.
Each scene draws the panel at 2x screen scale. A camera pans and zooms so the text stays readable.

## Rebuild

Run these commands in `video/`.

```sh
node scripts/voice.mjs <voice_id> eleven_v4   # spends ElevenLabs credits
node scripts/layout.mjs                       # writes timings.js and index.html
npm run check   # skips the contrast pass; see below
npx hyperframes preview --background
npx hyperframes render
```

The narration is in `docs/1PASSWORD-NARRATION.txt`. A blank line starts a new scene.
Text in `[brackets]` directs the delivery and is not spoken.

## Contrast check

`npm run check` skips the contrast pass. The camera zooms in, and the audit counts text that is outside the zoomed view.
It then reports false failures for the sidebar text. All panel text is light on a dark background.
