"""连接层。托管库这台机器连不上，所以用一个假 client 测翻译本身——

会写错的就那几处：列名和值对不对得上、没有行的时候 fetchone 回不回 None、
schema.sql 拆语句拆得对不对。这些错了，换库当天才发现就太晚了。
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from proxy.db import Database                                              # noqa: E402
from proxy.store import (LibsqlStore, SqliteStore, open_store,             # noqa: E402
                         _LibsqlConn)


class FakeResult:
    def __init__(self, columns, rows):
        self.columns = columns
        self.rows = rows


class FakeClient:
    """libsql_client 的最小替身：记下收到的语句，按预设回结果。"""

    def __init__(self, *results):
        self.results = list(results)
        self.statements = []

    def execute(self, sql, params=None):
        self.statements.append((sql, params))
        return self.results.pop(0) if self.results else FakeResult([], [])


class PickingABackend(unittest.TestCase):
    def test_a_plain_path_is_local(self):
        self.assertIsInstance(open_store(":memory:"), SqliteStore)
        self.assertIsInstance(open_store("fencepost.db"), SqliteStore)
        self.assertIs(open_store(":memory:").remote, False)

    def test_a_libsql_url_is_remote(self):
        for url in ("libsql://demo.turso.io", "https://demo.turso.io"):
            self.assertIsInstance(open_store(url), LibsqlStore, url)
        self.assertIs(open_store("libsql://demo.turso.io").remote, True)

    def test_the_token_never_lives_in_the_url(self):
        # 令牌只从环境变量取。塞进 URL 的话它会跟着日志和报错到处跑。
        store = LibsqlStore("libsql://demo.turso.io")
        self.assertNotIn("token", store.path)


class TranslatingResults(unittest.TestCase):
    def test_a_row_reads_by_column_name(self):
        conn = _LibsqlConn(FakeClient(FakeResult(["id", "handle"], [("u1", "mel_k")])))
        row = conn.execute("SELECT id, handle FROM users").fetchone()
        self.assertEqual("mel_k", row["handle"])
        self.assertEqual({"id": "u1", "handle": "mel_k"}, dict(row))

    def test_no_rows_gives_none_not_an_empty_list(self):
        # db.py 到处是 `row["x"] if row else None`。这里回 [] 的话每一处都炸。
        conn = _LibsqlConn(FakeClient(FakeResult(["id"], [])))
        self.assertIsNone(
            conn.execute("SELECT id FROM users WHERE id = ?", ("nope",)).fetchone())

    def test_fetchall_keeps_the_order_it_was_given(self):
        conn = _LibsqlConn(FakeClient(FakeResult(["n"], [(1,), (2,), (3,)])))
        self.assertEqual([{"n": 1}, {"n": 2}, {"n": 3}],
                         conn.execute("SELECT n FROM t ORDER BY n").fetchall())

    def test_params_go_through_as_a_list(self):
        client = FakeClient(FakeResult([], []))
        _LibsqlConn(client).execute("SELECT 1 WHERE a = ? AND b = ?", ("x", "y"))
        self.assertEqual(["x", "y"], client.statements[0][1])

    def test_the_schema_is_fed_one_statement_at_a_time(self):
        # libsql 一次只吃一条，而 schema.sql 是一整个文件。
        client = FakeClient()
        _LibsqlConn(client).executescript(
            "CREATE TABLE a (id TEXT);\n\nCREATE TABLE b (id TEXT);\n")
        self.assertEqual(2, len(client.statements))
        self.assertTrue(client.statements[0][0].startswith("CREATE TABLE a"))
        self.assertTrue(client.statements[1][0].startswith("CREATE TABLE b"))

    def test_commit_is_a_no_op_and_says_so(self):
        # 每条语句自己提交。这不是遗漏，是这条链路的事实，写在 LibsqlStore 的文档里。
        conn = _LibsqlConn(FakeClient())
        self.assertIsNone(conn.commit())


class TheRefactorDidNotChangeTheLocalPath(unittest.TestCase):
    def test_a_memory_database_still_shares_one_connection(self):
        db = Database()
        self.assertIs(db.store.conn, db.store.conn)

    def test_the_schema_still_gets_applied_on_first_open(self):
        tables = Database().tables()
        self.assertIn("users", tables)
        self.assertIn("access_grants", tables)


try:
    import libsql_client
except ImportError:                                    # pragma: no cover
    libsql_client = None


@unittest.skipIf(libsql_client is None, "没装 libsql-client")
class TheRealClientRunsTheRealDataLayer(unittest.TestCase):
    """不是替身。用 libSQL 自己的 file: 地址，把真的 SQL 跑在真的客户端上。

    托管库和这里的区别只剩「走 HTTP」，SQL 引擎是同一个——所以连表、EXISTS 子查询、
    ON CONFLICT、ORDER BY rowid 在这里成立，在 Turso 上也成立。
    """

    def setUp(self):
        import tempfile
        self.path = Path(tempfile.gettempdir()) / f"fencepost_store_{id(self)}.db"
        self._clean()
        self.db = Database("file:" + str(self.path).replace("\\", "/"))

    def tearDown(self):
        self.db.close()   # 不关就退不出去
        self._clean()

    def _clean(self):
        for suffix in ("", "-shm", "-wal"):
            Path(str(self.path) + suffix).unlink(missing_ok=True)

    def test_the_backend_really_is_the_remote_one(self):
        self.assertIsInstance(self.db.store, LibsqlStore)

    def test_the_whole_schema_applies_through_one_statement_at_a_time(self):
        tables = self.db.tables()
        for name in ("users", "storyboards", "entries", "access_grants",
                     "screening_results", "review_votes", "forum_threads", "rate_limits"):
            self.assertIn(name, tables)

    def test_a_storyboard_with_an_entry_reads_back(self):
        owner = self.db.ensure_user("mel_k")
        self.assertEqual(owner, self.db.ensure_user("mel_k"))     # 幂等，不是每次新建
        board = self.db.add_storyboard(owner, "The one in the jacaranda")
        # add_storyboard 顺手给 owner 一条 grant，这一步走的是 ON CONFLICT DO UPDATE
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


if __name__ == "__main__":
    unittest.main()
