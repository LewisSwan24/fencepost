#!/usr/bin/env python3
"""从 docs/data-model.md §1 抽出建表 SQL。

docs/data-model.md 是唯一来源，schema.sql 是生成物 —— 不要手改生成物。
docs/ 不进仓库，所以 schema.sql 必须进：没有它，别人 clone 下来建不出库。

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
    """返回 schema.sql 应有的完整内容。测试拿它比对有没有漂移。"""
    if not SRC.exists():
        sys.exit(f"找不到 {SRC}。docs/ 不进仓库，这个脚本只能在有文档的机器上跑。")
    match = SQL_BLOCK.search(SRC.read_text(encoding="utf-8"))
    if not match:
        sys.exit("data-model.md 里找不到 SQL 块")
    return HEADER + match.group(1).strip() + "\n"


def main() -> None:
    text = render()
    OUT.write_text(text, encoding="utf-8", newline="\n")
    tables = re.findall(r"CREATE TABLE (\w+)", text)
    print(f"  {OUT.relative_to(ROOT)}  （{len(tables)} 张表：{', '.join(tables)}）")


if __name__ == "__main__":
    main()
