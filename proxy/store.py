"""数据库连接层。SQL 不在这里，一条都没有。

分出来只为一件事：让 db.py 那 63 条语句在换库的时候一个字都不用改。
所以两个后端都装成 sqlite3 的样子——`.execute(sql, params)` 回一个有 `.fetchone()`
和 `.fetchall()` 的东西，行可以按列名取，也可以 `dict(row)`。

为什么是 libSQL 而不是 Postgres：`?` 占位、`ORDER BY ... rowid`、schema.sql 里那些
CHECK 和 TIMESTAMP，全是 SQLite 的写法，而 schema.sql 是从 docs/data-model.md §1
生成的。换 Postgres 要改的不只是 63 条语句，还有那个生成器——它是 schema 的唯一来源。
libSQL 就是 SQLite，这些原样成立。
"""

import os
import re
import sqlite3
import threading


REMOTE_PREFIXES = ("libsql://", "https://", "http://", "file:")

# 判断一条语句要不要事务。只看开头那个词就够——db.py 里没有拼接出来的动态 SQL。
WRITE = re.compile(r"^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b", re.I)


def open_store(path: str):
    """按地址挑后端。libsql:// 或 http(s):// 走托管库，其余当本地文件或 :memory:。

    `file:` 也走 libSQL 这条。它是 libSQL 自己的本地地址形式，留着这条口子，
    整个数据层就能在没有 Turso 账号的情况下跑在**真客户端**上——
    对着替身测出来的「通过」，和对着真库测出来的不是一回事。
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
    """把一次查询的结果装成 sqlite3 游标的样子。行一律是 dict——

    `row["handle"]` 和 `dict(row)` 是 db.py 唯一用到的两种取法，dict 两样都满足，
    也不用把 libsql 自己的 Row 类型泄漏到上层。
    """

    def __init__(self, rows: list):
        self._rows = rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list:
        return self._rows

    def __iter__(self):
        return iter(self._rows)


class LibsqlStore:
    """托管的 libSQL（Turso）。走 HTTP，没有本地文件，冷启动不会丢东西。

    语义和本地后端一致，包括事务——见 _LibsqlConn。一开始这里是每条语句自己提交、
    `commit()` 空操作，那样 db.py 里「插一条、再插一条、然后 commit」的地方就不再原子。
    后来发现 ClientSync 除了 batch() 还有 transaction()，给的是真的 commit/rollback，
    于是改成惰性开事务：调用点一个都不用动，那条差别也就不存在了，不需要谁去记住它。
    """

    remote = True

    def __init__(self, url: str):
        self.path = url
        self._local = threading.local()
        self._token = os.getenv("TURSO_AUTH_TOKEN") or os.getenv("LIBSQL_AUTH_TOKEN")

    def _client(self):
        try:
            import libsql_client
        except ImportError as exc:  # pragma: no cover —— 只在没装依赖时走到
            raise RuntimeError("远端库需要 libsql-client：pip install libsql-client") from exc
        return libsql_client.create_client_sync(self.path, auth_token=self._token)

    @property
    def conn(self):
        client = getattr(self._local, "conn", None)
        if client is None:
            client = self._local.conn = _LibsqlConn(self._client())
            # 和本地后端一样，外键要显式打开——SQLite 默认是关的，托管的也是。
            # 漏了这一行，schema.sql 里所有 REFERENCES 在托管库上就全是装饰，
            # 而且不会报错，只会在某天留下一条指向不存在的行的记录。
            # 必须在任何事务开始之前发：PRAGMA 在事务里是不生效的。
            client.execute("PRAGMA foreign_keys = ON")
        return client

    def close(self) -> None:
        """必须关。libsql 的 client 背着一条事件循环线程，不关的话进程退不出去——
        单元测试第一个撞上，多线程的 serve_local 则是每个请求线程漏一条。"""
        client = getattr(self._local, "conn", None)
        if client is not None:
            client.close()
        self._local.conn = None


class _LibsqlConn:
    """把 libsql 的 client 包成 sqlite3 连接的样子，事务语义也一样。

    对齐的是 Python sqlite3 的默认行为，四条（都实测过，不是照记忆写的）：
      第一条写语句开隐式事务，别的连接看不见；
      事务内的读看得到自己还没提交的写；
      commit() 才发布；
      纯 SELECT 不开事务。

    最后一条不是细节：读也开事务的话，一个只读请求会把事务一直挂着不关。
    """

    def __init__(self, client):
        self._client = client
        self._txn = None

    def _target(self, sql: str):
        """写语句要在事务里。事务已经开着的话读也走它，否则读不到自己刚写的东西。"""
        if self._txn is None and WRITE.match(sql):
            self._txn = self._client.transaction()
        return self._txn or self._client

    def execute(self, sql: str, params=()) -> Result:
        result = self._target(sql).execute(sql, list(params))
        columns = list(result.columns or [])
        return Result([dict(zip(columns, tuple(row))) for row in result.rows])

    def executescript(self, script: str) -> None:
        # libsql 一次只吃一条语句，schema.sql 得拆开喂。
        for statement in filter(None, (s.strip() for s in script.split(";"))):
            self.execute(statement)

    def commit(self) -> None:
        if self._txn is not None:
            self._txn.commit()
            self._txn = None

    def rollback(self) -> None:
        if self._txn is not None:
            self._txn.rollback()
            self._txn = None

    def close(self) -> None:
        # 没提交的事务先扔掉再关，不然那条连接会挂在那里等
        self.rollback()
        self._client.close()
