#!/usr/bin/env python3
"""Extract the table SQL from docs/data-model.md §1.

docs/data-model.md is the single source and schema.sql is generated — never hand-edit the
generated file. docs/ is not in the repository, so schema.sql has to be: without it nobody
who clones this can build the database.

    python scripts/build_schema.py
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "data-model.md"
OUT = ROOT / "schema.sql"
SQL_BLOCK = re.compile(r"^```sql$(.*?)^```$", re.DOTALL | re.MULTILINE)
HEADER = "-- GENERATED from docs/data-model.md §1 — do not edit by hand\n\n"


def render() -> str:
    """Return the full contents schema.sql should have. Tests compare against it for drift."""
    if not SRC.exists():
        sys.exit(f"Cannot find {SRC}. docs/ is not in the repository, so this script only "
                 "runs on a machine that has the documents.")
    match = SQL_BLOCK.search(SRC.read_text(encoding="utf-8"))
    if not match:
        sys.exit("No SQL block found in data-model.md")
    return HEADER + match.group(1).strip() + "\n"


def main() -> None:
    text = render()
    OUT.write_text(text, encoding="utf-8", newline="\n")
    tables = re.findall(r"CREATE TABLE (\w+)", text)
    print(f"  {OUT.relative_to(ROOT)}  ({len(tables)} tables: {', '.join(tables)})")


if __name__ == "__main__":
    main()
