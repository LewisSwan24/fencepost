"""资源端点：签发令牌、建故事版。走真 HTTP，因为路径分发本身就是要验的东西。

Vercel 那边只有一个入口，所有路径都进同一个 handler，路由是我们自己分的。

    python tests/test_resources.py
"""

import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("FENCEPOST_TOKEN_SECRET", "test-secret")

import api.index as entry                                          # noqa: E402
from proxy.app import COPY, Deps                                   # noqa: E402
from proxy.db import (Database, SqliteContext, SqliteHistory,      # noqa: E402
                      SqliteScreeningLog)

OK_JSON = '{"verdict":"ok","codes":[],"note":""}'
REVIEW_JSON = '{"verdict":"review","codes":["fact_conflict"],"note":"off"}'
REJECT_JSON = '{"verdict":"reject","codes":["pii"],"note":"address named"}'


class FakeClient:
    chat_model = "fake-model"
    screener_model = "fake-screener"

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def call(self, role, system, content, history=()):
        self.calls.append({"role": role, "content": content})
        return self.replies.pop(0) if self.replies else "a reply"


class Fixture(unittest.TestCase):
    def setUp(self):
        self.db = Database()
        self.client = FakeClient()
        entry._DEPS = Deps(client=self.client, db=self.db,
                           history=SqliteHistory(self.db), context=SqliteContext(self.db),
                           screening=SqliteScreeningLog(self.db))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), entry.handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        os.environ["FENCEPOST_OPEN_SIGNUP"] = "1"

    def tearDown(self):
        self.server.shutdown()
        entry._DEPS = None
        os.environ.pop("FENCEPOST_OPEN_SIGNUP", None)

    def post(self, path, body, token=None):
        headers = {"content-type": "application/json"}
        if token:
            headers["authorization"] = "Bearer " + token
        request = urllib.request.Request(self.base + path, data=json.dumps(body).encode(),
                                         headers=headers)
        try:
            resp = urllib.request.urlopen(request)
        except urllib.error.HTTPError as err:
            resp = err
        return resp.status, json.loads(resp.read())

    def get(self, path, token=None):
        headers = {"authorization": "Bearer " + token} if token else {}
        request = urllib.request.Request(self.base + path, headers=headers)
        try:
            resp = urllib.request.urlopen(request)
        except urllib.error.HTTPError as err:
            resp = err
        return resp.status, json.loads(resp.read())

    def session(self, handle="neighbour-a"):
        return self.post("/api/session", {"handle": handle})[1]

    def board(self, handle="owner"):
        who = self.session(handle)
        _, created = self.post("/api/storyboards", {"title": "Fence at number 12"},
                               token=who["token"])
        return who, created["storyboard_id"]

    def submit(self, token, storyboard_id, *replies, **over):
        self.client.replies = list(replies) or [OK_JSON]
        body = {"storyboard_id": storyboard_id, "species": "brushtail", "story": "saw one"}
        body.update(over)
        return self.post("/api/entries", body, token=token)

    def rows(self):
        return self.db.conn.execute("SELECT * FROM screening_results ORDER BY rowid").fetchall()

    def with_entry(self, story="mine, on the fence"):
        who, board = self.board()
        _, created = self.submit(who["token"], board, OK_JSON, story=story)
        return who, board, created["entry_id"]

    def assistant_sees(self, token, board):
        self.client.calls.clear()
        self.client.replies = []
        self.post("/api/assistant", {"role": "neighbour", "storyboard_id": board,
                                     "message": "what did I write?"}, token=token)
        return json.dumps(self.client.calls[-1], ensure_ascii=False)


