"""SQLite 数据层。

表结构不在这里抄第二份，读的是 schema.sql —— 那是 scripts/build_schema.py 从
docs/data-model.md §1 生成的。docs/ 不进仓库，所以生成物必须进，否则别人 clone 下来
建不出库。改表结构走文档，改完重新生成。
"""

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .ports import PermissionDenied

SCHEMA = Path(__file__).resolve().parent.parent / "schema.sql"
HISTORY_TURNS = 6


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex


def schema_sql() -> str:
    if not SCHEMA.exists():
        raise RuntimeError("缺 schema.sql，先跑 python scripts/build_schema.py")
    return SCHEMA.read_text(encoding="utf-8")


class Database:
    def __init__(self, path: str = ":memory:"):
        self.path = path
        self._local = threading.local()
        # 内存库没有文件可供别的线程重开，只能共享一条连接；文件库每线程各开一条。
        self._shared = self._connect() if path == ":memory:" else None
        if not self.conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'"
        ).fetchone():
            self.conn.executescript(schema_sql())
            self.conn.commit()

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

    def tables(self) -> set:
        rows = self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        return {row["name"] for row in rows}

    # ---------- 写入 ----------

    def add_user(self, handle: str) -> str:
        user_id = new_id()
        self.conn.execute("INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)",
                          (user_id, handle, now()))
        self.conn.commit()
        return user_id

    def ensure_user(self, handle: str) -> str:
        """有就返回，没有就建。demo 阶段没有注册流程，handle 就是身分。"""
        row = self.conn.execute("SELECT id FROM users WHERE handle = ?", (handle,)).fetchone()
        return row["id"] if row else self.add_user(handle)

    def add_storyboard(self, owner_id: str, title: str = None) -> str:
        """建故事版时顺手给 owner 一条 grant。

        §2 的权限门只查 access_grants，不看 storyboards.owner_id。不补这一条，
        owner 会被自己的故事版挡在门外。
        """
        storyboard_id = new_id()
        self.conn.execute(
            "INSERT INTO storyboards (id, owner_id, title, status, created_at) VALUES (?, ?, ?, ?, ?)",
            (storyboard_id, owner_id, title, "active", now()))
        self.grant(storyboard_id, owner_id, "reshare", owner_id)
        return storyboard_id

    def grant(self, storyboard_id: str, user_id: str, level: str, granted_by: str) -> None:
        self.conn.execute(
            "INSERT INTO access_grants (id, storyboard_id, user_id, level, granted_by, granted_at) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT (storyboard_id, user_id) DO UPDATE SET "
            "level = excluded.level, granted_at = excluded.granted_at, revoked_at = NULL",
            (new_id(), storyboard_id, user_id, level, granted_by, now()))
        self.conn.commit()

    def revoke(self, storyboard_id: str, user_id: str) -> None:
        """立即生效：写完就没有任何读路径还认这条 grant。"""
        self.conn.execute(
            "UPDATE access_grants SET revoked_at = ? WHERE storyboard_id = ? AND user_id = ?",
            (now(), storyboard_id, user_id))
        self.conn.commit()

    def add_entry(self, storyboard_id: str, author_id: str, species: str,
                  fun_fact: str = None, story: str = None, video_id: str = None) -> str:
        entry_id = new_id()
        stamp = now()
        self.conn.execute(
            "INSERT INTO entries (id, storyboard_id, author_id, species, fun_fact, story, "
            "video_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (entry_id, storyboard_id, author_id, species, fun_fact, story, video_id, stamp))
        self.conn.execute("UPDATE storyboards SET last_entry_at = ? WHERE id = ?", (stamp, storyboard_id))
        self.conn.commit()
        return entry_id

    def add_video(self, owner_id: str, storage_key: str) -> str:
        """只记 storage_key。EXIF 与 GPS 在客户端就剥掉了，这里连存的字段都没有。"""
        video_id = new_id()
        self.conn.execute(
            "INSERT INTO videos (id, owner_id, storage_key, created_at) VALUES (?, ?, ?, ?)",
            (video_id, owner_id, storage_key, now()))
        self.conn.commit()
        return video_id

    def video_owner(self, video_id: str):
        row = self.conn.execute("SELECT owner_id FROM videos WHERE id = ?", (video_id,)).fetchone()
        return row["owner_id"] if row else None

    def grant_level(self, storyboard_id: str, user_id: str):
        """返回 view / contribute / reshare，没有有效 grant 就是 None。"""
        row = self.conn.execute(
            "SELECT level FROM access_grants "
            "WHERE storyboard_id = ? AND user_id = ? AND revoked_at IS NULL",
            (storyboard_id, user_id)).fetchone()
        return row["level"] if row else None

    def storyboard_status(self, storyboard_id: str):
        row = self.conn.execute("SELECT status FROM storyboards WHERE id = ?",
                                (storyboard_id,)).fetchone()
        return row["status"] if row else None

    def timeline(self, storyboard_id: str) -> list[dict]:
        """故事版时间线：所有贡献者的 entry。

        这跟 SqliteContext.build() 不是一回事，那个只给请求者自己的内容。平台看得见全部，
        助手看不见——两条查询故意分开，合并等于把 Tier 1 作废。作者只出 handle，不出真名。
        """
        rows = self.conn.execute(
            "SELECT e.id, e.author_id, u.handle, e.species, e.fun_fact, e.story, e.video_id, "
            "e.created_at FROM entries e JOIN users u ON u.id = e.author_id "
            "WHERE e.storyboard_id = ? AND e.deleted_at IS NULL "
            "ORDER BY e.created_at, e.rowid", (storyboard_id,)).fetchall()
        return [dict(row) for row in rows]

    def entry(self, entry_id: str):
        row = self.conn.execute(
            "SELECT id, storyboard_id, author_id, species, fun_fact, story, deleted_at "
            "FROM entries WHERE id = ?", (entry_id,)).fetchone()
        return dict(row) if row else None

    def update_entry(self, entry_id: str, fun_fact, story) -> None:
        """没有 updated_at：data-model.md §1 里没这一列，不擅自加。"""
        self.conn.execute("UPDATE entries SET fun_fact = ?, story = ? WHERE id = ?",
                          (fun_fact, story, entry_id))
        self.conn.commit()

    def soft_delete_entry(self, entry_id: str) -> None:
        self.conn.execute("UPDATE entries SET deleted_at = ? WHERE id = ?", (now(), entry_id))
        self.conn.commit()


class SqliteContext:
    """data-model.md §2 的 build_context()：先权限门，再 Tier 1 取自己的 entry。"""

    def __init__(self, db: Database):
        self.db = db

    def build(self, requester_id: str, storyboard_id: str) -> dict:
        grant = self.db.conn.execute(
            "SELECT level FROM access_grants "
            "WHERE storyboard_id = ? AND user_id = ? AND revoked_at IS NULL",
            (storyboard_id, requester_id)).fetchone()
        if not grant:
            raise PermissionDenied
        own = [dict(row) for row in self.db.conn.execute(
            "SELECT species, fun_fact, story FROM entries "
            "WHERE storyboard_id = ? AND author_id = ? AND deleted_at IS NULL "
            "ORDER BY created_at, rowid",
            (storyboard_id, requester_id)).fetchall()]
        return {
            "species_selected": own[-1]["species"] if own else "unknown",
            "storyboard_visible_to_this_user": True,
            "own_entries": own,
        }


class SqliteScreeningLog:
    """screening_results。subject_type 决定 subject_id 指哪张表，没有外键——
    被 reject 的提交根本没有行可指，见 data-model.md §6。"""

    def __init__(self, db: Database):
        self.db = db

    def record(self, row: dict) -> None:
        self.db.conn.execute(
            "INSERT INTO screening_results (id, subject_type, subject_id, field, verdict, codes, "
            "note, original_text, model, prompt_version, fail_open, downgraded_non_english, "
            "created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (new_id(), row["subject_type"], row.get("subject_id"), row["field"], row["verdict"],
             json.dumps(row.get("codes") or []), row.get("note"), row.get("original_text"),
             row.get("model"), row.get("prompt_version"), int(bool(row.get("fail_open"))),
             int(bool(row.get("downgraded_non_english"))), now()))
        self.db.conn.commit()


