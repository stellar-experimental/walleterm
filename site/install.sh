#!/bin/sh
# Install or update walleterm from its latest GitHub release:
#   curl -fsSL https://walleterm.com/install.sh | sh
# WALLETERM_VERSION=0.2.0 installs that release. WALLETERM_INSTALL_DIR changes the directory (default ~/.local/bin).
# The script checks the archive's SHA-256 and the binary's Developer ID signature before it replaces anything.
# Everything runs inside main, so a partial download runs nothing.

set -eu

REPOSITORY="stellar-experimental/walleterm"
TEAM_ID="T4GBHCYB7P"

fail() {
  echo "walleterm install: $*" >&2
  exit 1
}

fetch() {
  curl --proto '=https' --tlsv1.2 -fsSL --retry 3 "$1" -o "$2" || fail "could not download $1"
}

main() {
  # uname -m says x86_64 in a Rosetta shell, so ask the hardware.
  if [ "$(uname -s)" != Darwin ] || [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" != 1 ]; then
    fail "walleterm runs only on macOS with Apple silicon."
  fi
  dir="${WALLETERM_INSTALL_DIR:-$HOME/.local/bin}"
  case "${WALLETERM_VERSION:-latest}" in
    latest) base="https://github.com/$REPOSITORY/releases/latest/download" ;;
    *) base="https://github.com/$REPOSITORY/releases/download/v${WALLETERM_VERSION#v}" ;;
  esac

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  fetch "$base/checksums.txt" "$tmp/checksums.txt"
  line=$(grep -E '^[0-9a-f]{64}  walleterm-[0-9]+\.[0-9]+\.[0-9]+-darwin-arm64\.zip$' "$tmp/checksums.txt" | head -n 1 || true)
  [ -n "$line" ] || fail "the release has no macOS archive in checksums.txt"
  expected=${line%%  *}
  archive=${line#*  }
  fetch "$base/$archive" "$tmp/$archive"
  actual=$(shasum -a 256 "$tmp/$archive" | cut -d ' ' -f 1)
  [ "$actual" = "$expected" ] || fail "$archive does not match its SHA-256 in checksums.txt"

  ditto -x -k "$tmp/$archive" "$tmp/unpacked"
  binary="$tmp/unpacked/walleterm"
  [ -f "$binary" ] || fail "$archive has no walleterm binary"
  codesign --verify --strict "$binary" 2>/dev/null || fail "the walleterm signature is not valid"
  codesign -d --verbose=2 "$binary" 2>&1 | grep -qx "TeamIdentifier=$TEAM_ID" ||
    fail "walleterm is not signed by Developer ID team $TEAM_ID"

  # Replace the command in one rename, so a failed install keeps the previous one.
  mkdir -p "$dir"
  cp "$binary" "$dir/.walleterm.new"
  chmod 755 "$dir/.walleterm.new"
  mv -f "$dir/.walleterm.new" "$dir/walleterm"
  ln -sfn walleterm "$dir/stellar-walleterm"
  echo "Installed $("$dir/walleterm" --version) to $dir/walleterm"

  case ":$PATH:" in
    *":$dir:"*)
      found=$(command -v walleterm || true)
      [ "$found" = "$dir/walleterm" ] ||
        echo "Your PATH runs $found first. Remove that copy (brew uninstall --cask walleterm) or reorder PATH."
      ;;
    *) echo "Add $dir to your PATH: echo 'export PATH=\"$dir:\$PATH\"' >> ~/.zshrc" ;;
  esac
  command -v cloudflared >/dev/null 2>&1 || echo "walleterm tunnel needs cloudflared: brew install cloudflared"
  echo "Next: enable the SSH agent in the 1Password desktop app, then run: walleterm list --human"
}

main "$@"