class Resources(Fixture):
    def test_signup_is_closed_unless_switched_on(self):
        os.environ.pop("FENCEPOST_OPEN_SIGNUP")
        status, payload = self.post("/api/session", {"handle": "neighbour-a"})
        self.assertEqual(403, status)
        self.assertEqual("signup_closed", payload["error"]["code"])

    def test_session_returns_a_usable_token(self):
        status, payload = self.post("/api/session", {"handle": "neighbour-a"})
        self.assertEqual(200, status)
        self.assertTrue(payload["token"].startswith(payload["user_id"] + "."))
        created, _ = self.post("/api/storyboards", {"title": "Fence at number 12"},
                               token=payload["token"])
        self.assertEqual(200, created)

    def test_the_same_handle_is_the_same_user(self):
        first, second = self.session(), self.session()
        self.assertEqual(first["user_id"], second["user_id"])
        self.assertEqual(1, self.db.conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"])

    def test_an_empty_handle_is_refused(self):
        for handle in ("", "   ", "x" * 41):
            with self.subTest(handle=handle[:8]):
                status, _ = self.post("/api/session", {"handle": handle})
                self.assertEqual(400, status)

    def test_creating_a_storyboard_needs_a_token(self):
        status, payload = self.post("/api/storyboards", {"title": "no token here"})
        self.assertEqual(401, status)
        self.assertEqual("unauthorized", payload["error"]["code"])

    def test_the_owner_can_reach_the_storyboard_they_just_created(self):
        token = self.session()["token"]
        _, created = self.post("/api/storyboards", {"title": "Fence at number 12"}, token=token)
        status, payload = self.post("/api/assistant",
                                    {"role": "neighbour", "storyboard_id": created["storyboard_id"],
                                     "message": "hello"}, token=token)
        self.assertEqual(200, status)
        self.assertEqual("a reply", payload["reply"])

    def test_someone_elses_storyboard_stays_out_of_reach(self):
        mine = self.session("neighbour-a")["token"]
        theirs = self.session("neighbour-b")["token"]
        _, created = self.post("/api/storyboards", {"title": "theirs"}, token=theirs)
        status, payload = self.post("/api/assistant",
                                    {"role": "neighbour", "storyboard_id": created["storyboard_id"],
                                     "message": "what is in here?"}, token=mine)
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])

    def test_an_overlong_title_is_refused(self):
        token = self.session()["token"]
        status, _ = self.post("/api/storyboards", {"title": "x" * 121}, token=token)
        self.assertEqual(400, status)

    def test_an_unknown_path_is_404(self):
        status, payload = self.post("/api/nothing-here", {})
        self.assertEqual(404, status)
        self.assertEqual(COPY["not_found"], payload["error"]["message"])


