"""Database connection layer. There is no SQL in here, not one statement.

It exists for one reason: so the 63 statements in db.py need not change a character when
the database changes. Both backends dress up as sqlite3 — `.execute(sql, params)` returns
something with `.fetchone()` and `.fetchall()`, and a row can be read by column name or
turned into a dict.

Why libSQL and not Postgres: `?` placeholders, `ORDER BY ... rowid`, and the CHECK and
TIMESTAMP forms in schema.sql are all SQLite spellings, and schema.sql is generated from
docs/data-model.md §1. Moving to Postgres would mean rewriting not only those 63
statements but that generator, and the generator is the single source of the schema.

**This uses the official `libsql`, not `libsql-client`.** The latter is deprecated, frozen
at 0.3.1 from 2023, and incompatible with current Turso in three places: the WebSocket
handshake is refused, the HTTP transport has no transactions, and error responses fail to
parse (`KeyError: 'result'`). More seriously it swallows `PRAGMA foreign_keys`, so every
REFERENCES in the schema silently does nothing — I once wrote that up as a property of
libSQL itself, and that was wrong. It is a property of that deprecated client. On the
official SDK foreign keys are on by default and really do bite (measured 2026-09-13).
"""

import os
import sqlite3
import threading


REMOTE_PREFIXES = ("libsql://", "https://", "http://", "file:")


def open_store(path: str):
    """Pick a backend from the address. libsql:// or http(s):// means the hosted
    database; anything else is a local file or :memory:.

    `file:` takes the libSQL path too. Keeping that opening lets the whole data layer run
    against the **real client** with no hosted database — a pass measured against a
    stand-in is not the same thing as a pass measured against the real driver. Ordinary
    paths (`fencepost.db`, `:memory:`) carry no scheme and cannot wander in by accident.
    """
    if path.startswith(REMOTE_PREFIXES):
        return LibsqlStore(path)
    return SqliteStore(path)


class SqliteStore:
    """For local work and tests. Behaves exactly as the code inlined in db.py used to."""

    remote = False

    def __init__(self, path: str):
        self.path = path
        self._local = threading.local()
        # An in-memory database has no file for another thread to reopen, so one connection
        # is shared; a file-backed one gets a connection per thread.
        self._shared = self._connect() if path == ":memory:" else None

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        # SQLite has foreign keys off by default. Without this line every REFERENCES in the
        # schema is decoration.
        conn.execute("PRAGMA foreign_keys = ON")
        if self.path != ":memory:":
            conn.execute("PRAGMA journal_mode = WAL")
        return conn

    @property
    def conn(self) -> sqlite3.Connection:
        """One connection per thread. A sqlite3 connection cannot be used across
        threads and the HTTP server is threaded — caught by the local HTTP check, since the
        unit tests all run on one thread and never see it."""
        if self._shared is not None:
            return self._shared
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = self._local.conn = self._connect()
        return conn

    def close(self) -> None:
        """Close this thread's connection. Other threads close their own."""
        conn = self._shared or getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
        self._shared = None
        self._local.conn = None


class Result:
    """Dress a driver cursor up as a sqlite3 cursor. Rows are always dicts.

    `row["handle"]` and `dict(row)` are the only two forms db.py uses, and a dict satisfies
    both without leaking the driver's own row type upwards. The official SDK returns tuples,
    with the column names in description.
    """

    def __init__(self, cursor):
        columns = [d[0] for d in (cursor.description or [])]
        self._rows = [dict(zip(columns, tuple(row))) for row in cursor.fetchall()] \
            if columns else []
        # db.py reads `execute(...).rowcount` in five places, each counting the rows an
        # UPDATE or DELETE touched. This class had no such attribute, so all five statements
        # raised AttributeError against the hosted database and came back as a 500.
        #
        # Found the hard way on 2026-09-14: wiring purge_screening into the submission path
        # made posting an entry fail live with FUNCTION_INVOCATION_FAILED. The real fault was
        # far older than that change — `settle_review()` has always used rowcount, which
        # means `/api/review` and `/api/review/vote` had been 500ing against the hosted
        # database from the start. Nobody noticed, because the two review screens did not
        # exist yet so no interface ever called them, and verify_deployment.py did not cover
        # that chain either.
        #
        # Local sqlite3 supplies rowcount, so the whole suite stayed green. This is the only
        # place the two backends diverge, and it is exactly why a pass against a stand-in is
        # not a pass against the real database.
        self.rowcount = getattr(cursor, "rowcount", -1)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list:
        return self._rows

    def __iter__(self):
        return iter(self._rows)


class LibsqlStore:
    """Hosted libSQL (Turso). Over the network, no local file, nothing lost on a cold start.

    The semantics match the local backend: the official SDK is plain DBAPI, transactions,
    commit and rollback are real, and foreign keys are on by default. So this layer does one
    thing — turn the cursor's tuple rows into dicts.
    """

    remote = True

    def __init__(self, url: str):
        self.path = url
        self._local = threading.local()
        self._token = os.getenv("TURSO_AUTH_TOKEN") or os.getenv("LIBSQL_AUTH_TOKEN") or ""

    def _connect(self):
        try:
            import libsql
        except ImportError as exc:  # pragma: no cover — only reached without the dependency
            raise RuntimeError(
                "The hosted database needs the official SDK: pip install libsql "
                "(note: libsql-client is a different, deprecated package)"
            ) from exc
        # file: is a local address the tests use; strip the scheme and hand the driver an
        # ordinary path.
        target = self.path[len("file:"):] if self.path.startswith("file:") else self.path
        if self.path.startswith("file:"):
            return _LibsqlConn(libsql.connect(target))
        return _LibsqlConn(libsql.connect(target, auth_token=self._token))

    @property
    def conn(self):
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = self._local.conn = self._connect()
        return conn

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
        self._local.conn = None


class _LibsqlConn:
    """Wrap the SDK connection in the shape db.py wants. Rows only; the driver does the rest."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params=()) -> Result:
        return Result(self._conn.execute(sql, tuple(params)))

    def executescript(self, script: str) -> None:
        self._conn.executescript(script)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()
