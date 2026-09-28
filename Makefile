PREFIX ?= $(HOME)/.local

.PHONY: build install install-skill release test test-kit test-package

SKILL_HOME ?= $(HOME)
SKILL_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/.agents/skills)
TOOLS := cargo run --locked -q -p walleterm-tools --

# One Rust binary with the minified demo website embedded, and its third-party notices.
build:
	$(TOOLS) package bin
	ln -sf walleterm bin/stellar-walleterm

# A failed build leaves the installed command unchanged.
install:
	bun install --frozen-lockfile --ignore-scripts
	$(TOOLS) install "$(PREFIX)"

# Build, sign, and notarize on the maintainer's Mac. Add PUBLISH=1 to publish, or NOTARIZE=0 for a local check.
release:
	@test -n "$(VERSION)" || { echo "Use make release VERSION=<major.minor.patch> [PUBLISH=1 | NOTARIZE=0]." >&2; exit 1; }
	$(TOOLS) release "$(VERSION)" $(if $(PUBLISH),--publish) $(if $(filter 0,$(NOTARIZE)),--no-notarize)

install-skill:
	@set -eu; \
	base="$(SKILL_HOME)"; \
	case "$$base" in /*) ;; *) echo "SKILL_HOME must be absolute" >&2; exit 1;; esac; \
	for app in .agents .codex .claude; do mkdir -p "$$base/$$app/skills"; done; \
	for name in walleterm walleterm-site-bridge; do \
	  src="$(SKILL_ROOT)/$$name"; canonical="$$base/.agents/skills/$$name"; \
	  if [ -L "$$canonical" ]; then \
	    if [ "$$(readlink "$$canonical")" != "$$src" ]; then echo "Refusing different skill link: $$canonical" >&2; exit 1; fi; \
	  elif [ -e "$$canonical" ]; then \
	    echo "Refusing existing skill copy: $$canonical; back it up before linking" >&2; exit 1; \
	  fi; \
	  for app in .codex .claude; do \
	    link="$$base/$$app/skills/$$name"; \
	    if [ -L "$$link" ]; then \
	      if [ "$$(readlink "$$link")" != "../../.agents/skills/$$name" ]; then \
	        echo "Refusing different existing link: $$link" >&2; exit 1; \
	      fi; \
	    elif [ -e "$$link" ]; then \
	      echo "Refusing existing skill: $$link" >&2; exit 1; \
	    fi; \
	done; \
	done; \
	for name in walleterm walleterm-site-bridge; do \
	  src="$(SKILL_ROOT)/$$name"; canonical="$$base/.agents/skills/$$name"; \
	  if [ ! -L "$$canonical" ]; then ln -s "$$src" "$$canonical"; fi; \
	  for app in .codex .claude; do \
	    link="$$base/$$app/skills/$$name"; \
	    if [ ! -L "$$link" ]; then ln -s ../../.agents/skills/$$name "$$link"; fi; \
	  done; \
	done

test:
	bun run build
	cargo fmt --all --check
	cargo clippy --workspace --all-targets --locked -- -D warnings
	cargo test --workspace --locked
	cargo clippy --locked --features test-host --bin walleterm-test-host -- -D warnings
	cargo build --locked --features test-host --bin walleterm-test-host
	bun run typecheck
	bun run test

# The release package. Two concurrent builds must give identical files. The binary runs from an unrelated
# directory with only the system PATH: no Go, Bun, Node, Rust, or source tree.
test-package:
	@set -eu; dir=$$(mktemp -d); trap 'rm -rf "$$dir"' EXIT; \
	cargo build --locked -q -p walleterm-tools; \
	target/debug/walleterm-tools package "$$dir/a" 0.0.0-test & first=$$!; \
	target/debug/walleterm-tools package "$$dir/b" 0.0.0-test; wait $$first; \
	cmp "$$dir/a/walleterm" "$$dir/b/walleterm"; cmp "$$dir/a/NOTICES.txt" "$$dir/b/NOTICES.txt"; \
	test "$$(ls "$$dir/a")" = "$$(printf 'NOTICES.txt\nwalleterm')"; \
	mkdir "$$dir/empty"; cd "$$dir/empty"; \
	run() { env -i PATH=/usr/bin:/bin HOME="$$dir/empty" "$$dir/a/walleterm" "$$@"; }; \
	test "$$(run --version)" = "walleterm 0.0.0-test"; \
	status=0; printf '{}' | run sign > out || status=$$?; \
	test "$$status" = 2; grep -q '"invalid_input"' out; \
	status=0; run demo --port 0 > out 2>&1 || status=$$?; test "$$status" = 2; grep -q "^invalid_input: " out; \
	echo "The package check passed."

# The real Stellar Wallets Kit 2.7.0 against the Rust bridge, in one tab and across tabs. Its dependency stays in fixtures/kit.
test-kit:
	cargo build --locked --features test-host --bin walleterm-test-host
	bun install --cwd fixtures/kit --frozen-lockfile --ignore-scripts
	bun fixtures/kit/check.mts
	bun fixtures/kit/tabs.mts
