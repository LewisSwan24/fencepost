#!/usr/bin/env python3
"""
Extract runnable prompt files from docs/prompts.md.

docs/prompts.md is the single source and prompts/*.txt are generated — never hand-edit the
generated files. After changing the document, run:

    python scripts/build_prompts.py

Outputs:
    prompts/shared.txt      SHARED RULES
    prompts/neighbour.txt   ROLE: NEIGHBOUR + CONTEXT BOUNDARY + VISION RULES
    prompts/screener.txt    ROLE: SCREENER + few-shot
    prompts/VERSION         the document version, recorded with every model call
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# In the repository it sits under docs/; in a loose directory, alongside. Both are accepted.
SRC = next((c for c in (ROOT / "docs" / "prompts.md", ROOT / "prompts.md") if c.exists()),
           ROOT / "docs" / "prompts.md")
OUT = ROOT / "prompts"

# generated file → the start markers of the blocks, joined in that order
LAYOUT = {
    "shared": ["=== SHARED RULES ==="],
    "neighbour": ["=== ROLE: NEIGHBOUR ===", "=== CONTEXT BOUNDARY ===", "=== VISION RULES ==="],
    "screener": ["=== ROLE: SCREENER ==="],
}

FEWSHOT_ANCHOR = 'Input: "Brushtail possums are marsupials'


def extract_block(text: str, start_marker: str) -> str:
    """Take everything from start_marker to the next === END ... === (markers included)."""
    i = text.find(start_marker)
    if i == -1:
        sys.exit(f"Block not found in prompts.md: {start_marker}")
    end = re.search(r"^=== END [A-Z: ]+===$", text[i:], re.MULTILINE)
    if not end:
        sys.exit(f"Block has no end marker: {start_marker}")
    return text[i : i + end.end()].strip()


def extract_fewshot(text: str) -> str:
    i = text.find(FEWSHOT_ANCHOR)
    if i == -1:
        sys.exit("Cannot find the Screener few-shot block")
    fence = text.find("```", i)
    if fence == -1:
        sys.exit("The few-shot block has no closing fence")
    return text[i:fence].strip()


def extract_version(text: str) -> str:
    # The source document heads its version line in either language; accept both, so the
    # generator does not depend on which one docs/prompts.md happens to use.
    m = re.search(r"^> (?:Version|\u7248\u672c)[:\uff1a]\s*(v[\d.]+)", text, re.MULTILINE)
    return m.group(1) if m else "unknown"


def main() -> None:
    if not SRC.exists():
        sys.exit(f"Cannot find {SRC}")
    text = SRC.read_text(encoding="utf-8")

    OUT.mkdir(exist_ok=True)
    version = extract_version(text)

    for name, markers in LAYOUT.items():
        parts = [extract_block(text, m) for m in markers]
        if name == "screener":
            parts.append("EXAMPLES\n\n" + extract_fewshot(text))
        body = "\n\n".join(parts)
        # Only scan the generated files: the placeholder table in prompts.md §0 lists these
        # names itself, so scanning the whole document would always report false positives
        leftover = re.findall(r"\[(?:PLATFORM_NAME|ASSISTANT_NAME|RESCUE_CONTACT)\]", body)
        if leftover:
            print(f"  warning: {name}.txt still has {len(leftover)} unreplaced placeholders")
        header = f"# GENERATED from prompts.md {version} — do not edit by hand\n\n"
        path = OUT / f"{name}.txt"
        path.write_text(header + body + "\n", encoding="utf-8", newline="\n")
        print(f"  {path.relative_to(ROOT)}  ({len(body.splitlines())} lines)")

    # newline="\n" matters here as much as it does above: without it, write_text
    # translates on Windows and VERSION alone comes out CRLF while every other generated
    # file is LF. The generator then dirties git on every run, which makes it look
    # non-deterministic and invites somebody to commit a line-ending-only change.
    (OUT / "VERSION").write_text(version + "\n", encoding="utf-8", newline="\n")
    print(f"  prompts/VERSION  ({version})")
    print("\nReminder: every model call must record this version in "
          "screening_results / chat_messages.")


if __name__ == "__main__":
    main()
