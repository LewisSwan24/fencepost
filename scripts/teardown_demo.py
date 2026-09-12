#!/usr/bin/env python3
"""课程 demo 结束后清空数据库。

operations.md §1 最后一行：「课程 demo 结束 —— 全部清除，包括后端日志。这一条写进报告。」
所以这不是一个便利脚本，是报告里要指得出来的东西。

    python scripts/teardown_demo.py            # 只数，不删
    python scripts/teardown_demo.py --yes      # 真删

后端日志不在这里：那是 Vercel 那边的运行日志，这个脚本删不了，也不该假装删得了。
打印的提醒里说了怎么处理。
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from proxy.db import Database

TABLES = ("screening_results", "review_votes", "rate_limits", "chat_messages", "forum_posts",
          "forum_threads", "share_links", "access_grants", "entries", "videos", "storyboards",
          "users")


def counts(db: Database) -> dict:
    return {name: db.conn.execute(f"SELECT COUNT(*) AS c FROM {name}").fetchone()["c"]
            for name in TABLES}


def clear(db: Database) -> dict:
    """按外键顺序从叶子往根删。返回每张表删掉多少行。"""
    before = counts(db)
    for name in TABLES:
        db.conn.execute(f"DELETE FROM {name}")
    db.conn.commit()
    return before


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", action="store_true", help="真的删。不给就只数一数。")
    parser.add_argument("--db", default=os.getenv("FENCEPOST_DB", "fencepost.db"))
    args = parser.parse_args()

    if not Path(args.db).exists():
        sys.exit(f"没有这个库: {args.db}")
    db = Database(args.db)

    if not args.yes:
        print(f"{args.db} 现在有：")
        for name, number in counts(db).items():
            print(f"  {name:22} {number}")
        print("\n加 --yes 才会真删。")
        return

    removed = clear(db)
    print(f"已清空 {args.db}：")
    for name, number in removed.items():
        print(f"  {name:22} -{number}")
    print("\n数据库清干净了。还剩两样不在这个脚本管辖内：")
    print("  1. Vercel 的运行日志。控制台里按项目删，或者把整个项目删掉。")
    print("  2. 上传的视频本身。videos 表只存 storage_key，文件在对象存储里，要另外清。")


if __name__ == "__main__":
    main()
