# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING; past 100 entries it trims only its own oldest DONE|FAIL|learned
FINDING (git keeps them). Leads (LESSON, FINDING learn=none) stay until wrap settles them; doctor fails above 30.
Agents append `<UTC ISO> s=<session> LESSON <VAE-DIALECT>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
Session start injects the 3 newest open entries: LESSON, FINDING learn=none, FAIL without a later DONE.
Wrap: EVERY lead becomes a test | .vae/VERIFY.py rule | one MEMORY line with BC, then delete; OR delete BC evidence. -->

2026-11-01T14:47:17Z s=80ef108c FAIL env.example
2026-11-01T14:52:43Z s=80ef108c DONE fp=e47c1fa7f528 cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,AGENTS.md,ARCH.md(+40)
2026-11-01T14:52:43Z s=80ef108c FINDING tsconfig.json:extends learn=verifier: rule build.standalone-tsconfig
2026-11-01T14:52:43Z s=80ef108c FINDING src/*.test.ts:@vitest-environment happy-dom learn=verifier: make test/coverage run in the gate; the annotation is gone and coverage thresholds fail an empty run
2026-11-01T14:52:43Z s=80ef108c FINDING src/deserialize.ts:VOID learn=test: src/regressions.test.ts restores undefined
2026-11-01T14:52:43Z s=80ef108c FINDING src/serialize.ts:PRIMITIVE number learn=test: src/regressions.test.ts special numbers; .vae/checks/wire-tags.py freezes tags
2026-11-01T14:52:43Z s=80ef108c FINDING src/serialize.ts:encodeTypedItem learn=test: src/regressions.test.ts typed arrays
2026-11-01T14:52:43Z s=80ef108c FINDING src/serialize.ts:DATE learn=test: src/regressions.test.ts invalid Date
2026-11-01T14:52:43Z s=80ef108c FINDING src/deserialize.ts:ArrayBuffer|DataView getValue learn=test: src/regressions.test.ts identity
2026-11-01T14:52:43Z s=80ef108c FINDING src/serialize.ts:DataView spread learn=test: src/regressions.test.ts window
2026-11-01T14:52:43Z s=80ef108c FINDING src/deserialize.ts:createError learn=test: src/regressions.test.ts AggregateError
2026-11-01T14:52:43Z s=80ef108c FINDING src/serialize.ts:getType learn=test: src/regressions.test.ts iterators
2026-11-01T14:52:43Z s=80ef108c FINDING src/deserialize.ts:default branch learn=test: src/regressions.test.ts untrusted input + e2e matrix in 4 runtimes
2026-11-01T14:52:43Z s=80ef108c FINDING src/deserialize.ts:OBJECT __proto__ learn=test: src/regressions.test.ts prototype
2026-11-01T14:52:43Z s=80ef108c FINDING README.md:Usage learn=test: e2e/docs.test.ts and e2e/site.spec.ts run every README block in Node, Bun, Chromium, WebKit
2026-11-01T14:52:43Z s=80ef108c FINDING src/types.d.ts learn=verifier: rule src.no-runtime-declaration-files
2026-11-01T14:52:43Z s=80ef108c FINDING src/index.ts:DSON learn=none: documented interface; one-time structural fix, no mechanical recurrence check
2026-11-01T14:52:43Z s=80ef108c FINDING README.md:34, docs/index.html:144, ARCH.md:59, documentation/format.md:71 (B01) learn=none: wording corrected; semantic, not mechanically checkable
2026-11-01T14:52:43Z s=80ef108c FINDING README.md:round-trip table (B01) learn=none: row split; semantic
2026-11-01T14:52:43Z s=80ef108c FINDING vitest.config.ts:coverage.reporter learn=none: skipFull:false; gate fails loudly if the row disappears
2026-11-01T14:52:43Z s=80ef108c FINDING src/equals.ts:isEqual learn=none: measured with scripts/bench.mjs
2026-11-01T15:55:30Z s=80ef108c FAIL env.example
2026-11-01T15:58:29Z s=80ef108c DONE fp=667cea3b1c32 cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,.oxlintrc.json,AGENTS.md(+43)
2026-11-01T15:58:29Z s=80ef108c FINDING docs/index.html:.dz-editor-layer learn=verifier: rule site.code-languages and the e2e editor highlighting test
2026-11-01T15:58:29Z s=80ef108c FINDING docs/assets/site.js:load learn=none: replaced by an explicit refreshEditor hook; one-off wiring
2026-11-01T15:58:29Z s=80ef108c FINDING docs/assets/site.css:.dz-flow learn=test: e2e phone test asserts the figure does not scroll
2026-11-01T15:58:29Z s=80ef108c FINDING e2e/site.spec.ts:copy test learn=none: locator scoped to the tab labels
2026-11-01T15:58:29Z s=80ef108c FINDING scripts/site.mjs:bundleShiki learn=verifier: the gate's env.example check fails if a bundle reads an undeclared key again
2026-11-01T18:37:25Z s=80ef108c DONE fp=1f1c92701f09 cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,.oxlintrc.json,AGENTS.md(+43)
2026-11-01T18:37:25Z s=80ef108c FINDING docs/index.html:133 B06 learn=none: one-off wording on the site; the e2e suite checks the page's behaviour and facts, not its prose
2026-11-01T18:37:25Z s=80ef108c FINDING docs/index.html:144 S04 learn=none: one-off wording on the site; the e2e suite checks the page's behaviour and facts, not its prose
2026-11-01T18:37:25Z s=80ef108c FINDING docs/index.html:377 B05 learn=none: one-off wording on the site; the e2e suite checks the page's behaviour and facts, not its prose
2026-11-01T18:37:25Z s=80ef108c FINDING docs/index.html:361 R03 learn=none: one-off wording on the site; the e2e suite checks the page's behaviour and facts, not its prose
2026-11-01T18:37:25Z s=80ef108c FINDING docs/index.html:296 P07 learn=none: one-off wording on the site; the e2e suite checks the page's behaviour and facts, not its prose
2026-11-01T18:37:25Z s=80ef108c FINDING docs/index.html:159 B05 learn=none: one-off wording on the site; the e2e suite checks the page's behaviour and facts, not its prose
2026-11-01T18:39:38Z s=80ef108c DONE fp=e441007bcd49 cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,.oxlintrc.json,AGENTS.md(+43)
2026-11-01T18:39:38Z s=80ef108c FINDING docs/index.html:183 learn=none: one-off layout wording from the human's review
2026-11-01T18:46:14Z s=80ef108c DONE fp=3775bf94ff7d cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,.oxlintrc.json,AGENTS.md(+43)
2026-11-01T18:47:55Z s=80ef108c DONE fp=695408907830 cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,.oxlintrc.json,AGENTS.md(+43)
2026-11-01T18:47:55Z s=80ef108c FINDING docs/index.html:170 A01 learn=none: one-off wording from the human's review
2026-11-01T18:49:43Z s=80ef108c DONE fp=55f77afd8a84 cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,.oxlintrc.json,AGENTS.md(+43)
2026-11-01T19:03:27Z s=80ef108c FAIL tests.e2e.1
2026-11-01T19:04:21Z s=80ef108c DONE fp=f67e8e5035b4 cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,.oxlintrc.json,AGENTS.md(+43)
2026-11-01T19:04:21Z s=80ef108c FINDING docs/index.html#faq; e2e/site.spec.ts:78,185 learn=test: e2e/site.spec.ts asserts the FAQ section and its cards
2026-11-01T19:22:13Z s=80ef108c DONE fp=bb40ab23fc3f cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,.oxlintrc.json,AGENTS.md(+46)
2026-11-01T19:22:13Z s=80ef108c FINDING src/deserialize.ts:list learn=test: src/untrusted.test.ts pins the refusal; the fuzz test bounds every decoded buffer to 8 bytes per text character
2026-11-01T19:22:13Z s=80ef108c FINDING src/deserialize.ts:fill OBJECT learn=test: src/untrusted.test.ts covers both key shapes; the fuzz test counts replaced prototypes
2026-11-01T19:22:13Z s=80ef108c FINDING src/serialize.ts:encode, src/deserialize.ts:decode learn=test: src/structure.test.ts round-trips 50,000 levels, 20,000 nested Map keys and the cap
2026-11-01T19:22:13Z s=80ef108c FINDING src/serialize.ts:visit toJSON learn=test: src/structure.test.ts compares with JSON.stringify
2026-11-01T19:22:13Z s=80ef108c FINDING src/json.ts:parse learn=test: src/untrusted.test.ts table plus 3,000 fuzz cases assert TypeError with a DSON: message
2026-11-01T19:22:13Z s=80ef108c FINDING vitest.config.ts:thresholds learn=verifier: the coverage threshold is the check
2026-11-01T19:22:13Z s=80ef108c FINDING src/equals.ts, scripts/bench.mjs, ARCH.md, CHANGELOG.md isEqual figure learn=memory: .vae/CLI_GIST.md bench line: alternate builds, absolute medians follow load
2026-11-01T19:48:13Z s=80ef108c DONE fp=c8e0426c452c cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,.oxlintrc.json,AGENTS.md(+48)
2026-11-01T19:48:13Z s=80ef108c FINDING src/serialize.ts:serialize maxDepth; src/json.ts DSONOptions learn=test: src/structure.test.ts covers the boundary, Infinity, invalid values and isEqual; e2e/package.test.ts type-checks DSONOptions from the tarball
2026-11-01T19:48:13Z s=80ef108c FINDING scripts/bench.mjs learn=none: measurement script; its output is checked by the site test against docs/data/bench.json
2026-11-01T19:48:13Z s=80ef108c FINDING scripts/site.mjs:benchData/coverageData learn=verifier: site.mjs --check in make e2e fails on stale or foreign figures
2026-11-01T19:48:13Z s=80ef108c FINDING docs/index.html#numbers; docs/assets/site.css learn=test: e2e/site.spec.ts checks every row against docs/data/bench.json and the rings against docs/data/coverage.json
2026-11-01T19:56:31Z s=80ef108c FAIL lint
2026-11-01T19:58:12Z s=80ef108c DONE fp=fa8431934b56 cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,.oxlintrc.json,AGENTS.md(+50)
2026-11-01T19:58:12Z s=80ef108c FINDING scripts/bench-core.mjs, scripts/bench-browser.mjs learn=test: e2e/site.spec.ts checks all four runtime tables against docs/data/bench.json
2026-11-01T19:58:12Z s=80ef108c FINDING scripts/site.mjs renderCoverage; docs/index.html i-logo learn=none: visual change; the site test covers the rings' values
2026-11-01T19:58:12Z s=80ef108c FINDING scripts/bench.mjs:28 learn=none: lint caught it
2026-11-01T20:00:22Z s=80ef108c DONE fp=7e07f686cfd6 cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,.oxlintrc.json,AGENTS.md(+50)
2026-11-01T20:00:22Z s=80ef108c FINDING scripts/site.mjs:RUNTIMES learn=none: presentation order chosen by the human
2026-11-01T20:04:23Z s=80ef108c DONE fp=be942396c5b5 cov=100.0% paths=.claude/settings.json,.github/workflows/verify.yml,.oxlintrc.json,AGENTS.md(+50)
2026-11-01T20:04:23Z s=80ef108c FINDING docs/index.html#faq learn=test: e2e/site.spec.ts counts the FAQ cards
2026-11-01T20:11:43Z s=80ef108c DONE fp=2aaf68849b67 cov=100.0% paths=bun.lock,docs/data/manifest.json,package.json,scripts/site.mjs
2026-11-01T20:11:43Z s=80ef108c FINDING scripts/site.mjs:measure learn=verifier: site.mjs --check in CI now compares a platform-independent figure; the measure() comment records why node:zlib must not return
2026-11-01T20:19:35Z s=80ef108c DONE fp=29c6357d6302 cov=100.0% paths=ARCH.md,docs/assets/site.js,e2e/site.spec.ts
2026-11-01T20:19:35Z s=80ef108c FINDING docs/assets/site.js:version badges learn=test: e2e/site.spec.ts answers the request itself: 9.9.9 updates every badge, a 503 keeps the build's version, in Chromium and WebKit
