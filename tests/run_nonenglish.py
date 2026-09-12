#!/usr/bin/env python3
"""非英语筛查跑批 —— 对应 operations.md §4.2。

    python tests/run_nonenglish.py

走的是 proxy.roles.screener，不是直接调模型。非英语地板（§4.3：非英语提交最高只到
review，不得 reject）就实现在那一层，绕过去测的就不是真实行为。

报告里分开记两件事：模型自己判成什么，以及地板有没有把 reject 压成 review。
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
    sys.exit("缺依赖: pip install pyyaml")

from proxy import roles
from proxy.env import load_env
from proxy.model import DashScope

CASES = Path(__file__).resolve().parent / "nonenglish_cases.yaml"


def main() -> None:
    load_env()
    cases = yaml.safe_load(CASES.read_text(encoding="utf-8"))
    client = DashScope()
    rows, agreed, floored = [], 0, 0

    for case in cases:
        result = roles.screener(client, "unknown", case["field"], case["input"])
        raw = "reject" if result["downgraded_non_english"] else result["verdict"]
        verdict = result["verdict"]
        judged = "ok" if verdict == "ok" else "flag"
        match = judged == case["expect"]
        agreed += match
        floored += bool(result["downgraded_non_english"])
        rows.append((case, raw, verdict, result["codes"], match))
        mark = "一致" if match else "不一致"
        print(f"  {case['id']:6} {case['category']:9} 人工={case['expect']:4} "
              f"模型={raw:6} 落地={verdict:6} {mark}")

    total = len(rows)
    by_language = Counter(case["language"] for case, _, _, _, ok in rows if ok)
    counts = Counter(case["language"] for case in cases)

    lines = [
        "# 非英语筛查跑批",
        "",
        f"- 时间: {datetime.now():%Y-%m-%d %H:%M}",
        f"- 样本: {total} 条，中/越/阿各 {counts['zh']}/{counts['vi']}/{counts['ar']} 条",
        f"- 与人工判断一致: {agreed}/{total}（{agreed / total:.0%}）",
        "  - " + "，".join(f"{lang} {by_language[lang]}/{counts[lang]}" for lang in ("zh", "vi", "ar")),
        f"- 非英语地板把 reject 压成 review: {floored} 次",
        "",
        "「模型」是模型自己的判断，「落地」是过了地板之后用户实际遇到的结果。",
        "",
        "| # | 语言 | 类别 | 人工 | 模型 | 落地 | codes | 一致 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for case, raw, verdict, codes, ok in rows:
        lines.append(f"| {case['id']} | {case['language']} | {case['category']} | "
                     f"{case['expect']} | {raw} | {verdict} | {' '.join(codes) or '-'} | "
                     f"{'是' if ok else '否'} |")

    out = Path(__file__).resolve().parent / f"nonenglish_report_{datetime.now():%Y%m%d_%H%M}.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"\n一致率 {agreed}/{total}，地板介入 {floored} 次")
    print(f"报告: {out}")


if __name__ == "__main__":
    main()
