"""数据库连接层。SQL 不在这里，一条都没有。

分出来只为一件事：让 db.py 那 63 条语句在换库的时候一个字都不用改。
两个后端都装成 sqlite3 的样子——`.execute(sql, params)` 回一个有 `.fetchone()`
和 `.fetchall()` 的东西，行可以按列名取，也可以 `dict(row)`。

为什么是 libSQL 而不是 Postgres：`?` 占位、`ORDER BY ... rowid`、schema.sql 里那些
CHECK 和 TIMESTAMP，全是 SQLite 的写法，而 schema.sql 是从 docs/data-model.md §1
生成的。换 Postgres 要改的不只是 63 条语句，还有那个生成器——它是 schema 的唯一来源。

**用的是官方的 `libsql`，不是 `libsql-client`。** 后者是弃用包，停在 2023 年的 0.3.1，
对现在的 Turso 有三处不兼容：WebSocket 握手被拒、HTTP 传输不支持事务、错误响应解析不了
（`KeyError: 'result'`）。更要紧的是它收不下 `PRAGMA foreign_keys`，于是 schema 里每一条
REFERENCES 都无声失效——我一度把这条当成 libSQL 的性质写进了文档，那是错的，
它只是那个弃用客户端的性质。官方 SDK 上外键默认开启且真的拦（实测 2026-09-13）。
"""

import os
import sqlite3
import threading


REMOTE_PREFIXES = ("libsql://", "https://", "http://", "file:")


def open_store(path: str):
    """按地址挑后端。libsql:// 或 http(s):// 走托管库，其余当本地文件或 :memory:。

    `file:` 也走 libSQL 这条。留着这条口子，整个数据层就能在没有托管库的情况下跑在
    **真客户端**上——对着替身测出来的「通过」，和对着真库测出来的不是一回事。
    普通路径（`fencepost.db`、`:memory:`）不带 scheme，不会误入。
    """
    if path.startswith(REMOTE_PREFIXES):
        return LibsqlStore(path)
    return SqliteStore(path)


class SqliteStore:
    """本机与测试用的。行为和之前内联在 db.py 里的完全一样。"""

    remote = False

    def __init__(self, path: str):
        self.path = path
        self._local = threading.local()
        # 内存库没有文件可供别的线程重开，只能共享一条连接；文件库每线程各开一条。
        self._shared = self._connect() if path == ":memory:" else None

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        # SQLite 的外键默认是关的。不开这一行，schema 里那些 REFERENCES 全是装饰。
        conn.execute("PRAGMA foreign_keys = ON")
        if self.path != ":memory:":
            conn.execute("PRAGMA journal_mode = WAL")
        return conn

    @property
    def conn(self) -> sqlite3.Connection:
        """每个线程一条连接。sqlite3 的连接不能跨线程使用，而 HTTP 服务器是多线程的——
        这条是本机 HTTP 验证抓出来的，单元测试全在同一个线程里，看不见。"""
        if self._shared is not None:
            return self._shared
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = self._local.conn = self._connect()
        return conn

    def close(self) -> None:
        """关掉本线程这条。别的线程各自的连接由它们自己了断。"""
        conn = self._shared or getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
        self._shared = None
        self._local.conn = None


class Result:
    """把一个游标的结果装成 sqlite3 游标的样子。行一律是 dict——

    `row["handle"]` 和 `dict(row)` 是 db.py 唯一用到的两种取法，dict 两样都满足，
    也不用把驱动自己的行类型泄漏到上层。官方 SDK 的行是元组，列名在 description 里。
    """

    def __init__(self, cursor):
        columns = [d[0] for d in (cursor.description or [])]
        self._rows = [dict(zip(columns, tuple(row))) for row in cursor.fetchall()] \
            if columns else []

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list:
        return self._rows

    def __iter__(self):
        return iter(self._rows)


class LibsqlStore:
    """托管的 libSQL（Turso）。走网络，没有本地文件，冷启动不会丢东西。

    语义和本地后端一致：官方 SDK 就是 DBAPI 那套，事务、commit、rollback 都是真的，
    外键默认开着。所以这一层只做一件事——把游标的元组行翻成 dict。
    """

    remote = True

    def __init__(self, url: str):
        self.path = url
        self._local = threading.local()
        self._token = os.getenv("TURSO_AUTH_TOKEN") or os.getenv("LIBSQL_AUTH_TOKEN") or ""

    def _connect(self):
        try:
            import libsql
        except ImportError as exc:  # pragma: no cover —— 只在没装依赖时走到
            raise RuntimeError(
                "托管库需要官方 SDK：pip install libsql（注意不是 libsql-client，那个已弃用）"
            ) from exc
        # file: 是给测试用的本地地址，去掉 scheme 交给驱动当普通路径。
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
    """把官方 SDK 的连接包成 db.py 期望的那个形状。只翻行，不管事务——驱动自己管。"""

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
