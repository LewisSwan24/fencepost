#!/usr/bin/env python3
"""Load the repository's .env and .env.local into os.environ. Standard library only.

The two files have different jobs: `.env` is hand-written (API key, token secret), while
`.env.local` comes out of `vercel integration add` and `vercel env pull` and carries the
hosted database address and token. Both are read, so what you see running locally is the
same set of variables the deployment has. Both are in .gitignore.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
LOCAL_ENV_FILE = ROOT / ".env.local"


def load_env(path: Path = ENV_FILE, also: Path = LOCAL_ENV_FILE) -> None:
    """Variables already in the environment win; the files never override them.

    .env.local is read first, then .env: setdefault is first-come-first-served, so the
    hand-written .env has the last word on a conflict. The two files do not actually share
    any variable names — this only pins the order so nobody has to guess later.
    """
    if also is not None and also != path:
        _read_into_environ(also)
    _read_into_environ(path)


def _read_into_environ(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(name.strip(), value)