class Entries(Fixture):
    """提交 entry 与读时间线。沿用 Resources 的 fixture。"""

    def test_a_video_is_registered_against_its_owner(self):
        who = self.session()
        status, payload = self.post("/api/videos", {"storage_key": "uploads/2026/clip.mp4"},
                                    token=who["token"])
        self.assertEqual(200, status)
        self.assertEqual(who["user_id"], self.db.video_owner(payload["video_id"]))

    def test_someone_elses_video_cannot_be_attached(self):
        stranger = self.session("stranger")
        _, video = self.post("/api/videos", {"storage_key": "theirs.mp4"}, token=stranger["token"])
        who, board = self.board()
        status, payload = self.submit(who["token"], board, video_id=video["video_id"])
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])

    def test_a_clean_entry_is_published_and_recorded(self):
        who, board = self.board()
        status, payload = self.submit(who["token"], board)
        self.assertEqual(200, status)
        self.assertTrue(payload["published"])
        row = self.rows()[0]
        self.assertEqual("entry", row["subject_type"])
        self.assertEqual(payload["entry_id"], row["subject_id"])

    def test_a_rejected_submission_creates_no_entry(self):
        who, board = self.board()
        status, payload = self.submit(who["token"], board, REJECT_JSON,
                                      story="He lives at 42 Example St.")
        self.assertEqual(200, status)
        self.assertFalse(payload["published"])
        self.assertEqual(["pii"], payload["reason_codes"])
        self.assertNotIn("entry_id", payload)
        self.assertEqual([], self.db.timeline(board))
        self.assertEqual("submission", self.rows()[0]["subject_type"])

    def test_a_flagged_entry_looks_exactly_like_a_clean_one(self):
        who, board = self.board()
        _, flagged = self.submit(who["token"], board, REVIEW_JSON)
        _, clean = self.submit(who["token"], board, OK_JSON)
        self.assertEqual(set(clean), set(flagged))
        self.assertTrue(flagged["published"])
        self.assertEqual("review", self.rows()[0]["verdict"])

    def test_both_fields_are_screened_separately(self):
        who, board = self.board()
        self.submit(who["token"], board, OK_JSON, OK_JSON,
                    fun_fact="Brushtails are nocturnal.", story="saw one on the fence")
        self.assertEqual(["fun_fact", "story"], [row["field"] for row in self.rows()])

    def test_a_viewer_cannot_add_an_entry(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "view", owner["user_id"])
        status, payload = self.submit(guest["token"], board)
        self.assertEqual(403, status)
        self.assertEqual("read_only_access", payload["error"]["code"])

    def test_a_closed_storyboard_takes_no_new_entries(self):
        who, board = self.board()
        self.db.conn.execute("UPDATE storyboards SET status = 'readonly' WHERE id = ?", (board,))
        status, payload = self.submit(who["token"], board)
        self.assertEqual(409, status)
        self.assertEqual("storyboard_closed", payload["error"]["code"])

    def test_the_timeline_shows_every_contributor(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.submit(guest["token"], board, OK_JSON, species="ringtail", story="theirs, in the tree")
        self.submit(owner["token"], board, OK_JSON, story="mine, on the fence")
        status, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        self.assertEqual(200, status)
        self.assertEqual(["theirs, in the tree", "mine, on the fence"],
                         [e["story"] for e in view["entries"]])
        self.assertEqual(["guest", "owner"], [e["handle"] for e in view["entries"]])

    def test_the_timeline_and_the_assistant_see_different_things(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.submit(guest["token"], board, OK_JSON, species="ringtail", story="theirs, in the tree")
        self.submit(owner["token"], board, OK_JSON, story="mine, on the fence")
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        context = SqliteContext(self.db).build(owner["user_id"], board)
        self.assertEqual(2, len(view["entries"]))
        self.assertEqual(["mine, on the fence"], [e["story"] for e in context["own_entries"]])

    def test_the_timeline_drops_soft_deleted_entries(self):
        who, board = self.board()
        _, first = self.submit(who["token"], board, OK_JSON, story="about to go")
        self.submit(who["token"], board, OK_JSON, story="still here")
        self.db.soft_delete_entry(first["entry_id"])
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=who["token"])
        self.assertEqual(["still here"], [e["story"] for e in view["entries"]])

    def test_the_timeline_needs_a_grant(self):
        _, board = self.board()
        stranger = self.session("stranger")
        status, payload = self.get(f"/api/timeline?storyboard_id={board}", token=stranger["token"])
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])


