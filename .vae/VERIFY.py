"""Project-local verifier policy. Agents MAY extend it; every gate executes it fail-closed."""

CONFIG = {
    "coverage_min": 60,
    "lint_command": None,          # None → `make lint` (uv run ruff check . | bunx oxlint --deny-warnings).
    "test_command": None,          # None → `make test`. Commands run in the repo root.
    "coverage_command": None,      # None → `make coverage`; output needs `TOTAL <n>%` or an `All files |…|` table.
    "integration_commands": [],    # [] → `make integration` if present.
    "e2e_commands": [],            # [] → `make e2e`: build + consume the publishable artifact.
    "e2e_paths": [],               # globs e2e depends on, e.g. ["web/*"]: e2e reruns only when one (or a build file) changed; [] → any code file.
    "timeout_s": 900,              # make e2e packs, installs and drives two browsers: about a minute locally, more in CI.
    # `init` on a GitHub remote writes .github/workflows/verify.yml (uv/bun via their official setup actions) unless a
    # workflow already runs `make verify`, these commands or every verify verb. None → make setup, make verify.
    "ci": None,                    # None | False (no CI workflow) | ["make setup", "make ci"] (one step each)
    "layout": True,                # Makefile verbs + gitignored secrets, runtime state, dist/, caches and package folders.
    "strict": True,               # docs.pages, gitignore and package block; False makes them warnings (a project created before 0.6.0 has False).
    "gitignore_exempt": [],        # required ignore lines this project may skip, e.g. ["dist/"] for a GitHub Action that commits its build.
    "toolchain": True,             # new (sub)projects start on bun (JS/TS) / uv (Python): newly added npm/yarn/pnpm/poetry/pipenv/pdm/pip lockfiles fail.
    # Static check of every changed doc page (*.md|*.mdx|*.markdown); False disables it.
    # allow: {glob: characters a page may use as house style}, e.g. {"docs/de/*.md": "\u201e\u201c"} for German quotes.
    # phrases: extra slop regexes (any language), case-insensitive, flagged as findings.
    # html: globs of HTML pages that are prose (a project site, e.g. ["docs/*.html"]), checked in their text and
    # reader-facing attributes; other HTML files (templates, reports) are code.
    # HYPOTHESIS: most projects need no allow entry; add one only for a page whose house style needs a flagged character.
    # README.md covers the root and each package with a changed CLI|API; ARCH.md each package with changed production code
    # or deployment|schema files. A page covers the folders below it up to the next package manifest; tests, examples,
    # docs, config and data need none.
    "readme": {"exclude": []},     # folder globs exempt from README.md coverage; False drops it (the root still needs one)
    "arch": {"exclude": []},       # folder globs exempt from ARCH.md coverage; False drops it
    # Changed package.json: packageManager, description, license, author; new packages also type, linter, library build.
    "package": {"manager": "bun", "type": "module", "lint": "oxlint", "library_build": "pkgroll"},  # False disables
    # Optional for edit runs (references/EDIT.md): "guidelines" (textsorte, zielgruppe, kommunikationsziel, hausstil,
    # geschuetzte_begriffe: terms a replacement must keep) and "edit" (max_part_chars, heading_depth, attempts, the
    # budgets, tool_scope, trace, max_tokens_total); unset keys keep pro-edit's defaults.
    # README.md: the emoji feature bullets are the house style of the defuss READMEs (defuss-i18n, defuss-lexicalsearch);
    # each one marks a list item and replaces no word. AGENTS.md: the managed defuss-vae block uses arrows as notation.
    "prose": {"allow": {"README.md": "\U0001F501\U0001F9EC\U0001F517\U0001F6E1\uFE0F\u2696\U0001F9EA\U0001F310\U0001FAB6\u2705\u00B1",
                        "AGENTS.md": "\u2192", "documentation/format.md": "\u00B1", "CHANGELOG.md": "\u00B1", "ARCH.md": "\u00B1"},
              "phrases": [], "html": ["docs/*.html"]},
}

