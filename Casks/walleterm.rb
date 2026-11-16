cask "walleterm" do
  version "0.4.0"
  sha256 "337bacc37fe841418997c2feed48e124859cdb403915d0cf1730006190904718"

  url "https://github.com/stellar-experimental/walleterm/releases/download/v#{version}/walleterm-#{version}-darwin-arm64.zip"
  name "walleterm"
  desc "Stellar signing companion for agents that keeps keys in 1Password"
  homepage "https://github.com/stellar-experimental/walleterm"

  depends_on arch: :arm64
  depends_on formula: "cloudflared"
  depends_on macos: :ventura

  binary "walleterm"
  binary "walleterm", target: "stellar-walleterm"

  caveats <<~EOS
    Enable the SSH agent in the 1Password desktop app.
    Generate an Ed25519 SSH key in 1Password for each wallet.
    Then run: walleterm list --human
  EOS
end
