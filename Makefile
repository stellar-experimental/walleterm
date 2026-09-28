PREFIX ?= $(HOME)/.local

.PHONY: build install install-skill test

SKILL_HOME ?= $(HOME)
SKILL_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/.agents/skills)

build:
	bun scripts/package.ts bin
	ln -sf walleterm bin/stellar-walleterm

install:
	bun install --frozen-lockfile --ignore-scripts
	bun scripts/install.ts "$(PREFIX)"

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
	go test ./...
	go vet ./...
	cargo fmt --all --check
	cargo clippy --workspace --all-targets --locked -- -D warnings
	cargo test --workspace --locked
	cargo clippy --locked --features test-host --bin walleterm-test-host -- -D warnings
	cargo build --locked --features test-host --bin walleterm-test-host
	bun run typecheck
	bun run test
