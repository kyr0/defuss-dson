# Project interface (defuss-vae layout): the same verbs for humans, agents and CI; `make` lists them with usage.
# A library, not a service: start..log answer "no service". bun installs and runs the scripts; tests run on Node.js
# and Bun, browsers through Playwright.
-include .env
ENV_KEYS := $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env 2>/dev/null)
ifneq ($(ENV_KEYS),)
export $(ENV_KEYS)
endif
# The bun installer's default location as a fallback: a bun already on PATH keeps precedence.
export PATH := $(PATH):$(HOME)/.bun/bin

.PHONY: help setup build start stop restart status log metrics bench test coverage lint e2e verify docs serve clean
.DEFAULT_GOAL := help

help: ## list the verbs with their usage (default goal)
	@awk -F':.*## ' '/^[a-zA-Z0-9_ -]+:.*## /{printf "  %-12s %s\n", $$1, $$2}' $(firstword $(MAKEFILE_LIST))

setup: ## install bun if missing, exactly the locked dependencies, Playwright's Chromium and WebKit, and the git hooks
	@command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash
	bun install --frozen-lockfile
	bunx playwright install chromium webkit
	git config core.hooksPath .githooks

start stop restart status log: ; @echo "∅ $@: no service"  ## library: no service

build: ## clean ESM, CommonJS and declaration build into dist/
	bun run build

lint: ## oxlint (warnings fail), strict TypeScript over src/, e2e/ and the configs, and the structural checks
	bun run lint
	@for check in .vae/checks/*.py; do python3 "$$check" || exit 1; done

test: ## the Vitest unit suite on Node.js, then the same suite on Bun
	bun run test
	bun --bun ./node_modules/.bin/vitest run

coverage: ## unit coverage on Node.js: prints the `All files` table; vitest.config.ts thresholds fail the run
	bun run coverage

e2e: ## build, pack, clean consumer, then Vitest (Node.js, Bun) and Playwright (Chromium, WebKit); results in output/e2e/
	bun run e2e

verify: lint test coverage e2e ## what CI runs: every gate verb, cheapest first

docs: build ## refresh docs/assets/lib, docs/data/manifest.json, page figures and the README size table from the build
	bun run site

serve: ## serve the website from docs/ on 127.0.0.1:8080 (PORT overrides)
	bun run serve

metrics: build ## print the byte and gzip sizes of the build
	@node -e 'import("./scripts/site.mjs").then(async (m) => console.log(JSON.stringify(await m.measure())))'

bench: build ## median time and peak RSS per operation on Node.js, Bun, Chromium and WebKit; results in output/bench/, published by make docs
	node scripts/bench.mjs
	bun scripts/bench.mjs
	node scripts/bench-browser.mjs

clean: ## remove build, coverage and test output
	rm -rf dist coverage output tmp/e2e
