#!/usr/bin/env python3
"""课程 demo 结束后清空数据库。

operations.md §1 最后一行：「课程 demo 结束 —— 全部清除，包括后端日志。这一条写进报告。」
所以这不是一个便利脚本，是报告里要指得出来的东西。

    python scripts/teardown_demo.py            # 只数，不删
    python scripts/teardown_demo.py --yes      # 真删

库的地址按 api/index.py 同样的顺序挑：--db → FENCEPOST_DB → TURSO_DATABASE_URL。
这一条是补的：库搬到托管的 Turso 之后，这个脚本还在只认本地文件，`Path(...).exists()`
对 `libsql://` 永远是假，于是它清不了真正存着数据的那个库——而「demo 结束全部清除」
是写进报告的承诺（operations.md §1），承诺靠的就是这个脚本。

对着托管库跑要用 **Python 3.12**：`libsql` 只有到 cp312 的轮子，本机默认的 3.14 装不上。

    py -3.12 scripts/teardown_demo.py          # 只数，不删
    py -3.12 scripts/teardown_demo.py --yes    # 真删

后端日志不在这里：那是 Vercel 那边的运行日志，这个脚本删不了，也不该假装删得了。
打印的提醒里说了怎么处理。
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from proxy.db import Database
from proxy.env import load_env
from proxy.store import REMOTE_PREFIXES

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
    # 托管库的地址在 .env.local 里。不先读，下面取到的是 None，于是静悄悄地清了本地
    # 那个空库并报告「已清空」——api/index.py 里同样的坑，同样的解法。
    load_env()

    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", action="store_true", help="真的删。不给就只数一数。")
    parser.add_argument("--db", default=None,
                        help="库地址。不给就按 FENCEPOST_DB、TURSO_DATABASE_URL 的顺序找。")
    args = parser.parse_args()

    address = (args.db or os.getenv("FENCEPOST_DB") or os.getenv("TURSO_DATABASE_URL")
               or "fencepost.db")
    # 只有本地文件才谈得上「存不存在」。托管库是个 URL，拿 Path.exists() 去问它，
    # 答案永远是「没有这个库」——脚本于是从来碰不到真正存着数据的那个库。
    if not address.startswith(REMOTE_PREFIXES) and not Path(address).exists():
        sys.exit(f"没有这个库: {address}")
    db = Database(address)
    remote = address.startswith(REMOTE_PREFIXES)
    shown = address.split("?", 1)[0] if remote else address

    if not args.yes:
        print(f"{shown} 现在有：" if not remote else f"{shown}（托管库）现在有：")
        for name, number in counts(db).items():
            print(f"  {name:22} {number}")

        # 交付前查一次引用完整性。两个后端上外键都是开着的，所以这里应该永远是空的，
        # 有东西就说明别处出了问题。
        #
        # （这行注释原先写着「托管的 libSQL 上外键强制不了」。那是错的：收不下
        # PRAGMA foreign_keys 的是弃用的 libsql-client，不是 libSQL。官方 SDK 上
        # 外键默认开启且真的拦，2026-09-13 实测过——proxy/store.py 的模块注释里有。）
        bad = db.foreign_key_violations()
        if bad:
            print(f"\n指向不存在父行的记录 {len(bad)} 条：")
            for row in bad[:10]:
                print(f"  {row['table']} 的第 {row['rowid']} 行 → 找不到对应的 {row['parent']}")
            if len(bad) > 10:
                print(f"  …… 还有 {len(bad) - 10} 条")
        else:
            print("\n引用完整性：没有指向不存在父行的记录。")

        print("\n加 --yes 才会真删。")
        # 托管库的客户端自己起了一条事件循环线程，不关这个进程就不退出。
        db.close()
        return

    removed = clear(db)
    print(f"已清空 {shown}：")
    for name, number in removed.items():
        print(f"  {name:22} -{number}")
    print("\n数据库清干净了。还剩三样不在这个脚本管辖内：")
    print("  1. Vercel 的运行日志。控制台里按项目删，或者把整个项目删掉。")
    print("  2. 上传的视频本身。videos 表只存 storage_key，文件在对象存储里，要另外清。")
    print("  3. FENCEPOST_OPEN_SIGNUP。清完库它还开着，谁访问站点谁就能再建一批数据。")
    print("     真要收尾，就在 Vercel 上把它删掉——那一刻 hybrid 的前端也跟着空了，")
    print("     这两件事是一件事。")
    db.close()


if __name__ == "__main__":
    main()
