"""Data layer. All the SQL is here; how the connection is made lives in store.py.

The schema is not copied out a second time — it is read from schema.sql, which
scripts/build_schema.py generates from docs/data-model.md §1. docs/ is not in the
repository, so the generated file has to be, or nobody who clones this can build the
database. Change the schema in the document, then regenerate.
"""

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .ports import DEFAULT_LIMITS, PermissionDenied, RateLimited
from .store import open_store

SCHEMA = Path(__file__).resolve().parent.parent / "schema.sql"
HISTORY_TURNS = 6


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex


def schema_sql() -> str:
    if not SCHEMA.exists():
        raise RuntimeError("schema.sql is missing; run python scripts/build_schema.py first")
    return SCHEMA.read_text(encoding="utf-8")


def _schema_table_names() -> list[str]:
    """Which tables schema.sql creates. Read from the generated file, never listed twice."""
    return re.findall(r"CREATE TABLE\s+(\w+)", schema_sql(), re.I)


class Database:
    def __init__(self, path: str = ":memory:"):
        self.path = path
        # How the connection is made, and to what, is store's business. This file is SQL only.
        # A libsql:// or http(s):// address means the hosted database; anything else is a
        # local file or :memory:.
        self.store = open_store(path)
        self._apply_schema()

    def _apply_schema(self) -> None:
        """Create each table, skipping any that already exist.

        This used to be a single check — does the users table exist — deciding whether to
        create everything. That has a hole: if creation failed halfway, users already
        existed, so the next start believed the work was done and the remaining 11 tables
        were never added. It happened for real on 2026-09-13: the deprecated client died on
        the second statement, the database held one table, and the application went on
        insisting all was well.

        One at a time heals itself. The cost is that it only guarantees a table is there,
        not that it is right — a changed column would not show up here. That drift is caught
        by tests/test_data_layer.py comparing against the document.
        """
        # Compare by name, not by count. A count gets padded by sqlite_autoindex_* and by
        # any table somebody else left behind, so a genuinely missing table goes unseen —
        # and that kind of check fails without a sound.
        wanted = set(_schema_table_names())
        existing = {row["name"] for row in self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()}
        if wanted <= existing:
            return
        # Strip line comments before splitting. The split is on ";", so a semicolon inside
        # a "--" comment cuts a CREATE TABLE in half and every table after it fails with
        # "incomplete input". The comments this schema used to carry were Chinese and ended
        # their clauses with a full-width "；", so the naive split survived by luck; the
        # first ordinary ";" in an English comment took out every test at setUp. Nothing in
        # the generated schema has "--" inside a string literal, so this is safe.
        body = " ".join(line.split("--")[0] for line in schema_sql().splitlines())
        for statement in filter(None, (s.strip() for s in body.split(";"))):
            try:
                self.conn.execute(statement)
            except Exception as exc:
                if "already exists" not in str(exc).lower():
                    raise
        self.conn.commit()

    @property
    def conn(self):
        return self.store.conn

    def close(self) -> None:
        self.store.close()

    def foreign_key_violations(self) -> list[dict]:
        """Rows pointing at a parent that does not exist. Each is {table, rowid, parent, fkid}.

        Both backends enforce foreign keys (locally through `PRAGMA foreign_keys = ON`, and
        the official libsql SDK has them on by default), so in normal operation this is
        always empty. It is kept because enforcement only governs what happens from now on
        — older data, a hand-edited database, or some future driver that does not enforce
        them, would only ever be visible by looking.

        The reason this method exists is a mistake: the deprecated `libsql-client` swallowed
        that pragma, and I concluded from it that libSQL does not enforce foreign keys. That
        stopped being true with the official SDK. The method stays; the conclusion changed.
        """
        return [dict(row) for row in self.conn.execute("PRAGMA foreign_key_check").fetchall()]

    def tables(self) -> set:
        rows = self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        return {row["name"] for row in rows}

    # ---------- writes ----------

    def add_user(self, handle: str, password_hash: str = None) -> str:
        user_id = new_id()
        self.conn.execute(
            "INSERT INTO users (id, handle, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (user_id, handle, password_hash, now()))
        self.conn.commit()
        return user_id

    def create_account(self, handle: str, password_hash: str):
        """Register a handle nobody holds. Returns None if somebody already does.

        The uniqueness is left to the UNIQUE constraint rather than checked first: two
        registrations of the same handle arriving together would both pass a check and one
        would still lose at the insert. Letting the constraint answer means there is one
        code path, and it is the one that is actually race-free.

        A handle taken by a passwordless demo identity is taken all the same. That is the
        point: mel_k owns the demo storyboard, and nobody gets to take it over by
        registering a password for the name.
        """
        try:
            return self.add_user(handle, password_hash)
        except Exception as exc:                       # sqlite3.IntegrityError, or libSQL's own
            if "UNIQUE" not in str(exc).upper():
                raise
            return None

    def user_by_handle(self, handle: str):
        return self.conn.execute(
            "SELECT id, handle, password_hash FROM users WHERE handle = ?", (handle,)).fetchone()

    def ensure_user(self, handle: str) -> str:
        """Return the user if they exist, otherwise create them. The demo has no
        sign-up, so the handle is the identity.
        """
        row = self.conn.execute("SELECT id FROM users WHERE handle = ?", (handle,)).fetchone()
        return row["id"] if row else self.add_user(handle)

    def add_storyboard(self, owner_id: str, title: str = None) -> str:
        """Creating a storyboard also hands the owner a grant.

        The §2 permission gate reads access_grants only; it never consults
        storyboards.owner_id. Without this line the owner is locked out of their own
        storyboard.
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
        """Immediate: once this is written, no read path still honours that grant."""
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
        """Only storage_key is kept. EXIF and GPS are stripped client-side; no column holds them."""
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
        """Returns view / contribute / reshare, or None when there is no valid grant."""
        row = self.conn.execute(
            "SELECT level FROM access_grants "
            "WHERE storyboard_id = ? AND user_id = ? AND revoked_at IS NULL",
            (storyboard_id, user_id)).fetchone()
        return row["level"] if row else None

    def grants(self, storyboard_id: str) -> list[dict]:
        """Who has access right now and at what level. Revoked people are not in here
        — revocation is immediate and leaves no trace in the interface.

        user_id is returned because revoking works by id: a handle is not the primary key
        and should not be used as one. Real names never enter the database, so a handle is
        the most this could hold anyway.
        """
        rows = self.conn.execute(
            "SELECT g.user_id, u.handle, g.level, g.granted_at FROM access_grants g "
            "JOIN users u ON u.id = g.user_id "
            "WHERE g.storyboard_id = ? AND g.revoked_at IS NULL "
            "ORDER BY g.granted_at", (storyboard_id,)).fetchall()
        return [dict(row) for row in rows]

    def share_links(self, storyboard_id: str) -> list[dict]:
        """The links this storyboard has issued. **Never the token** — the database
        holds only a hash, so it could not echo one back even if asked.

        The plaintext appears once, at issue time, and that is the design rather than a
        limitation: a link that can be listed afterwards is a redeemable grant left hanging
        on a screen. So this returns what was issued and whether it still works, never what
        the code is.

        Revoked links are included, which is the opposite of `grants()`. The reasons differ:
        once a grant is revoked that person should disappear from the list, whereas a link
        that has been turned off has to stay visible, or the owner cannot tell whether
        turning it off worked.

        **There is no issue time to return.** `share_links` records `expires_at` but has no
        `created_at` (schema.sql, which is data-model.md §1). So ordering can only use
        `rowid` — insertion order, newest first — and the interface cannot say "sent three
        days ago". Adding that column means changing §1 and regenerating the schema, which
        is a separate job and does not belong in this one.
        """
        rows = self.conn.execute(
            "SELECT l.id, l.level, l.expires_at, l.max_uses, l.used_count, "
            "l.revoked_at, l.created_by, u.handle AS created_by_handle "
            "FROM share_links l JOIN users u ON u.id = l.created_by "
            "WHERE l.storyboard_id = ? ORDER BY l.rowid DESC",
            (storyboard_id,)).fetchall()
        return [dict(row) for row in rows]

    def storyboard_status(self, storyboard_id: str):
        row = self.conn.execute("SELECT status FROM storyboards WHERE id = ?",
                                (storyboard_id,)).fetchone()
        return row["status"] if row else None

    def timeline(self, storyboard_id: str) -> list[dict]:
        """The storyboard timeline: entries from every contributor.

        Not the same thing as SqliteContext.build(), which returns only the requester's own
        content. The platform sees all of it, the assistant does not — the two queries are
        deliberately separate, and merging them would repeal Tier 1. Authors appear as a
        handle only, never a real name.
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

    # ---------- share links ----------

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

    def redeem_link(self, link_id: str, storyboard_id: str, user_id: str,
                    level: str, granted_by: str, upgrade: bool) -> None:
        """Redeem a share link: grant the access and add one to the use count, in a
        single commit.

        This was two calls once — grant, then consume, each committing separately. A failure
        between them let somebody in without counting the use, so a link with max_uses=3
        could admit a fourth person. In a product built on permissioned sharing, one person
        too many is worse than one too few.
        """
        if upgrade:
            self.conn.execute(
                "INSERT INTO access_grants (id, storyboard_id, user_id, level, granted_by, granted_at) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT (storyboard_id, user_id) DO UPDATE SET "
                "level = excluded.level, granted_at = excluded.granted_at, revoked_at = NULL",
                (new_id(), storyboard_id, user_id, level, granted_by, now()))
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
        """The storyboards I can reach. Only the storyboard's own attributes: not who
        else is there, not how much they posted.

        `latest_species` is for the cover on the list screen: in the real product that cover
        is a still from the most recent sighting, so it takes the species of the most recent
        entry. This is not a new visibility scope — the caller already holds a grant, and
        `/api/timeline` would hand them every entry on this storyboard with its species. It
        only saves the list screen from pulling a whole timeline per storyboard.

        The ordering matches `timeline()` word for word: `created_at` only resolves to the
        second, so two entries posted in the same second are separated by `rowid`, which is
        insertion order. The id is a uuid4, so falling back to it would pick at random and
        the card cover would point at a different entry from the top of the timeline. A test
        forced this one out; it was not foreseen.

        `closed_note` comes back here too. The line an owner writes when closing used to be
        written and never read — stored, echoed once in the response to the close itself,
        and then returned by no read path at all. But ux-copy.md §5 calls it a line for
        everyone who contributed, and a line nobody can see is not a message. Like `level`
        it goes only to holders of a grant; it is not a new visibility scope.
        """
        rows = self.conn.execute(
            "SELECT s.id, s.title, s.status, s.last_entry_at, s.closed_note, g.level, "
            "(SELECT COUNT(*) FROM entries e WHERE e.storyboard_id = s.id "
            " AND e.deleted_at IS NULL) AS entry_count, "
            "(SELECT e.species FROM entries e WHERE e.storyboard_id = s.id "
            " AND e.deleted_at IS NULL ORDER BY e.created_at DESC, e.rowid DESC "
            " LIMIT 1) AS latest_species "
            "FROM access_grants g JOIN storyboards s ON s.id = g.storyboard_id "
            "WHERE g.user_id = ? AND g.revoked_at IS NULL "
            "ORDER BY COALESCE(s.last_entry_at, s.created_at) DESC",
            (user_id,)).fetchall()
        return [dict(row) for row in rows]

    # ---------- review queue (operations.md §2) ----------

    def settle_review(self, days: int = 7) -> int:
        """Clear the mark automatically after seven days so nothing piles up for ever
        (operations §2.2).

        Lazy, like archiving: settled in passing when the queue is read or a vote is cast,
        with no scheduled job.
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
        done = self.conn.execute(
            "UPDATE screening_results SET disposition = 'kept', disposed_at = ? "
            "WHERE verdict = 'review' AND disposition IS NULL AND created_at < ?",
            (now(), cutoff)).rowcount
        self.conn.commit()
        return done

    def review_queue(self, storyboard_id: str, viewer_id: str) -> list[dict]:
        """Entries awaiting a second look on this storyboard, **excluding the
        viewer's own**.

        An author is never told their entry was marked (operations §2.3), so their own items
        do not appear in their queue. Vote counts are returned; who voted never is.
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

        # Both fields of one entry can be marked separately, and it should appear once in
        # the queue, so merge the fields and the codes together.
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
        """One vote each, changeable. Two votes decide, settled on the spot (operations §2.2)."""
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
        """Disposal: keep, label publicly, or remove. Removal is a soft delete, not an erasure."""
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

    # ---------- forum ----------

    def add_thread(self, storyboard_id: str, author_id: str, title: str, body: str) -> tuple:
        """Open a thread together with its first post. A thread with no post means nothing."""
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

    def thread_title(self, thread_id: str):
        row = self.conn.execute(
            "SELECT title FROM forum_threads WHERE id = ? AND deleted_at IS NULL",
            (thread_id,)).fetchone()
        return row["title"] if row else None

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

    # ---------- retention and deletion (data-model.md §4) ----------

    def delete_account(self, user_id: str) -> dict:
        """Clear out everything this person wrote, leaving the users row as an
        anonymous headstone.

        The row itself is not deleted because storyboards.owner_id, access_grants.granted_by
        and share_links.created_by all reference it, and deleting it would collapse
        storyboards other people are still using. operations §1 asks for the content and the
        chat history to be gone, not for that row to vanish.
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
        # Links they issued must stop letting people in, but the rows stay — foreign keys
        # still point at them
        removed["share_links_revoked"] = self.conn.execute(
            "UPDATE share_links SET revoked_at = ? WHERE created_by = ? AND revoked_at IS NULL",
            (now(), user_id)).rowcount
        self.conn.execute("UPDATE users SET handle = ? WHERE id = ?",
                          (f"deleted-{new_id()[:6]}", user_id))
        self.conn.commit()
        return removed

    def purge_screening(self, days: int = 30) -> int:
        """Delete 30 days after disposal (operations §1).

        Anything with a disposal time is measured from that; anything never disposed of is
        measured from creation. Items still sitting in the queue undisposed (verdict=
        'review' with an empty disposition) are left alone — settle_review clears them
        automatically within seven days, and the clock starts then.
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
        gone = self.conn.execute(
            "DELETE FROM screening_results WHERE "
            "(disposed_at IS NOT NULL AND disposed_at < ?) OR "
            "(disposition IS NULL AND verdict != 'review' AND created_at < ?)",
            (cutoff, cutoff)).rowcount
        self.conn.commit()
        return gone

    # ---------- archiving ----------

    def settle_stale(self, days: int = 30) -> int:
        """Turn active storyboards with no new entry for 30 days read-only, and clear
        their chat history.

        No scheduled job: whoever touches it settles it. user-flow §9 says it turns read-only
        on its own, not that there is a cron. Clearing the chat on archive is required by
        data-model.md §4.
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
        """The owner closing it deliberately, with a closing line. Archived is not
        deleted: the storyboard stays and the QR code still scans.
        """
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
        """There is no updated_at: data-model.md §1 has no such column, and none is invented here."""
        self.conn.execute("UPDATE entries SET fun_fact = ?, story = ? WHERE id = ?",
                          (fun_fact, story, entry_id))
        self.conn.commit()

    def soft_delete_entry(self, entry_id: str) -> None:
        self.conn.execute("UPDATE entries SET deleted_at = ? WHERE id = ?", (now(), entry_id))
        self.conn.commit()


class SqliteContext:
    """data-model.md §2 build_context(): permission gate first, then Tier 1 own entries."""

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
    """The three ceilings from operations.md §3, held in the rate_limits table.

    The in-memory version counts per instance, which on serverless is no limit at all. This
    one shares a single table across instances. Expired rows are cleared in passing on the
    next count, with no separate scheduled job.
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
    """screening_results. subject_type says which table subject_id points at, and there
    is no foreign key — a rejected submission has no row to point at; see data-model.md §6."""

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
    """chat_messages, partitioned by (user, storyboard), last 6 messages, never summarised."""

    def __init__(self, db: Database):
        self.db = db

    def recent(self, user_id: str, storyboard_id: str) -> list[dict]:
        # Once access is revoked this partition stops being read at once, with no TTL to
        # wait for (prompts.md §2.6.3, item 2). build_context upstream already blocks it;
        # this blocks it again, because a read path should not depend on call order.
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
        """Archiving a storyboard deletes its chat history too (data-model.md §4)."""
        self.db.conn.execute("DELETE FROM chat_messages WHERE user_id = ? AND storyboard_id = ?",
                             (user_id, storyboard_id))
        self.db.conn.commit()
