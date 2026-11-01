"""Fails when README.md loses a section of the defuss README layout (the defuss-i18n style) or its generated table.

Why: the README is the package's front page on npm and GitHub; these sections answer, in order, what it is, how to
load it (CDN, local file, package manager), what it does, what to watch for, how big it is and how to work on it.
"""
import sys
from pathlib import Path

ORDER = ["# defuss-dson", "## TL;DR", "## Quick, CDN-based setup using ESM imports", "## Quick, non-CDN setup",
         "## For production: Install via package manager", "## API", "## What survives a round trip", "## Website",
         "## Three things to know", "## Size", "## Development", "## Citation", "## License"]
text = (Path(__file__).resolve().parents[2] / "README.md").read_text("utf-8")
lines = text.splitlines()
positions = [lines.index(heading) if heading in lines else -1 for heading in ORDER]
problems = [f"README.md: missing heading '{h}'" for h, p in zip(ORDER, positions) if p < 0]
found = [p for p in positions if p >= 0]
if found != sorted(found):
    problems.append("README.md: headings out of order; expected " + " > ".join(ORDER))
for marker in ("<!-- bundle-size:start -->", "<!-- bundle-size:end -->", "actions/workflows/verify.yml/badge.svg"):
    if marker not in text:
        problems.append(f"README.md: missing '{marker}'")
if problems:
    print("\n".join(problems))
    sys.exit(1)
print(f"README sections in order: {len(ORDER)}")
