#!/usr/bin/env python3
"""Non-English screening batch — operations.md §4.2.

    python tests/run_nonenglish.py

It goes through proxy.roles.screener rather than calling the model directly. The
non-English floor (§4.3: a non-English submission tops out at review and is never
rejected) is implemented in that layer, and bypassing it would test something other than
the real behaviour.

The report records two things separately: what the model itself decided, and whether the
floor pushed a reject down to review.
"""

import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    import yaml
except ImportError:
    sys.exit("Missing dependency: pip install pyyaml")

from proxy import roles
from proxy.env import load_env
from proxy.model import DashScope

CASES = Path(__file__).resolve().parent / "nonenglish_cases.yaml"


def main() -> None:
    load_env()
    cases = yaml.safe_load(CASES.read_text(encoding="utf-8"))
    client = DashScope()
    rows, agreed, floored = [], 0, 0
    versions = set()

    for case in cases:
        result = roles.screener(client, "unknown", case["field"], case["input"])
        raw = "reject" if result["downgraded_non_english"] else result["verdict"]
        verdict = result["verdict"]
        judged = "ok" if verdict == "ok" else "flag"
        match = judged == case["expect"]
        agreed += match
        floored += bool(result["downgraded_non_english"])
        rows.append((case, raw, verdict, result["codes"], match))
        # Taken from the result rather than read off disk: this is the version the call
        # actually recorded. A run that somehow spanned two would show both, rather than
        # quietly claiming one.
        versions.add(result["prompt_version"])
        mark = "match" if match else "differs"
        print(f"  {case['id']:6} {case['category']:9} human={case['expect']:4} "
              f"model={raw:6} final={verdict:6} {mark}")

    total = len(rows)
    by_language = Counter(case["language"] for case, _, _, _, ok in rows if ok)
    counts = Counter(case["language"] for case in cases)

    lines = [
        "# Non-English screening batch",
        "",
        f"- Run: {datetime.now():%Y-%m-%d %H:%M}",
        f"- Prompt version: `{', '.join(sorted(versions)) or 'unknown'}`",
        f"- Sample: {total} cases, zh/vi/ar {counts['zh']}/{counts['vi']}/{counts['ar']}",
        f"- Agreed with the human judgement: {agreed}/{total} ({agreed / total:.0%})",
        "  - " + ", ".join(f"{lang} {by_language[lang]}/{counts[lang]}" for lang in ("zh", "vi", "ar")),
        f"- Times the floor pushed a reject down to review: {floored}",
        "",
        "The model column is what the model decided; final is what the user actually met "
        "after the floor.",
        "",
        "| # | language | category | human | model | final | codes | agree |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for case, raw, verdict, codes, ok in rows:
        lines.append(f"| {case['id']} | {case['language']} | {case['category']} | "
                     f"{case['expect']} | {raw} | {verdict} | {' '.join(codes) or '-'} | "
                     f"{'yes' if ok else 'no'} |")

    out = Path(__file__).resolve().parent / f"nonenglish_report_{datetime.now():%Y%m%d_%H%M}.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"\nAgreement {agreed}/{total}, floor stepped in {floored} times")
    print(f"Report: {out}")


if __name__ == "__main__":
    main()
