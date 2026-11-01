"""Fails when a DSON record tag changes number or disappears, or when the format page's tag table disagrees.

Why: tag numbers are the wire format. Renumbering one makes every stored DSON text decode into wrong types without
an error, so the table below is frozen; a new tag is appended here, in src/tags.ts and in documentation/format.md.
"""
import re
import sys
from pathlib import Path

FROZEN = {"VOID": -1, "PRIMITIVE": 0, "ARRAY": 1, "OBJECT": 2, "DATE": 3, "REGEXP": 4, "MAP": 5, "SET": 6,
          "ERROR": 7, "BIGINT": 8, "NUMBER": 9}
root = Path(__file__).resolve().parents[2]
source = (root / "src/tags.ts").read_text("utf-8")
tags = {name: int(value) for name, value in re.findall(r"^export const (\w+) = (-?\d+);", source, re.M)}
spec = (root / "documentation/format.md").read_text("utf-8")
problems = [f"src/tags.ts: {name} must stay {value}, found {tags.get(name)}" for name, value in FROZEN.items() if tags.get(name) != value]
problems += [f"src/tags.ts: {name}={value} is not in the frozen table of .vae/checks/wire-tags.py" for name, value in tags.items() if name not in FROZEN]
problems += [f"documentation/format.md: tag table lacks the row '| {value} | {name} |'" for name, value in FROZEN.items()
             if not re.search(rf"^\|\s*{value}\s*\|\s*{name}\s*\|", spec, re.M)]
if problems:
    print("\n".join(problems))
    sys.exit(1)
print(f"wire tags frozen: {len(FROZEN)}")
