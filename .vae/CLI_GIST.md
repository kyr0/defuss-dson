# CLI gist

<!-- Commands future agents need that the Makefile verbs do not cover (setup, env, data, deploy):
- VERIFIED[purpose] `cmd`: only after an observed success
- UNKNOWN[purpose] BC gap
Budget 2 KiB (`vae.py doctor --repo .`); entries are injected at session start. -->
- VERIFIED[test@bun] `bun --bun ./node_modules/.bin/vitest run` runs the unit suite in Bun BC a probe test printed process.versions.bun=1.4.3
- VERIFIED[e2e] `make e2e` needs cdn.jsdelivr.net (defuss-shadcn for the site) and port 4319 on 127.0.0.1; results in output/e2e/
- VERIFIED[playwright] `bunx playwright test` alone needs DSON_CONSUMER and DSON_LIB from a prior `make e2e` (tmp/e2e/consumer) BC e2e/consumer.ts refuses the source tree
- VERIFIED[bench] `make bench` takes about 26 s and needs the Playwright browsers (`make setup`); `node scripts/bench.mjs <other>/dist/index.mjs` times another build on the same graph; alternate the two builds, since absolute medians doubled with machine load within one session (2026-11-01)
