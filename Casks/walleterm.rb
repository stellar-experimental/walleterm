cask "walleterm" do
  version "0.2.0"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/stellar-experimental/walleterm/releases/download/v#{version}/walleterm-#{version}-darwin-arm64.zip"
  name "walleterm"
  desc "Stellar signing companion for agents that keeps keys in 1Password"
  homepage "https://github.com/stellar-experimental/walleterm"

  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  depends_on formula: "cloudflared"

  binary "walleterm"
  binary "walleterm", target: "stellar-walleterm"

  caveats <<~EOS
    Enable the SSH agent in the 1Password desktop app.
    Generate an Ed25519 SSH key in 1Password for each wallet.
    Then run: walleterm list --human
  EOS
end