# Deterministic invariants only; no semantic guesses.
# kinds: command | file_exists | contains | regex | not_regex
# When none of these can express an invariant (it needs parsing, several files, a running program or project
# semantics), plan the check like a test: write .vae/checks/<id>.py (stdlib, exits non-zero and prints what to fix)
# and add {"id": "<id>", "kind": "command", "command": "python3 .vae/checks/<id>.py", "claim": "..."}.
# scope: "path" = one exact file; "glob" = every changed code file matching (fnmatch); "glob" + "docs": True = every
# changed doc page matching, e.g. {"id": "docs.arch.diagram", "kind": "contains", "path": "docs/ARCHITECTURE.md",
# "text": "```mermaid", "claim": "architecture page keeps its diagram"}.
RULES = [{
    "id": "tests.no-mocks",
    "kind": "not_regex",
    "glob": "*",
    # Every alternative contains an escape, so this file never matches its own pattern.
    "pattern": r"unittest\.mock|from\s+unittest\s+import\s+mock|MagicMock\(|mock\.patch|mocker\.|"
               r"jest\.(?:mock|fn|spyOn)\(|vi\.(?:mock|fn|spyOn)\(|sinon\.|gomock\.|mock\.Mock\b|Mockito\.|@Mock\s|mockk\(|"
               r"@Mock(?:ito)?Bean\b|new\s+Mock<|Mock\.Of<|Substitute\.For<|A\.Fake<|mockall:{2}|#\[automock\]",
    "claim": "tests exercise real subsystems, not mock frameworks",
}, {
    # The human asked that an AI assistant never appears as co-author in the history (2026-11-01).
    "id": "git.no-ai-coauthor",
    "kind": "command",
    "command": "python3 .vae/checks/no-ai-coauthor.py",
    "claim": "no commit credits an AI assistant as co-author, and the commit-msg hook that rejects such trailers is active",
}, {
    "id": "claude.attribution-off",
    "kind": "contains",
    "path": ".claude/settings.json",
    "text": "\"commit\": \"\"",
    "claim": "Claude Code adds no co-author trailer to commits made in this repository",
}, {
    "id": "wire.tags-frozen",
    "kind": "command",
    "command": "python3 .vae/checks/wire-tags.py",
    "claim": "record tag numbers never change, and documentation/format.md lists every tag",
}, {
    "id": "docs.readme-structure",
    "kind": "command",
    "command": "python3 .vae/checks/readme-structure.py",
    "claim": "README.md keeps the defuss README sections in order and its generated size table",
}, {
    # 1.1.2 extended ../../tsconfig.base.json of the former monorepo, and every build failed outside it.
    "id": "build.standalone-tsconfig",
    "kind": "not_regex",
    "path": "tsconfig.json",
    "pattern": r"\"extends\"\s*:\s*\"\.\.",
    "claim": "the TypeScript config does not extend a file outside the repository",
}, {
    # 1.1.2 kept the runtime tag constants in src/types.d.ts; tools that skip declaration files drop such values.
    "id": "src.no-runtime-declaration-files",
    "kind": "command",
    "command": "! ls src/*.d.ts >/dev/null 2>&1",
    "claim": "src/ holds no .d.ts files; runtime values live in .ts modules",
}, {
    "id": "test.runtimes",
    "kind": "contains",
    "path": "Makefile",
    "text": "bun --bun ./node_modules/.bin/vitest run",
    "claim": "make test runs the unit suite on Bun as well as on Node.js",
}, {
    "id": "e2e.browsers",
    "kind": "regex",
    "path": "playwright.config.ts",
    "pattern": r"name: \"chromium\"[\s\S]*name: \"webkit\"",
    "claim": "Playwright runs the browser e2e suite in Chromium and WebKit",
}, {
    "id": "ci.playwright-deps",
    "kind": "contains",
    "path": ".github/workflows/verify.yml",
    "text": "bunx playwright install --with-deps chromium webkit",
    "claim": "CI installs both browsers with their system libraries before make verify",
}, {
    "id": "ci.runs-verify",
    "kind": "contains",
    "path": ".github/workflows/verify.yml",
    "text": "- run: make verify",
    "claim": "CI runs the same make verify as local development",
}, {
    # Pages must never load a CDN file without Subresource Integrity: a changed file would run on the site unchecked.
    "id": "site.cdn-integrity",
    "kind": "not_regex",
    "path": "docs/index.html",
    "pattern": r"(?:href|src)=\"https://cdn\.jsdelivr\.net/npm/defuss-shadcn@[^\"]+\"(?![^>]*integrity=\"sha384-)",
    "claim": "every defuss-shadcn file the website loads is pinned with an integrity hash",
}, {
    # Shiki needs the language on the <pre>; a block without it renders as plain text.
    "id": "site.code-languages",
    "kind": "not_regex",
    "path": "docs/index.html",
    "pattern": r"<pre(?=[^>]*data-(?:numbers|tab|example))(?![^>]*data-lang=)[^>]*>",
    "claim": "every code block of the website declares its Shiki language",
}, {
    # All documentation is English (human request, 2026-11-01); German letters in a page signal an untranslated passage.
    "id": "docs.english",
    "kind": "not_regex",
    "glob": "*",
    "docs": True,
    "pattern": r"[\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df]",
    "claim": "documentation pages are written in English",
}]
