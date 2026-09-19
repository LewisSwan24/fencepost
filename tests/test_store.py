"""The connection layer.

There is a piece of history here worth keeping: this started on `libsql-client` (the
deprecated package, frozen in 2023), measured "foreign keys do not work on libSQL"
against it, and wrote that up as a property of libSQL. That was wrong — with the official
`libsql` SDK they are on by default and really do bite. The lesson is that a property
measured on an unsupported client is a property of that client, not of the database.

Installing libsql needs Python 3.12 (the Vercel runtime version); there is no wheel for
3.14, so those cases skip and only the driver-free parts run.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from proxy.app import TIMELINE_PAGE                                        # noqa: E402
from proxy.db import Database                                              # noqa: E402
from proxy.store import (LibsqlStore, Result, SqliteStore, _LibsqlConn,     # noqa: E402
                         open_store)


class FakeCursor:
    """Minimal stand-in for a driver cursor: description gives names, fetchall gives tuples."""

    def __init__(self, columns, rows, rowcount=None):
        self.description = [(c,) for c in columns] if columns else None
        self._rows = rows
        if rowcount is not None:
            self.rowcount = rowcount

    def fetchall(self):
        return self._rows


class RecordingDriver:
    """A driver connection that writes down what happened to it, in order."""

    def __init__(self):
        self.log = []

    def execute(self, sql, params=()):
        self.log.append("execute " + sql)
        return _Released(self.log)

    def close(self):
        self.log.append("close")


class _Released:
    """A cursor that notes the moment the last reference to it goes."""

    def __init__(self, log):
        self._log = log

    def __del__(self):
        self._log.append("cursor released")


class ClosingALocalConnectionClosesItOnce(unittest.TestCase):
    """libsql 0.9 closes a local connection's sqlite3 handle twice when the connection is the
    last thing holding it (tursodatabase/libsql#2251). The second close reads freed memory,
    and on Windows that is an access violation now and then: test_teardown.py died in about
    one run in ten, always inside close(). When a statement is the last owner instead, the
    handle is closed exactly once, as that statement goes. So a local close holds one open
    across the driver's close() and lets it go after.

    These pin the order, because the crash itself cannot be summoned on demand.
    """

    def test_a_local_close_lets_a_statement_go_last(self):
        driver = RecordingDriver()
        _LibsqlConn(driver, local_file=True).close()
        self.assertEqual(["execute SELECT 1", "close", "cursor released"], driver.log)

    def test_a_remote_close_is_only_a_close(self):
        """The hosted database has no such double close, and a statement there is a round trip."""
        driver = RecordingDriver()
        _LibsqlConn(driver).close()
        self.assertEqual(["close"], driver.log)

    def test_only_a_file_address_counts_as_local(self):
        self.assertTrue(LibsqlStore("file:/tmp/x.db").local_file)
        for url in ("libsql://demo.turso.io", "https://demo.turso.io", "http://127.0.0.1:8080"):
            self.assertFalse(LibsqlStore(url).local_file, url)


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
        # The token comes only from the environment. In the URL it would travel with every
        # log line and every error message.
        self.assertNotIn("token", LibsqlStore("libsql://demo.turso.io").path)


class TranslatingRows(unittest.TestCase):
    """The driver returns tuples and db.py wants column names. A wrong translation
    here breaks everything downstream.
    """

    def test_a_row_reads_by_column_name(self):
        row = Result(FakeCursor(["id", "handle"], [("u1", "mel_k")])).fetchone()
        self.assertEqual("mel_k", row["handle"])
        self.assertEqual({"id": "u1", "handle": "mel_k"}, dict(row))

    def test_no_rows_gives_none_not_an_empty_list(self):
        # db.py is full of `row["x"] if row else None`. Returning [] here blows up every
        # one of them.
        self.assertIsNone(Result(FakeCursor(["id"], [])).fetchone())

    def test_a_statement_with_no_columns_is_not_a_row(self):
        # An INSERT or CREATE cursor has no description; do not read it as one empty row.
        self.assertEqual([], Result(FakeCursor(None, [])).fetchall())

    def test_fetchall_keeps_the_order_it_was_given(self):
        rows = Result(FakeCursor(["n"], [(1,), (2,), (3,)])).fetchall()
        self.assertEqual([{"n": 1}, {"n": 2}, {"n": 3}], rows)


class CountingTheRowsAStatementChanged(unittest.TestCase):
    """db.py reads `execute(...).rowcount` in five places. On the hosted path it once
    did not exist at all.
    """

    def test_the_driver_count_comes_through(self):
        self.assertEqual(3, Result(FakeCursor(None, [], rowcount=3)).rowcount)

    def test_a_driver_that_does_not_report_one_gives_minus_one(self):
        """Absent beats AttributeError: -1 is the DBAPI convention for unknown."""
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


@unittest.skipIf(libsql is None, "libsql not installed (needs Python 3.12, the Vercel runtime)")
class TheRealDriverRunsTheRealDataLayer(unittest.TestCase):
    """Not a stand-in. Real SQL on the real driver, through libSQL's own file: address.

    The only difference from the hosted database is the network; the engine is the same —
    so joins, EXISTS subqueries, ON CONFLICT, ORDER BY rowid and foreign keys holding here
    means they hold on Turso.
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

    def _pretend_it_predates_the_accounts_change(self):
        """Put this database back to the shape it had before 2026-09-15: users without
        password_hash, and rate_limits with a CHECK that has never heard of login.

        That is what every deployed database actually looks like. _apply_schema returns
        early once all twelve tables exist, so neither change reached an existing database
        on its own.
        """
        self.db.conn.execute("DROP TABLE users")
        self.db.conn.execute(
            "CREATE TABLE users (id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, "
            "created_at TIMESTAMP NOT NULL)")
        self.db.conn.execute("DROP TABLE rate_limits")
        self.db.conn.execute(
            "CREATE TABLE rate_limits (id TEXT PRIMARY KEY, "
            "user_id TEXT NOT NULL REFERENCES users(id), "
            "scope TEXT NOT NULL CHECK (scope IN ('chat','vision','submission')), "
            "used_at TIMESTAMP NOT NULL)")
        self.db.conn.execute(
            "INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)",
            ("u_old", "mel_k", "2026-09-01T10:00:00+00:00"))
        self.db.conn.commit()

    def test_the_repairs_run_on_the_driver_production_uses(self):
        """ALTER TABLE ADD COLUMN and PRAGMA table_info on the real engine, not sqlite3.

        The sqlite3 tests prove the logic; this proves the two statements it leans on are
        answered the same way by libSQL. Getting that wrong is not a failing test, it is a
        deploy where every INSERT INTO users says "no such column" — and that insert is
        every visitor's first request, so the whole site answers 500.
        """
        self._pretend_it_predates_the_accounts_change()
        before = {row["name"] for row in
                  self.db.conn.execute("PRAGMA table_info(users)").fetchall()}
        self.assertNotIn("password_hash", before)

        self.db._apply_schema()

        after = {row["name"] for row in
                 self.db.conn.execute("PRAGMA table_info(users)").fetchall()}
        self.assertIn("password_hash", after, "the column never reached the database")
        kept = self.db.conn.execute("SELECT handle FROM users WHERE id = 'u_old'").fetchone()
        self.assertEqual("mel_k", kept["handle"], "the repair lost the people already there")
        # The same failure from the far side: the insert works now.
        self.assertTrue(self.db.add_user("ada_l", "scrypt$16384$8$1$c2FsdA==$aGFzaA=="))

    def test_the_widened_check_holds_on_the_real_engine(self):
        """A CHECK cannot be altered, so rate_limits is rebuilt. Worth doing here because
        DROP TABLE and CREATE INDEX both go through the wrapper, and because a rebuild that
        fired on every open would be a rate limiter that never counts to anything.
        """
        self._pretend_it_predates_the_accounts_change()
        self.db._apply_schema()

        user = self.db.add_user("ada_l")
        self.db.conn.execute(
            "INSERT INTO rate_limits (id, user_id, scope, used_at) VALUES (?, ?, ?, ?)",
            ("r_1", user, "login", "2026-09-15T10:00:00+00:00"))
        self.db.conn.commit()
        self.assertEqual("login",
                         self.db.conn.execute("SELECT scope FROM rate_limits")
                         .fetchone()["scope"])

        self.db._apply_schema()
        left = self.db.conn.execute(
            "SELECT COUNT(*) AS c FROM rate_limits").fetchone()["c"]
        self.assertEqual(1, left, "a second open wiped the counters with nothing to repair")

    def test_a_storyboard_with_an_entry_reads_back(self):
        owner = self.db.ensure_user("mel_k")
        self.assertEqual(owner, self.db.ensure_user("mel_k"))     # idempotent, not a new row
        board = self.db.add_storyboard(owner, "The one in the jacaranda")
        # add_storyboard also hands the owner a grant, through ON CONFLICT DO UPDATE
        self.assertEqual("reshare", self.db.grant_level(board, owner))
        self.db.add_entry(board, owner, "ringtail", None, "sat in the jacaranda")
        rows = self.db.timeline(board, TIMELINE_PAGE)   # join + EXISTS + rowid ordering
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
        """I once believed this did not hold on libSQL. That was the deprecated
        client's fault, not libSQL's.

        On the official SDK foreign keys are on by default and an orphan row will not
        insert. SqliteStore has to send the pragma explicitly to get the same effect; the
        end behaviour matches.
        """
        with self.assertRaises(Exception) as caught:
            self.db.conn.execute(
                "INSERT INTO storyboards (id, owner_id, status, created_at) VALUES (?, ?, ?, ?)",
                ("sb_orphan", "nobody-at-all", "active", "2026-09-13T11:00:00+00:00"))
        self.assertIn("FOREIGN KEY", str(caught.exception).upper())
        self.db.conn.rollback()
        self.assertEqual([], self.db.foreign_key_violations())

    def test_a_failed_statement_takes_the_earlier_write_with_it(self):
        """If the second statement in a transaction fails, the first must not land
        either. Atomicity of multi-write sequences rests on this.
        """
        self.db.ensure_user("mel_k")
        count = "SELECT COUNT(*) AS c FROM users"
        before = self.db.conn.execute(count).fetchone()["c"]
        self.db.conn.execute("INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)",
                             ("u2", "dan_h", "2026-09-13T11:01:00+00:00"))
        with self.assertRaises(Exception):
            self.db.conn.execute("INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)",
                                 ("u3", "mel_k", "2026-09-13T11:02:00+00:00"))   # duplicate handle
        self.db.conn.rollback()
        self.assertEqual(before, self.db.conn.execute(count).fetchone()["c"])

    def test_the_lazy_settlers_run_on_the_real_driver(self):
        """This one is the reason this file exists.

        `settle_review()` and `purge_screening()` both rely on `execute(...).rowcount` to
        say how many rows they cleared. Local sqlite3 supplies that attribute; the wrapper
        for the hosted database did not, so on Turso both methods raised AttributeError and
        came back 500. The whole suite was green at the time, because they had only ever
        run against the local backend. It surfaced on 2026-09-14, when posting a live entry
        returned 500.
        """
        self.assertEqual(0, self.db.settle_review())
        self.assertEqual(0, self.db.purge_screening())

    def test_a_clean_database_reports_no_violations(self):
        owner = self.db.ensure_user("mel_k")
        self.db.add_entry(self.db.add_storyboard(owner, "ok"), owner, "ringtail", None, "fine")
        self.assertEqual([], self.db.foreign_key_violations())


if __name__ == "__main__":
    unittest.main()
