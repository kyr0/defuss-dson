"""Fails when any commit message credits an AI assistant as co-author, or when the commit-msg hook is not active.

Why: the project's history names human authors only. The hook (.githooks/commit-msg) stops new trailers; this
check also catches commits made with hooks bypassed (--no-verify) or on another machine.
"""
import re
import subprocess
import sys

TRAILER = re.compile(r"^\s*co-authored-by:.*(claude|anthropic)", re.I | re.M)
log = subprocess.run(["git", "log", "--all", "--format=%H%n%B%x00"], capture_output=True, text=True)
if log.returncode not in (0, 128):  # 128: no commits yet
    print(log.stderr.strip())
    sys.exit(1)
bad = [entry.split("\n", 1)[0] for entry in log.stdout.split("\x00") if TRAILER.search(entry)]
hooks = subprocess.run(["git", "config", "core.hooksPath"], capture_output=True, text=True).stdout.strip()
problems = [f"commit {sha} has an AI co-author trailer; rewrite its message" for sha in bad]
if hooks != ".githooks":
    problems.append("git config core.hooksPath is not .githooks; run `make setup`")
if problems:
    print("\n".join(problems))
    sys.exit(1)
print("no AI co-author trailers; commit-msg hook active")
