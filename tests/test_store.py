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


class FakeTxn:
    def __init__(self, client):
        self.client = client
        self.committed = False
        self.rolled_back = False

    def execute(self, sql, params=None):
        return self.client.execute(sql, params, _from_txn=True)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


class FakeClient:
    """libsql_client 的最小替身：记下收到的语句、走没走事务，按预设回结果。"""

    def __init__(self, *results):
        self.results = list(results)
        self.statements = []       # (sql, params, 是否在事务里)
        self.transactions = []

    def execute(self, sql, params=None, _from_txn=False):
        self.statements.append((sql, params, _from_txn))
        return self.results.pop(0) if self.results else FakeResult([], [])

    def transaction(self):
        txn = FakeTxn(self)
        self.transactions.append(txn)
        return txn

    def close(self):
        pass


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

    def test_a_read_alone_never_opens_a_transaction(self):
        # 读也开事务的话，一个只读请求会把事务一直挂着不关。
        client = FakeClient(FakeResult(["n"], []))
        conn = _LibsqlConn(client)
        conn.execute("SELECT n FROM t")
        self.assertEqual([], client.transactions)
        self.assertFalse(client.statements[0][2])

    def test_the_first_write_opens_one_and_later_reads_join_it(self):
        client = FakeClient(FakeResult([], []), FakeResult(["n"], [(1,)]))
        conn = _LibsqlConn(client)
        conn.execute("INSERT INTO t VALUES (?)", (1,))
        conn.execute("SELECT n FROM t")          # 必须看得到上面那条还没提交的写
        self.assertEqual(1, len(client.transactions))
        self.assertTrue(all(s[2] for s in client.statements))

    def test_two_writes_share_the_one_transaction(self):
        client = FakeClient(FakeResult([], []), FakeResult([], []))
        conn = _LibsqlConn(client)
        conn.execute("INSERT INTO a VALUES (1)")
        conn.execute("INSERT INTO b VALUES (2)")
        self.assertEqual(1, len(client.transactions))   # 不是两个
        conn.commit()
        self.assertTrue(client.transactions[0].committed)

    def test_commit_without_a_write_does_nothing(self):
        client = FakeClient()
        _LibsqlConn(client).commit()
        self.assertEqual([], client.transactions)

    def test_closing_throws_away_an_uncommitted_transaction(self):
        client = FakeClient(FakeResult([], []))
        conn = _LibsqlConn(client)
        conn.execute("INSERT INTO t VALUES (1)")
        conn.close()
        self.assertTrue(client.transactions[0].rolled_back)
        self.assertFalse(client.transactions[0].committed)

    def test_the_schema_is_fed_one_statement_at_a_time(self):
        # libsql 一次只吃一条，而 schema.sql 是一整个文件。
        client = FakeClient()
        _LibsqlConn(client).executescript(
            "CREATE TABLE a (id TEXT);\n\nCREATE TABLE b (id TEXT);\n")
        self.assertEqual(2, len(client.statements))
        self.assertTrue(client.statements[0][0].startswith("CREATE TABLE a"))
        self.assertTrue(client.statements[1][0].startswith("CREATE TABLE b"))

    def test_the_schema_goes_through_the_same_routing(self):
        # executescript 不该绕过事务——建表也是写。
        client = FakeClient()
        _LibsqlConn(client).executescript("CREATE TABLE a (id TEXT);")
        self.assertEqual(1, len(client.transactions))


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

    def test_transaction_semantics_match_sqlite3(self):
        """四条对照全部实测过 sqlite3 的真实行为，不是照记忆写的。

        最后一条是这次改动的全部理由：同一个事务里后一条失败，前一条也不该落地。
        """
        import libsql_client
        from proxy.store import _LibsqlConn
        url = "file:" + str(self.path).replace("\\", "/")
        other = _LibsqlConn(libsql_client.create_client_sync(url))
        try:
            mine = self.db.conn
            mine.execute("INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)",
                         ("u1", "mel_k", "2026-09-13T11:00:00+00:00"))

            count = "SELECT COUNT(*) AS c FROM users"
            self.assertEqual(0, other.execute(count).fetchone()["c"],
                             "没提交的写不该被别的连接看到")
            self.assertEqual(1, mine.execute(count).fetchone()["c"],
                             "事务内要读得到自己的写")
            mine.commit()
            self.assertEqual(1, other.execute(count).fetchone()["c"],
                             "提交之后才发布")

            # 两条写，后一条撞 users.handle 的 UNIQUE。整个事务都不该落地。
            # 用 UNIQUE 而不是外键：外键在这个客户端上根本没开着，见下一条测试。
            mine.execute("INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)",
                         ("u2", "dan_h", "2026-09-13T11:01:00+00:00"))
            with self.assertRaises(Exception):
                mine.execute("INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)",
                             ("u3", "mel_k", "2026-09-13T11:02:00+00:00"))   # handle 重了
            mine.rollback()
            self.assertEqual(1, mine.execute(count).fetchone()["c"],
                             "同事务里一条失败，前一条也不落地——这就是这次改动的理由")
        finally:
            other.close()

    def test_foreign_keys_are_NOT_enforced_on_libsql(self):
        """记录一个实测事实，不是期望。

        SqliteStore 靠 `PRAGMA foreign_keys = ON` 打开外键，那行注释写着
        「不开这一行，schema 里那些 REFERENCES 全是装饰」。这个客户端上那行发不进去：
        独立发、事务里发、batch 里发，读回来都是 0。

        后果是 schema.sql 里每一条 REFERENCES 在 libSQL 上都不生效，而且不报错。
        比如 2026-09-13 那次部署失败——本机签的令牌指向一个不存在的用户，建故事版时
        撞上外键——在这里会静悄悄地成功，留下一个属主不存在的故事版。

        这条测试是为了让这个事实有人看见。它变绿的那天（客户端支持了，或者换了后端），
        说明可以把补偿逻辑拿掉。
        """
        conn = self.db.conn
        self.assertEqual(0, conn.execute("PRAGMA foreign_keys").fetchone()["foreign_keys"],
                         "如果这里变成 1，说明客户端支持了，这条测试该重写")
        conn.execute("INSERT INTO storyboards (id, owner_id, status, created_at) "
                     "VALUES (?, ?, ?, ?)",
                     ("sb_orphan", "nobody-at-all", "active", "2026-09-13T11:00:00+00:00"))
        conn.commit()
        row = conn.execute("SELECT owner_id FROM storyboards WHERE id = 'sb_orphan'").fetchone()
        self.assertEqual("nobody-at-all", row["owner_id"])   # 属主不存在，照样躺在库里

        # 强制这一层丢了，可见性补回来：foreign_key_check 是检测命令，两个后端都能用。
        bad = self.db.foreign_key_violations()
        self.assertEqual(1, len(bad), "查得出来才算有救")
        self.assertEqual("storyboards", bad[0]["table"])
        self.assertEqual("users", bad[0]["parent"])

    def test_a_clean_database_reports_no_violations(self):
        owner = self.db.ensure_user("mel_k")
        self.db.add_entry(self.db.add_storyboard(owner, "ok"), owner, "ringtail", None, "fine")
        self.assertEqual([], self.db.foreign_key_violations())

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
