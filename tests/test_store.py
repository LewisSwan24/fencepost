"""连接层。

这里的测试有一段历史值得留着：先用的是 `libsql-client`（弃用包，停在 2023 年），
在它上面量出「外键在 libSQL 上不生效」，还把这条当成 libSQL 的性质写进了文档。
那是错的——换上官方的 `libsql` SDK 之后外键默认开启且真的拦。教训是：
在一个不受支持的客户端上量出来的性质，是那个客户端的性质，不是那个数据库的。

需要 Python 3.12（Vercel 的运行时版本）才装得上 libsql；3.14 上没有 wheel，
那几条会跳过，只剩不依赖驱动的部分。
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from proxy.db import Database                                              # noqa: E402
from proxy.store import LibsqlStore, Result, SqliteStore, open_store       # noqa: E402


class FakeCursor:
    """驱动游标的最小替身：description 给列名，fetchall 给元组行。"""

    def __init__(self, columns, rows, rowcount=None):
        self.description = [(c,) for c in columns] if columns else None
        self._rows = rows
        if rowcount is not None:
            self.rowcount = rowcount

    def fetchall(self):
        return self._rows


class PickingABackend(unittest.TestCase):
    def test_a_plain_path_is_local(self):
        self.assertIsInstance(open_store(":memory:"), SqliteStore)
        self.assertIsInstance(open_store("fencepost.db"), SqliteStore)
        self.assertIs(open_store(":memory:").remote, False)

    def test_a_libsql_url_is_remote(self):
        for url in ("libsql://demo.turso.io", "https://demo.turso.io", "file:/tmp/x.db"):
            self.assertIsInstance(open_store(url), LibsqlStore, url)
        self.assertIs(open_store("libsql://demo.turso.io").remote, True)

    def test_the_token_never_lives_in_the_url(self):
        # 令牌只从环境变量取。塞进 URL 的话它会跟着日志和报错到处跑。
        self.assertNotIn("token", LibsqlStore("libsql://demo.turso.io").path)


class TranslatingRows(unittest.TestCase):
    """驱动回的是元组，db.py 要的是能按列名取的东西。翻译错了到处都错。"""

    def test_a_row_reads_by_column_name(self):
        row = Result(FakeCursor(["id", "handle"], [("u1", "mel_k")])).fetchone()
        self.assertEqual("mel_k", row["handle"])
        self.assertEqual({"id": "u1", "handle": "mel_k"}, dict(row))

    def test_no_rows_gives_none_not_an_empty_list(self):
        # db.py 到处是 `row["x"] if row else None`。这里回 [] 的话每一处都炸。
        self.assertIsNone(Result(FakeCursor(["id"], [])).fetchone())

    def test_a_statement_with_no_columns_is_not_a_row(self):
        # INSERT / CREATE 的游标没有 description，别把它当成一行空数据。
        self.assertEqual([], Result(FakeCursor(None, [])).fetchall())

    def test_fetchall_keeps_the_order_it_was_given(self):
        rows = Result(FakeCursor(["n"], [(1,), (2,), (3,)])).fetchall()
        self.assertEqual([{"n": 1}, {"n": 2}, {"n": 3}], rows)


class CountingTheRowsAStatementChanged(unittest.TestCase):
    """db.py 有五处 `execute(...).rowcount`。托管库那条路上它一度根本不存在。"""

    def test_the_driver_count_comes_through(self):
        self.assertEqual(3, Result(FakeCursor(None, [], rowcount=3)).rowcount)

    def test_a_driver_that_does_not_report_one_gives_minus_one(self):
        """没有总比 AttributeError 好：-1 是 DBAPI 表示「不知道」的约定值。"""
        self.assertEqual(-1, Result(FakeCursor(None, [])).rowcount)


class TheRefactorDidNotChangeTheLocalPath(unittest.TestCase):
    def test_a_memory_database_still_shares_one_connection(self):
        db = Database()
        self.assertIs(db.store.conn, db.store.conn)

    def test_the_schema_still_gets_applied_on_first_open(self):
        tables = Database().tables()
        self.assertIn("users", tables)
        self.assertIn("access_grants", tables)


try:
    import libsql
except ImportError:                                    # pragma: no cover
    libsql = None


@unittest.skipIf(libsql is None, "没装 libsql（需要 Python 3.12，Vercel 的运行时版本）")
class TheRealDriverRunsTheRealDataLayer(unittest.TestCase):
    """不是替身。用 libSQL 自己的 file: 地址，把真的 SQL 跑在真的驱动上。

    托管库和这里的区别只剩「走网络」，引擎是同一个——所以连表、EXISTS 子查询、
    ON CONFLICT、ORDER BY rowid、外键，在这里成立，在 Turso 上也成立。
    """

    def setUp(self):
        import tempfile
        self.path = Path(tempfile.gettempdir()) / f"fencepost_store_{id(self)}.db"
        self._clean()
        self.db = Database("file:" + str(self.path).replace("\\", "/"))

    def tearDown(self):
        self.db.close()
        self._clean()

    def _clean(self):
        for suffix in ("", "-shm", "-wal"):
            Path(str(self.path) + suffix).unlink(missing_ok=True)

    def test_the_backend_really_is_the_remote_one(self):
        self.assertIsInstance(self.db.store, LibsqlStore)

    def test_the_whole_schema_applies(self):
        tables = self.db.tables()
        for name in ("users", "storyboards", "entries", "access_grants",
                     "screening_results", "review_votes", "forum_threads", "rate_limits"):
            self.assertIn(name, tables)

    def test_a_storyboard_with_an_entry_reads_back(self):
        owner = self.db.ensure_user("mel_k")
        self.assertEqual(owner, self.db.ensure_user("mel_k"))     # 幂等，不是每次新建
        board = self.db.add_storyboard(owner, "The one in the jacaranda")
        # add_storyboard 顺手给 owner 一条 grant，走的是 ON CONFLICT DO UPDATE
        self.assertEqual("reshare", self.db.grant_level(board, owner))
        self.db.add_entry(board, owner, "ringtail", None, "sat in the jacaranda")
        rows = self.db.timeline(board)                            # 连表 + EXISTS + rowid 排序
        self.assertEqual(1, len(rows))
        self.assertEqual("mel_k", rows[0]["handle"])
        self.assertEqual(0, rows[0]["being_checked"])

    def test_revoking_takes_the_grant_out_of_the_list(self):
        owner = self.db.ensure_user("mel_k")
        guest = self.db.ensure_user("dan_h")
        board = self.db.add_storyboard(owner, "Roof thumper")
        self.db.grant(board, guest, "contribute", owner)
        self.assertEqual({"mel_k", "dan_h"}, {g["handle"] for g in self.db.grants(board)})
        self.db.revoke(board, guest)
        self.assertEqual(["mel_k"], [g["handle"] for g in self.db.grants(board)])
        self.assertIsNone(self.db.grant_level(board, guest))

    def test_foreign_keys_are_enforced(self):
        """一度以为这条在 libSQL 上是不成立的。那是弃用客户端的毛病，不是 libSQL 的。

        官方 SDK 上外键默认就开着，孤儿行插不进去。SqliteStore 那边要显式发 pragma
        才有同样的效果，两边最终行为一致。
        """
        with self.assertRaises(Exception) as caught:
            self.db.conn.execute(
                "INSERT INTO storyboards (id, owner_id, status, created_at) VALUES (?, ?, ?, ?)",
                ("sb_orphan", "nobody-at-all", "active", "2026-09-13T11:00:00+00:00"))
        self.assertIn("FOREIGN KEY", str(caught.exception).upper())
        self.db.conn.rollback()
        self.assertEqual([], self.db.foreign_key_violations())

    def test_a_failed_statement_takes_the_earlier_write_with_it(self):
        """同一个事务里后一条失败，前一条也不该落地。多写序列的原子性就靠这个。"""
        self.db.ensure_user("mel_k")
        count = "SELECT COUNT(*) AS c FROM users"
        before = self.db.conn.execute(count).fetchone()["c"]
        self.db.conn.execute("INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)",
                             ("u2", "dan_h", "2026-09-13T11:01:00+00:00"))
        with self.assertRaises(Exception):
            self.db.conn.execute("INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)",
                                 ("u3", "mel_k", "2026-09-13T11:02:00+00:00"))   # handle 重了
        self.db.conn.rollback()
        self.assertEqual(before, self.db.conn.execute(count).fetchone()["c"])

    def test_the_lazy_settlers_run_on_the_real_driver(self):
        """这一条是这个文件存在的理由。

        `settle_review()` 和 `purge_screening()` 都靠 `execute(...).rowcount` 返回
        「清掉了几条」。本地 sqlite3 自带这个属性，托管库那层包装原先没有，于是这两个
        方法在 Turso 上一律 AttributeError → 500。整套测试当时全绿，因为它们只在本地
        后端上跑过。2026-09-14 线上发一条 entry 直接 500 才发现。
        """
        self.assertEqual(0, self.db.settle_review())
        self.assertEqual(0, self.db.purge_screening())

    def test_a_clean_database_reports_no_violations(self):
        owner = self.db.ensure_user("mel_k")
        self.db.add_entry(self.db.add_storyboard(owner, "ok"), owner, "ringtail", None, "fine")
        self.assertEqual([], self.db.foreign_key_violations())


if __name__ == "__main__":
    unittest.main()
