PREFIX ?= $(HOME)/.local

.PHONY: build install install-skill test

SKILL_HOME ?= $(HOME)
SKILL_SOURCE := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/.agents/skills/walleterm)

build:
	mkdir -p bin
	go build -o bin/walleterm .
	ln -sf walleterm bin/stellar-walleterm

install: build
	install -d "$(PREFIX)/bin"
	install -m 755 bin/walleterm "$(PREFIX)/bin/walleterm"
	ln -sfn walleterm "$(PREFIX)/bin/stellar-walleterm"

install-skill:
	@set -eu; \
	base="$(SKILL_HOME)"; src="$(SKILL_SOURCE)"; \
	case "$$base" in /*) ;; *) echo "SKILL_HOME must be absolute" >&2; exit 1;; esac; \
	canonical="$$base/.agents/skills/walleterm"; \
	for app in .agents .codex .claude; do mkdir -p "$$base/$$app/skills"; done; \
	if [ -L "$$canonical" ]; then \
	  if [ "$$(readlink "$$canonical")" != "$$src" ]; then echo "Refusing different skill link: $$canonical" >&2; exit 1; fi; \
	elif [ -e "$$canonical" ]; then \
	  echo "Refusing existing skill copy: $$canonical; back it up before linking" >&2; exit 1; \
	fi; \
	for app in .codex .claude; do \
	  link="$$base/$$app/skills/walleterm"; \
	  if [ -L "$$link" ]; then \
	    if [ "$$(readlink "$$link")" != '../../.agents/skills/walleterm' ]; then \
	      echo "Refusing different existing link: $$link" >&2; exit 1; \
	    fi; \
	  elif [ -e "$$link" ]; then \
	    echo "Refusing existing skill: $$link" >&2; exit 1; \
	  fi; \
	done; \
	if [ ! -L "$$canonical" ]; then ln -s "$$src" "$$canonical"; fi; \
	for app in .codex .claude; do \
	  link="$$base/$$app/skills/walleterm"; \
	  if [ ! -L "$$link" ]; then ln -s ../../.agents/skills/walleterm "$$link"; fi; \
	done

test:
	go test ./...
	go vet ./...
