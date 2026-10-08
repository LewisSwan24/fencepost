"""proxy/words.py -> hardware/share-tag/words.h, the share tag's copy of the word list (#54).

    python scripts/build_tag_words.py

The tag never goes online, so it cannot ask the server whether a code exists. It can at least
refuse words no Share screen ever hands out, which is what an owner's own three words, or a
typo, usually are. The header is generated so there is one list; tests/test_share_tag.py
fails if it falls out of step with proxy/words.py.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from proxy.words import WORDS  # noqa: E402

OUT = ROOT / "hardware" / "share-tag" / "words.h"


def render(words) -> str:
    assert list(words) == sorted(words), "the tag looks words up by binary search"
    lines = [
        "// Generated from proxy/words.py by scripts/build_tag_words.py. Do not edit by hand.",
        "// Sorted, so the tag can binary-search it with strcmp.",
        "#pragma once",
        "",
        "static const char* const WORDS[] = {",
    ]
    row = []
    for word in words:
        row.append(f'"{word}",')
        if len(" ".join(row)) > 90:
            lines.append("  " + " ".join(row))
            row = []
    if row:
        lines.append("  " + " ".join(row))
    lines += ["};", f"static const int WORDS_COUNT = {len(words)};", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    OUT.write_text(render(WORDS), encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(WORDS)} words)")
