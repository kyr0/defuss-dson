"""Fails when a DSON record tag changes number or disappears, or when the format page's tag table disagrees.

Why: tag numbers are the wire format. Renumbering one makes every stored DSON text decode into wrong types without
an error, so the table below is frozen; a new tag is appended here, in src/tags.ts and in documentation/format.md.
"""
import re
import sys
from pathlib import Path

FROZEN = {"VOID": -1, "PRIMITIVE": 0, "ARRAY": 1, "OBJECT": 2, "DATE": 3, "REGEXP": 4, "MAP": 5, "SET": 6,
          "ERROR": 7, "BIGINT": 8, "NUMBER": 9,
          "B_NULL": 10, "B_UNDEFINED": 11, "B_FALSE": 12, "B_TRUE": 13, "B_STRING": 14, "B_FLOAT64": 15, "B_BIGINT": 16, "B_ARRAY": 17, "B_OBJECT": 18, "B_NULL_OBJECT": 19, "B_DATE": 20, "B_REGEXP": 21, "B_MAP": 22, "B_SET": 23, "B_ERROR": 24, "B_BUFFER": 25, "B_VIEW": 26, "B_BOX": 27}
root = Path(__file__).resolve().parents[2]
source = (root / "src/tags.ts").read_text("utf-8")
tags = {name: int(value) for name, value in re.findall(r"^export const (\w+) = (-?\d+);", source, re.M)}
spec = (root / "documentation/format.md").read_text("utf-8")
problems = [f"src/tags.ts: {name} must stay {value}, found {tags.get(name)}" for name, value in FROZEN.items() if tags.get(name) != value]
problems += [f"src/tags.ts: {name}={value} is not in the frozen table of .vae/checks/wire-tags.py" for name, value in tags.items() if name not in FROZEN]
problems += [f"documentation/format.md: tag table lacks the row '| {value} | {name} |'" for name, value in FROZEN.items()
             if not re.search(rf"^\|\s*{value}\s*\|\s*{name}\s*\|", spec, re.M)]
# Subtype positions are wire values too: inserting a constructor would reinterpret stored bytes.
binary = (root / "src/binary.ts").read_text("utf-8")
subtypes = {
    "VIEW_NAMES": ["DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
                   "Int32Array", "Uint32Array", "Float16Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array"],
    "ERRORS": ["Error", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError", "AggregateError"],
    "BOXES": ["Boolean", "Number", "String", "BigInt"],
}
for name, expected in subtypes.items():
    match = re.search(rf"const {name} = \[([^\]]*)\]", binary)
    actual = re.findall(r"[A-Za-z][A-Za-z0-9]*", match[1]) if match else []
    if actual != expected:
        problems.append(f"src/binary.ts: {name} wire subtype order must stay {expected}; append and document new subtypes explicitly")
if problems:
    print("\n".join(problems))
    sys.exit(1)
print(f"wire tags frozen: {len(FROZEN)}")
