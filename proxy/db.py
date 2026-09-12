"""SQLite 数据层。

表结构不在这里抄第二份，读的是 schema.sql —— 那是 scripts/build_schema.py 从
docs/data-model.md §1 生成的。docs/ 不进仓库，所以生成物必须进，否则别人 clone 下来
建不出库。改表结构走文档，改完重新生成。
"""

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .ports import DEFAULT_LIMITS, PermissionDenied, RateLimited

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
            "e.created_at, EXISTS (SELECT 1 FROM screening_results s "
            "  WHERE s.subject_type = 'entry' AND s.subject_id = e.id "
            "  AND s.disposition = 'labelled') AS being_checked "
            "FROM entries e JOIN users u ON u.id = e.author_id "
            "WHERE e.storyboard_id = ? AND e.deleted_at IS NULL "
            "ORDER BY e.created_at, e.rowid", (storyboard_id,)).fetchall()
        return [dict(row) for row in rows]

    # ---------- 分享链接 ----------

    def add_share_link(self, storyboard_id: str, created_by: str, token_hash: str,
                       level: str, expires_at, max_uses) -> str:
        link_id = new_id()
        self.conn.execute(
            "INSERT INTO share_links (id, storyboard_id, token_hash, created_by, level, "
            "expires_at, max_uses, used_count) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
            (link_id, storyboard_id, token_hash, created_by, level, expires_at, max_uses))
        self.conn.commit()
        return link_id

    def share_link_by_hash(self, token_hash: str):
        row = self.conn.execute("SELECT * FROM share_links WHERE token_hash = ?",
                                (token_hash,)).fetchone()
        return dict(row) if row else None

    def share_link(self, link_id: str):
        row = self.conn.execute("SELECT * FROM share_links WHERE id = ?", (link_id,)).fetchone()
        return dict(row) if row else None

    def consume_share_link(self, link_id: str) -> None:
        self.conn.execute("UPDATE share_links SET used_count = used_count + 1 WHERE id = ?",
                          (link_id,))
        self.conn.commit()

    def revoke_share_link(self, link_id: str) -> None:
        self.conn.execute("UPDATE share_links SET revoked_at = ? WHERE id = ?", (now(), link_id))
        self.conn.commit()

    def storyboard_owner(self, storyboard_id: str):
        row = self.conn.execute("SELECT owner_id FROM storyboards WHERE id = ?",
                                (storyboard_id,)).fetchone()
        return row["owner_id"] if row else None

    def dashboard(self, user_id: str) -> list[dict]:
        """我有权访问的故事版。只出故事版本身的属性，不出别人是谁、发了多少。"""
        rows = self.conn.execute(
            "SELECT s.id, s.title, s.status, s.last_entry_at, g.level, "
            "(SELECT COUNT(*) FROM entries e WHERE e.storyboard_id = s.id "
            " AND e.deleted_at IS NULL) AS entry_count "
            "FROM access_grants g JOIN storyboards s ON s.id = g.storyboard_id "
            "WHERE g.user_id = ? AND g.revoked_at IS NULL "
            "ORDER BY COALESCE(s.last_entry_at, s.created_at) DESC",
            (user_id,)).fetchall()
        return [dict(row) for row in rows]

    # ---------- 复核队列（operations.md §2）----------

    def settle_review(self, days: int = 7) -> int:
        """七天没人处理就自动清除标记，避免无限积压（operations §2.2）。

        和归档一样是惰性的：读队列或投票时顺手结算，不设定时任务。
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
        done = self.conn.execute(
            "UPDATE screening_results SET disposition = 'kept', disposed_at = ? "
            "WHERE verdict = 'review' AND disposition IS NULL AND created_at < ?",
            (now(), cutoff)).rowcount
        self.conn.commit()
        return done

    def review_queue(self, storyboard_id: str, viewer_id: str) -> list[dict]:
        """该故事版待核实的 entry，**不含查看者自己写的**。

        作者对自己被标记这件事无感（operations §2.3），所以队列里看不到自己的条目。
        返回票数但绝不返回投票人是谁。
        """
        rows = self.conn.execute(
            "SELECT s.subject_id AS entry_id, s.field, s.codes, s.created_at, "
            "e.species, e.fun_fact, e.story, "
            "(SELECT COUNT(*) FROM review_votes v WHERE v.entry_id = e.id "
            " AND v.vote = 'worth_checking') AS worth_checking, "
            "(SELECT COUNT(*) FROM review_votes v WHERE v.entry_id = e.id "
            " AND v.vote = 'looks_right') AS looks_right "
            "FROM screening_results s JOIN entries e ON e.id = s.subject_id "
            "WHERE s.subject_type = 'entry' AND s.verdict = 'review' AND s.disposition IS NULL "
            "AND e.storyboard_id = ? AND e.author_id != ? AND e.deleted_at IS NULL "
            "ORDER BY s.created_at", (storyboard_id, viewer_id)).fetchall()

        # 一条 entry 的两个字段可能各被标记一次，队列里只该出现一次，把字段和代码并起来
        items: dict[str, dict] = {}
        for row in rows:
            item = items.setdefault(row["entry_id"], {
                "entry_id": row["entry_id"], "species": row["species"],
                "fun_fact": row["fun_fact"], "story": row["story"],
                "created_at": row["created_at"], "fields": [], "codes": [],
                "worth_checking": row["worth_checking"], "looks_right": row["looks_right"]})
            item["fields"].append(row["field"])
            item["codes"] = sorted(set(item["codes"]) | set(json.loads(row["codes"] or "[]")))
        return list(items.values())

    def cast_vote(self, entry_id: str, voter_id: str, vote: str) -> dict:
        """一人一票，可以改。投完按阈值结算：两票定音（operations §2.2）。"""
        self.conn.execute(
            "INSERT INTO review_votes (id, entry_id, voter_id, vote, created_at) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT (entry_id, voter_id) DO UPDATE SET "
            "vote = excluded.vote, created_at = excluded.created_at",
            (new_id(), entry_id, voter_id, vote, now()))
        tally = {name: self.conn.execute(
            "SELECT COUNT(*) AS c FROM review_votes WHERE entry_id = ? AND vote = ?",
            (entry_id, name)).fetchone()["c"] for name in ("worth_checking", "looks_right")}
        if tally["worth_checking"] >= 2:
            self.dispose(entry_id, "labelled")
        elif tally["looks_right"] >= 2:
            self.dispose(entry_id, "kept")
        self.conn.commit()
        return tally

    def dispose(self, entry_id: str, action: str) -> None:
        """处置：保留、打公开标签、或移除。移除是软删，不是抹掉。"""
        self.conn.execute(
            "UPDATE screening_results SET disposition = ?, disposed_at = ? "
            "WHERE subject_type = 'entry' AND subject_id = ? AND disposition IS NULL",
            (action, now(), entry_id))
        if action == "removed":
            self.conn.execute("UPDATE entries SET deleted_at = ? WHERE id = ?", (now(), entry_id))
        self.conn.commit()

    def entry_author(self, entry_id: str):
        row = self.conn.execute("SELECT author_id FROM entries WHERE id = ?",
                                (entry_id,)).fetchone()
        return row["author_id"] if row else None

    # ---------- 论坛 ----------

    def add_thread(self, storyboard_id: str, author_id: str, title: str, body: str) -> tuple:
        """开一个讨论串，连同第一条贴文。没有贴文的串没有意义。"""
        thread_id, post_id, stamp = new_id(), new_id(), now()
        self.conn.execute(
            "INSERT INTO forum_threads (id, storyboard_id, author_id, title, created_at) "
            "VALUES (?, ?, ?, ?, ?)", (thread_id, storyboard_id, author_id, title, stamp))
        self.conn.execute(
            "INSERT INTO forum_posts (id, thread_id, author_id, body, created_at) "
            "VALUES (?, ?, ?, ?, ?)", (post_id, thread_id, author_id, body, stamp))
        self.conn.commit()
        return thread_id, post_id

    def add_post(self, thread_id: str, author_id: str, body: str) -> str:
        post_id = new_id()
        self.conn.execute(
            "INSERT INTO forum_posts (id, thread_id, author_id, body, created_at) "
            "VALUES (?, ?, ?, ?, ?)", (post_id, thread_id, author_id, body, now()))
        self.conn.commit()
        return post_id

    def thread_storyboard(self, thread_id: str):
        row = self.conn.execute(
            "SELECT storyboard_id FROM forum_threads WHERE id = ? AND deleted_at IS NULL",
            (thread_id,)).fetchone()
        return row["storyboard_id"] if row else None

    def threads(self, storyboard_id: str) -> list[dict]:
        rows = self.conn.execute(
            "SELECT t.id, t.title, u.handle, t.created_at, "
            "(SELECT COUNT(*) FROM forum_posts p WHERE p.thread_id = t.id "
            " AND p.deleted_at IS NULL) AS post_count "
            "FROM forum_threads t JOIN users u ON u.id = t.author_id "
            "WHERE t.storyboard_id = ? AND t.deleted_at IS NULL "
            "ORDER BY t.created_at DESC, t.rowid DESC", (storyboard_id,)).fetchall()
        return [dict(row) for row in rows]

    def posts(self, thread_id: str) -> list[dict]:
        rows = self.conn.execute(
            "SELECT p.id, u.handle, p.body, p.created_at FROM forum_posts p "
            "JOIN users u ON u.id = p.author_id "
            "WHERE p.thread_id = ? AND p.deleted_at IS NULL "
            "ORDER BY p.created_at, p.rowid", (thread_id,)).fetchall()
        return [dict(row) for row in rows]

    # ---------- 留存与删除（data-model.md §4）----------

    def delete_account(self, user_id: str) -> dict:
        """清掉这个人的全部内容，users 行留成匿名墓碑。

        不真删 users 行的原因：storyboards.owner_id、access_grants.granted_by、
        share_links.created_by 都外键指向它，删了别人还在用的故事版会跟着塌。
        operations §1 要的是内容和聊天记录清干净，不是这一行消失。
        """
        mine = [row["id"] for row in self.conn.execute(
            "SELECT id FROM entries WHERE author_id = ?", (user_id,)).fetchall()]
        removed = {}
        if mine:
            marks = ",".join("?" * len(mine))
            removed["screening_of_entries"] = self.conn.execute(
                f"DELETE FROM screening_results WHERE subject_id IN ({marks})", mine).rowcount
        for name, sql, args in (
            ("screening_results", "DELETE FROM screening_results WHERE author_id = ?", (user_id,)),
            ("review_votes", "DELETE FROM review_votes WHERE voter_id = ?", (user_id,)),
            ("chat_messages", "DELETE FROM chat_messages WHERE user_id = ?", (user_id,)),
            ("entries", "DELETE FROM entries WHERE author_id = ?", (user_id,)),
            ("videos", "DELETE FROM videos WHERE owner_id = ?", (user_id,)),
            ("access_grants", "DELETE FROM access_grants WHERE user_id = ?", (user_id,)),
            ("rate_limits", "DELETE FROM rate_limits WHERE user_id = ?", (user_id,)),
            ("forum_posts", "DELETE FROM forum_posts WHERE author_id = ?", (user_id,)),
            ("forum_threads", "DELETE FROM forum_threads WHERE author_id = ? AND id NOT IN "
                              "(SELECT thread_id FROM forum_posts)", (user_id,)),
        ):
            removed[name] = self.conn.execute(sql, args).rowcount
        # 他签发的链接不能继续放人进来，但保留行本身，外键还指着他
        removed["share_links_revoked"] = self.conn.execute(
            "UPDATE share_links SET revoked_at = ? WHERE created_by = ? AND revoked_at IS NULL",
            (now(), user_id)).rowcount
        self.conn.execute("UPDATE users SET handle = ? WHERE id = ?",
                          (f"deleted-{new_id()[:6]}", user_id))
        self.conn.commit()
        return removed

    def purge_screening(self, days: int = 30) -> int:
        """处理完 30 天后删（operations §1）。

        有处置时间的按处置时间算，没处置过的按创建时间算。还挂在队列上没处置的
        （verdict='review' 且 disposition 为空）不动——它们最多七天就会被 settle_review
        自动清掉，届时才开始计时。
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
        gone = self.conn.execute(
            "DELETE FROM screening_results WHERE "
            "(disposed_at IS NOT NULL AND disposed_at < ?) OR "
            "(disposition IS NULL AND verdict != 'review' AND created_at < ?)",
            (cutoff, cutoff)).rowcount
        self.conn.commit()
        return gone

    # ---------- 归档 ----------

    def settle_stale(self, days: int = 30) -> int:
        """把 30 天没有新 entry 的活跃故事版翻成只读，并清掉它们的聊天记录。

        没有定时任务：谁碰到就谁结算。user-flow §9 说的是「自动转只读」，不是「有个 cron」。
        归档时清聊天记录是 data-model.md §4 的要求。
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
        stale = [row["id"] for row in self.conn.execute(
            "SELECT id FROM storyboards WHERE status = 'active' "
            "AND COALESCE(last_entry_at, created_at) < ?", (cutoff,)).fetchall()]
        if not stale:
            return 0
        marks = ",".join("?" * len(stale))
        self.conn.execute(f"DELETE FROM chat_messages WHERE storyboard_id IN ({marks})", stale)
        self.conn.execute(f"UPDATE storyboards SET status = 'readonly' WHERE id IN ({marks})", stale)
        self.conn.commit()
        return len(stale)

    def close_storyboard(self, storyboard_id: str, note: str = None) -> None:
        """owner 主动完结，附一句结语。归档不等于删除：故事版还在，QR 还能扫。"""
        self.conn.execute(
            "UPDATE storyboards SET status = 'archived', closed_note = ? WHERE id = ?",
            (note, storyboard_id))
        self.conn.execute("DELETE FROM chat_messages WHERE storyboard_id = ?", (storyboard_id,))
        self.conn.commit()

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


class SqliteRateLimiter:
    """operations.md §3 的三条上限，落在 rate_limits 表上。

    内存那版每个实例各数各的，serverless 上等于没限。这版多实例共享同一张表。
    过期的行在下一次计数时顺手清掉，不另设定时任务。
    """

    def __init__(self, db: Database, limits: dict = None):
        self.db = db
        self.limits = limits or DEFAULT_LIMITS

    def check_and_count(self, user_id: str, scope: str) -> None:
        cap, window = self.limits[scope]
        cutoff = (datetime.now(timezone.utc)
                  - timedelta(seconds=window)).isoformat(timespec="seconds")
        self.db.conn.execute(
            "DELETE FROM rate_limits WHERE user_id = ? AND scope = ? AND used_at < ?",
            (user_id, scope, cutoff))
        used = self.db.conn.execute(
            "SELECT COUNT(*) AS c FROM rate_limits WHERE user_id = ? AND scope = ?",
            (user_id, scope)).fetchone()["c"]
        if used >= cap:
            self.db.conn.commit()
            raise RateLimited(scope)
        self.db.conn.execute(
            "INSERT INTO rate_limits (id, user_id, scope, used_at) VALUES (?, ?, ?, ?)",
            (new_id(), user_id, scope, now()))
        self.db.conn.commit()


class SqliteScreeningLog:
    """screening_results。subject_type 决定 subject_id 指哪张表，没有外键——
    被 reject 的提交根本没有行可指，见 data-model.md §6。"""

    def __init__(self, db: Database):
        self.db = db

    def record(self, row: dict) -> None:
        self.db.conn.execute(
            "INSERT INTO screening_results (id, subject_type, subject_id, author_id, field, "
            "verdict, codes, note, original_text, model, prompt_version, fail_open, "
            "downgraded_non_english, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (new_id(), row["subject_type"], row.get("subject_id"), row.get("author_id"),
             row["field"], row["verdict"], json.dumps(row.get("codes") or []), row.get("note"),
             row.get("original_text"), row.get("model"), row.get("prompt_version"),
             int(bool(row.get("fail_open"))), int(bool(row.get("downgraded_non_english"))),
             now()))
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