class SqliteHistory:
    """chat_messages 按 (user, storyboard) 分区，最近 6 条，不摘要。"""

    def __init__(self, db: Database):
        self.db = db

    def recent(self, user_id: str, storyboard_id: str) -> list[dict]:
        # 权限撤销后立刻停读该分区，不靠 TTL 过期（prompts.md §2.6.3 第 2 条）。
        # 上游 build_context 已经拦过一道，这里再拦一道：读路径不该依赖调用顺序。
        active = self.db.conn.execute(
            "SELECT 1 FROM access_grants "
            "WHERE storyboard_id = ? AND user_id = ? AND revoked_at IS NULL",
            (storyboard_id, user_id)).fetchone()
        if not active:
            return []
        rows = self.db.conn.execute(
            "SELECT role, content FROM chat_messages "
            "WHERE user_id = ? AND storyboard_id = ? "
            "ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (user_id, storyboard_id, HISTORY_TURNS)).fetchall()
        return [{"role": row["role"], "content": row["content"]} for row in reversed(rows)]

    def append(self, user_id: str, storyboard_id: str, role: str, content: str,
               prompt_version: str = None, model: str = None) -> None:
        self.db.conn.execute(
            "INSERT INTO chat_messages (id, user_id, storyboard_id, role, content, model, "
            "prompt_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (new_id(), user_id, storyboard_id, role, content, model, prompt_version, now()))
        self.db.conn.commit()

    def drop_partition(self, user_id: str, storyboard_id: str) -> None:
        """故事版归档时一并删除聊天记录（data-model.md §4）。"""
        self.db.conn.execute("DELETE FROM chat_messages WHERE user_id = ? AND storyboard_id = ?",
                             (user_id, storyboard_id))
        self.db.conn.commit()
