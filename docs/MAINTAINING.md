# Maintaining walleterm

This guide is for maintainers. It covers releases, the Homebrew cask, and the website.

## Release

Releases run on the maintainer's Apple silicon Mac. The Developer ID signing key stays in its keychain.
Store the notary credentials once:

```sh
xcrun notarytool store-credentials walleterm-notary --apple-id <Apple ID> --team-id T4GBHCYB7P
```

`make release VERSION=0.2.0` builds, signs, and notarizes `release/0.2.0/walleterm-0.2.0-darwin-arm64.zip`.

- It builds from a fresh worktree of `HEAD` with the Bun and Rust versions that CI pins.
- It checks the Developer ID authority, the team ID, and the hardened runtime. The binary must have no entitlements.
- It runs the signed binary's `--version` check and its invalid-input check.
- It writes `checksums.txt` and `NOTICES.txt` beside the archive.

Add `NOTARIZE=0` to check the build and the signature without Apple. That archive has an `-unnotarized` name. Do not publish it.

## Publish

`make release VERSION=0.2.0 PUBLISH=1` also publishes the release:

1. It requires a passing Test workflow on `HEAD`, and `HEAD` must equal `origin/main`.
2. It tags the commit as `v0.2.0` and creates the GitHub release with the archive, `checksums.txt`, and `NOTICES.txt`.
3. It downloads the uploaded archive and compares its checksum.
4. It opens a pull request that points `Casks/walleterm.rb` at the new archive.

Merge that pull request to update Homebrew users.
The install script at `https://walleterm.com/install.sh` reads the latest GitHub release and its `checksums.txt`.

## Protect the tap

This repository is the Homebrew tap. The tap and the release downloads use anonymous Git and HTTPS, so the repository must be public.
Anyone who can merge to `main` can change the cask. Protect `main` and require code owner review.
`.github/CODEOWNERS` names the owners of the tap and release paths.
Turn on immutable releases, so a published archive cannot change.

## Website

`site/` holds the marketing page. It is static HTML with no build step. Open `site/index.html` to view it.
The Paper file "walleterm — marketing site" is the design reference. Change Paper first, then `site/`.
[The Paper workflow](../.agents/skills/walleterm-illustration/references/paper.md) gives the steps.
The illustrations come from `design/art/build.ts`. Read [the illustration standard](../design/ILLUSTRATION.md) before you change them.

Deploy with Wrangler. Set `CLOUDFLARE_ACCOUNT_ID` to the Cloudflare account that owns walleterm.com:

```sh
CLOUDFLARE_ACCOUNT_ID=<account ID> wrangler deploy -c site/wrangler.jsonc
```

## Live test records

Git ignores local live-test state: signer metadata, submission journals, checkpoints, and raw records.
Keep an unresolved submission journal until its original transaction hash has a final result.
Do not run `git clean -X` in a checkout that holds live-test state. See [live tests](LIVE-TESTS.md).
To track a new record, add it to the [evidence index](../evidence/README.md) and to the `/evidence/` allow list in `.gitignore`.
