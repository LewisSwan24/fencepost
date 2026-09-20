#!/usr/bin/env python3
"""Non-English screening batch — operations.md §4.2.

    python tests/run_nonenglish.py

It goes through proxy.roles.screener rather than calling the model directly. The
non-English floor (§4.3: a non-English submission tops out at review and is never
rejected) is implemented in that layer, and bypassing it would test something other than
the real behaviour.

The report records three things separately: what the model itself decided, whether the
floor pushed a reject down to review, and whether the model answered at all.

That last one is not bookkeeping. A Screener that fails open returns `review`, which for
any case expecting a flag counts as the model agreeing with the human — so an upstream
outage would raise the agreement figure this report exists to state. Those rows are marked
and counted out of the agreement (#35, the same defect as in run_redline.py).
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
# Where the report lands. A name rather than an expression inside main() so a test can run
# the whole thing and have it write somewhere harmless — the archived reports live here.
REPORT_DIR = Path(__file__).resolve().parent

# Which of these share our alphabet. Only used to label the report: the point of the second
# signal in roles.looks_non_english is that these are the ones a character ratio cannot see,
# so a run that covers none of them is not evidence about the floor as it now stands.
LATIN_SCRIPT = {"fr", "es", "id", "pt", "mi", "tl", "de", "it", "nl"}


def main() -> None:
    load_env()
    cases = yaml.safe_load(CASES.read_text(encoding="utf-8"))
    client = DashScope()
    rows, agreed, floored, fell_back = [], 0, 0, 0
    versions = set()

    for case in cases:
        result = roles.screener(client, "unknown", case["field"], case["input"])
        # The model never answered, so there is nothing here to agree or disagree with.
        # Counting it either way would be a statement about a call that did not happen.
        opened = bool(result["fail_open"])
        raw = "fell back" if opened else (
            "reject" if result["downgraded_non_english"] else result["verdict"])
        verdict = result["verdict"]
        judged = "ok" if verdict == "ok" else "flag"
        match = judged == case["expect"] and not opened
        agreed += match
        floored += bool(result["downgraded_non_english"])
        fell_back += opened
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
        # Read off the corpus rather than named here. The file grew from three languages to
        # seven on 2026-09-17 and a hardcoded trio would have reported on three of them while
        # quietly running all seven — the report claiming less than the run covered.
        f"- Sample: {total} cases across {len(counts)} languages, "
        + " ".join(f"{lang} {n}" for lang, n in sorted(counts.items())),
        f"- Agreed with the human judgement: {agreed}/{total} ({agreed / total:.0%})",
        "  - " + ", ".join(f"{lang} {by_language[lang]}/{counts[lang]}"
                           for lang in sorted(counts)),
        # The split that matters. zh, vi and ar are written in scripts that are not ours, and
        # the old character-ratio floor could see all three. fr, es, id and pt share our
        # alphabet, so it could see none of them and they could be rejected outright — which
        # is the half of operations.md §4.3 that was not working until 2026-09-17.
        f"- Latin-script languages in the sample: "
        + ", ".join(sorted(LATIN_SCRIPT & set(counts)) or ["none"]),
        f"- Times the floor pushed a reject down to review: {floored}",
    ]
    if fell_back:
        lines.append(
            f"- **The Screener fell back on {fell_back} of {total} cases** — two attempts "
            "produced nothing usable, so `review` there is prompts.md §5's fallback and not "
            "a judgement. Counted as no agreement, because nothing was judged. Rerun them "
            "before quoting the figure above.")
    lines += [
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

    out = REPORT_DIR / f"nonenglish_report_{datetime.now():%Y%m%d_%H%M}.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"\nAgreement {agreed}/{total}, floor stepped in {floored} times"
          + (f", fell back {fell_back} times" if fell_back else ""))
    print(f"Report: {out}")


if __name__ == "__main__":
    main()