class Edits(Fixture):
    """改与删。要紧的是即时性：下一次助手调用就该看到变化。"""

    def test_the_author_can_delete_and_the_timeline_drops_it(self):
        who, board, entry_id = self.with_entry()
        status, payload = self.post("/api/entries/delete", {"entry_id": entry_id},
                                    token=who["token"])
        self.assertEqual(200, status)
        self.assertTrue(payload["deleted"])
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=who["token"])
        self.assertEqual([], view["entries"])

    def test_a_deleted_entry_leaves_the_assistant_context_at_once(self):
        who, board, entry_id = self.with_entry("mine, on the fence")
        self.assertIn("mine, on the fence", self.assistant_sees(who["token"], board))
        self.post("/api/entries/delete", {"entry_id": entry_id}, token=who["token"])
        self.assertNotIn("mine, on the fence", self.assistant_sees(who["token"], board))

    def test_another_contributor_cannot_delete_it(self):
        owner, board, entry_id = self.with_entry()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        status, payload = self.post("/api/entries/delete", {"entry_id": entry_id},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("not_your_entry", payload["error"]["code"])

    def test_deleting_twice_is_gone(self):
        who, _, entry_id = self.with_entry()
        self.post("/api/entries/delete", {"entry_id": entry_id}, token=who["token"])
        status, payload = self.post("/api/entries/delete", {"entry_id": entry_id},
                                    token=who["token"])
        self.assertEqual(404, status)
        self.assertEqual("gone", payload["error"]["code"])

    def test_an_edit_is_screened_and_applied(self):
        who, board, entry_id = self.with_entry("saw one")
        self.client.replies = [OK_JSON]
        status, payload = self.post("/api/entries/edit",
                                    {"entry_id": entry_id, "story": "saw one on the fence"},
                                    token=who["token"])
        self.assertEqual(200, status)
        self.assertTrue(payload["published"])
        self.assertEqual("story", self.rows()[-1]["field"])
        self.assertIn("saw one on the fence", self.assistant_sees(who["token"], board))

    def test_a_rejected_edit_leaves_the_original_alone(self):
        who, board, entry_id = self.with_entry("saw one")
        self.client.replies = [REJECT_JSON]
        status, payload = self.post("/api/entries/edit",
                                    {"entry_id": entry_id, "story": "He lives at 42 Example St."},
                                    token=who["token"])
        self.assertEqual(200, status)
        self.assertFalse(payload["published"])
        self.assertEqual("saw one", self.db.entry(entry_id)["story"])
        self.assertIn("saw one", self.assistant_sees(who["token"], board))

    def test_an_edit_that_changes_nothing_skips_the_screener(self):
        who, _, entry_id = self.with_entry("saw one")
        self.client.calls.clear()
        _, payload = self.post("/api/entries/edit", {"entry_id": entry_id, "story": "saw one"},
                               token=who["token"])
        self.assertTrue(payload["unchanged"])
        self.assertEqual([], self.client.calls)

    def test_a_closed_storyboard_takes_no_edits(self):
        who, board, entry_id = self.with_entry()
        self.db.conn.execute("UPDATE storyboards SET status = 'archived' WHERE id = ?", (board,))
        status, payload = self.post("/api/entries/edit", {"entry_id": entry_id, "story": "later"},
                                    token=who["token"])
        self.assertEqual(409, status)
        self.assertEqual("storyboard_closed", payload["error"]["code"])


class Sharing(Fixture):
    """带权限的 QR 链接：签发、兑换、撤销。"""

    def link(self, token, storyboard_id, **over):
        body = {"storyboard_id": storyboard_id}
        body.update(over)
        return self.post("/api/share-links", body, token=token)

    def test_only_the_hash_is_stored(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board)
        row = self.db.share_link(issued["share_link_id"])
        self.assertNotEqual(issued["token"], row["token_hash"])
        self.assertEqual(64, len(row["token_hash"]))
        rows = self.db.conn.execute("SELECT * FROM share_links").fetchall()
        self.assertNotIn(issued["token"], json.dumps([dict(r) for r in rows]))

    def test_redeeming_grants_the_level_the_link_carries(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board, level="contribute")
        guest = self.session("guest")
        status, redeemed = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                     token=guest["token"])
        self.assertEqual(200, status)
        self.assertEqual("contribute", redeemed["level"])
        submitted, _ = self.submit(guest["token"], board, OK_JSON)
        self.assertEqual(200, submitted)

    def test_a_view_link_cannot_write(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board, level="view")
        guest = self.session("guest")
        self.post("/api/share-links/redeem", {"token": issued["token"]}, token=guest["token"])
        status, payload = self.submit(guest["token"], board)
        self.assertEqual(403, status)
        self.assertEqual("read_only_access", payload["error"]["code"])

    def test_a_contributor_cannot_hand_out_access(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        status, payload = self.link(guest["token"], board)
        self.assertEqual(403, status)
        self.assertEqual("cannot_share", payload["error"]["code"])

    def test_an_expired_link_is_refused(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board)
        self.db.conn.execute("UPDATE share_links SET expires_at = ? WHERE id = ?",
                             ("2020-01-01T00:00:00+00:00", issued["share_link_id"]))
        guest = self.session("guest")
        status, payload = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("link_expired", payload["error"]["code"])

    def test_a_used_up_link_is_refused(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board, max_uses=1)
        first = self.session("first")
        second = self.session("second")
        self.post("/api/share-links/redeem", {"token": issued["token"]}, token=first["token"])
        status, payload = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                    token=second["token"])
        self.assertEqual(403, status)
        self.assertEqual("link_used_up", payload["error"]["code"])

    def test_a_revoked_link_stops_working_at_once(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board)
        self.post("/api/share-links/revoke", {"share_link_id": issued["share_link_id"]},
                  token=owner["token"])
        guest = self.session("guest")
        status, payload = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("link_revoked", payload["error"]["code"])

    def test_an_unknown_token_is_not_found(self):
        guest = self.session("guest")
        status, payload = self.post("/api/share-links/redeem", {"token": "made-up"},
                                    token=guest["token"])
        self.assertEqual(404, status)
        self.assertEqual("invalid_link", payload["error"]["code"])

    def test_redeeming_never_downgrades(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board, level="view")
        _, redeemed = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                token=owner["token"])
        self.assertEqual("reshare", redeemed["level"])
        self.assertEqual("reshare", self.db.grant_level(board, owner["user_id"]))

    def test_the_owner_can_revoke_a_grant_and_access_stops(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        seen, _ = self.get(f"/api/timeline?storyboard_id={board}", token=guest["token"])
        self.assertEqual(200, seen)
        self.post("/api/grants/revoke", {"storyboard_id": board, "user_id": guest["user_id"]},
                  token=owner["token"])
        status, payload = self.get(f"/api/timeline?storyboard_id={board}", token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])

    def test_only_the_owner_revokes(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "reshare", owner["user_id"])
        status, payload = self.post("/api/grants/revoke",
                                    {"storyboard_id": board, "user_id": owner["user_id"]},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("not_the_owner", payload["error"]["code"])


class Dashboard(Fixture):
    """我能访问的故事版，活跃与往期分开。"""

    def view(self, token):
        return self.get("/api/dashboard", token=token)[1]

    def test_it_lists_only_what_i_can_reach(self):
        owner, mine = self.board("owner")
        stranger, theirs = self.board("stranger")
        view = self.view(owner["token"])
        self.assertEqual([mine], [b["id"] for b in view["active"]])
        self.assertEqual([theirs], [b["id"] for b in self.view(stranger["token"])["active"]])

    def test_archived_storyboards_move_to_past(self):
        owner, board = self.board()
        self.assertEqual(1, len(self.view(owner["token"])["active"]))
        self.db.conn.execute("UPDATE storyboards SET status = 'readonly' WHERE id = ?", (board,))
        view = self.view(owner["token"])
        self.assertEqual([], view["active"])
        self.assertEqual([board], [b["id"] for b in view["past"]])

    def test_a_revoked_grant_drops_it_from_the_list(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.assertEqual(1, len(self.view(guest["token"])["active"]))
        self.post("/api/grants/revoke", {"storyboard_id": board, "user_id": guest["user_id"]},
                  token=owner["token"])
        self.assertEqual([], self.view(guest["token"])["active"])

    def test_it_says_nothing_about_the_other_contributors(self):
        owner, board = self.board()
        guest = self.session("neighbour-with-a-name")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.submit(guest["token"], board, OK_JSON, story="theirs")
        payload = json.dumps(self.view(owner["token"]), ensure_ascii=False)
        self.assertNotIn("neighbour-with-a-name", payload)
        self.assertNotIn(guest["user_id"], payload)

    def test_the_entry_count_leaves_out_deleted_ones(self):
        owner, board = self.board()
        _, first = self.submit(owner["token"], board, OK_JSON, story="one")
        self.submit(owner["token"], board, OK_JSON, story="two")
        self.assertEqual(2, self.view(owner["token"])["active"][0]["entry_count"])
        self.db.soft_delete_entry(first["entry_id"])
        self.assertEqual(1, self.view(owner["token"])["active"][0]["entry_count"])

    def test_my_level_comes_back_with_each_one(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "view", owner["user_id"])
        self.assertEqual("reshare", self.view(owner["token"])["active"][0]["level"])
        self.assertEqual("view", self.view(guest["token"])["active"][0]["level"])


class Closing(Fixture):
    """owner 主动完结。"""

    def test_the_owner_can_close_with_a_note(self):
        owner, board = self.board()
        status, payload = self.post("/api/storyboards/close",
                                    {"storyboard_id": board,
                                     "closed_note": "that was the last of them"},
                                    token=owner["token"])
        self.assertEqual(200, status)
        self.assertEqual("archived", payload["status"])
        self.assertEqual([board], [b["id"] for b in self.get("/api/dashboard",
                                                             token=owner["token"])[1]["past"]])

    def test_only_the_owner_closes(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "reshare", owner["user_id"])
        status, payload = self.post("/api/storyboards/close", {"storyboard_id": board},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("not_the_owner", payload["error"]["code"])

    def test_a_closed_storyboard_still_reads(self):
        owner, board = self.board()
        self.submit(owner["token"], board, OK_JSON, story="before closing")
        self.post("/api/storyboards/close", {"storyboard_id": board}, token=owner["token"])
        status, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        self.assertEqual(200, status)
        self.assertEqual(["before closing"], [e["story"] for e in view["entries"]])


class Forum(Fixture):
    """讨论串挂在故事版下，权限跟着故事版走，助手一律看不见。"""

    def thread(self, token, storyboard_id, reply=OK_JSON, **over):
        self.client.replies = [reply]
        body = {"storyboard_id": storyboard_id, "title": "Who else hears it at 2am",
                "body": "there is something walking on my roof every night"}
        body.update(over)
        return self.post("/api/forum/threads", body, token=token)

    def test_a_thread_is_created_and_listed(self):
        owner, board = self.board()
        status, created = self.thread(owner["token"], board)
        self.assertEqual(200, status)
        self.assertTrue(created["published"])
        _, listing = self.get(f"/api/forum?storyboard_id={board}", token=owner["token"])
        self.assertEqual(["Who else hears it at 2am"], [t["title"] for t in listing["threads"]])
        self.assertEqual(1, listing["threads"][0]["post_count"])

    def test_a_rejected_post_creates_nothing(self):
        owner, board = self.board()
        status, payload = self.thread(owner["token"], board, reply=REJECT_JSON,
                                      body="He lives at 42 Example St.")
        self.assertEqual(200, status)
        self.assertFalse(payload["published"])
        self.assertEqual(["pii"], payload["reason_codes"])
        _, listing = self.get(f"/api/forum?storyboard_id={board}", token=owner["token"])
        self.assertEqual([], listing["threads"])

    def test_replies_land_in_order(self):
        owner, board = self.board()
        _, created = self.thread(owner["token"], board)
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.client.replies = [OK_JSON]
        self.post("/api/forum/posts", {"thread_id": created["thread_id"], "body": "mine too"},
                  token=guest["token"])
        _, view = self.get(f"/api/forum/thread?thread_id={created['thread_id']}",
                           token=owner["token"])
        self.assertEqual(["there is something walking on my roof every night", "mine too"],
                         [p["body"] for p in view["posts"]])
        self.assertEqual(["owner", "guest"], [p["handle"] for p in view["posts"]])

    def test_a_viewer_reads_but_does_not_post(self):
        owner, board = self.board()
        _, created = self.thread(owner["token"], board)
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "view", owner["user_id"])
        read, _ = self.get(f"/api/forum?storyboard_id={board}", token=guest["token"])
        self.assertEqual(200, read)
        self.client.replies = [OK_JSON]
        status, payload = self.post("/api/forum/posts",
                                    {"thread_id": created["thread_id"], "body": "let me in"},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("read_only_access", payload["error"]["code"])

    def test_a_stranger_sees_nothing(self):
        owner, board = self.board()
        self.thread(owner["token"], board)
        stranger = self.session("stranger")
        status, payload = self.get(f"/api/forum?storyboard_id={board}", token=stranger["token"])
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])

    def test_the_assistant_never_sees_forum_content(self):
        owner, board = self.board()
        self.thread(owner["token"], board, body="SOMETHING ONLY SAID IN THE FORUM")
        self.client.calls.clear()
        self.client.replies = []
        self.post("/api/assistant", {"role": "neighbour", "storyboard_id": board,
                                     "message": "what have I been saying?"}, token=owner["token"])
        sent = json.dumps(self.client.calls[-1], ensure_ascii=False)
        self.assertNotIn("SOMETHING ONLY SAID IN THE FORUM", sent)

    def test_a_closed_storyboard_takes_no_new_threads(self):
        owner, board = self.board()
        self.db.conn.execute("UPDATE storyboards SET status = 'archived' WHERE id = ?", (board,))
        status, payload = self.thread(owner["token"], board)
        self.assertEqual(409, status)
        self.assertEqual("storyboard_closed", payload["error"]["code"])

    def test_an_unknown_thread_is_gone(self):
        who = self.session()
        status, payload = self.get("/api/forum/thread?thread_id=nope", token=who["token"])
        self.assertEqual(404, status)
        self.assertEqual("gone", payload["error"]["code"])


if __name__ == "__main__":
    unittest.main()
